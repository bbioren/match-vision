"""Walk SPADL actions for the target match (3788741, Turkey vs Italy) and emit
a JSON list of "moment" objects matching the schema used by the live VLM
pipeline (src/services/match-context.js `interpretMoment()` /
src/services/match-memory.js `formatMemory()`), plus extra ground-truth
fields (expected_threat_delta, action_vaep_value, momentum, urgency_level).

Run (from analytics/, with the venv active):
    source .venv/bin/activate && python build_state_frames.py

Writes ../data/analytics/turkey_vs_italy_euro2020_timeline.json

--- Period-aware attacking direction -----------------------------------------
socceraction.spadl.play_left_to_right(actions, home_team_id) only flips the
AWAY team's x/y so both teams "attack the same way" relative to each other —
it has no concept of periods, so it silently ignores the real halftime side
swap (confirmed empirically: home team's mean start_x goes from ~35.6 in
period 1 to ~63.0 in period 2 in this match — teams really do swap ends).

socceraction.vaep.VAEP internally calls the same period-unaware flip (see
socceraction/vaep/base.py compute_features -> features.play_left_to_right),
using only game.home_team_id. This is an accepted simplification baked into
the library itself (it's what socceraction's own tutorials do) — vaep_value
per action is computed under this simplification and we do NOT try to fix
VAEP's internals here.

What we DO fix, because it directly affects the human-readable text and the
xT *rating* step:
  - attacking_right(team_id, period_id): determined from each team's own shot
    end_x median in that period (shots reliably cluster near the goal the
    team is actually attacking, even though general play_left_to_right
    doesn't know about the swap).
  - A manual per-period flip (mirroring play_left_to_right's own x/y math:
    field_length - x, field_width - y) applied before calling
    ExpectedThreat.rate(), so xT's left-to-right assumption holds in BOTH
    periods, not just relative-to-home-team in period 1.
  - direction / ball_zone / ball_location text in the emitted moments, which
    use attacking_right() per (team, period) rather than a single global
    home/away flip.
"""
from __future__ import annotations

import json
import pickle
from pathlib import Path

import pandas as pd

from statsbomb_pipeline import CACHE_DIR, game_series, load_match_actions

MATCH_ID = 3788741  # Turkey vs Italy, Euro 2020
FIELD_LENGTH = 105.0
FIELD_WIDTH = 68.0
MIDFIELD_X = FIELD_LENGTH / 2  # 52.5

OUT_PATH = Path(__file__).parent.parent / "data" / "analytics" / "turkey_vs_italy_euro2020_timeline.json"

XT_MODEL_PATH = CACHE_DIR / "xt_model.pkl"
VAEP_MODEL_PATH = CACHE_DIR / "vaep_model.pkl"

MOMENTUM_WINDOW_SECONDS = 60
URGENCY_XT_THRESHOLD = 0.10
SHOT_TYPES = {"shot", "shot_penalty", "shot_freekick"}
GOAL_RESULT = "success"


# ── Period-aware attacking direction ─────────────────────────────────────────

def compute_attacking_right(actions: pd.DataFrame) -> dict[tuple[str, int], bool]:
    """For each (team_id, period_id), decide whether that team attacks toward
    increasing x ("right") in that period, using the median end_x of that
    team's shots in that period as the signal (shots cluster near the goal
    being attacked, regardless of which side of the pitch the broadcast shows
    as "home" that half).

    Falls back to the team's overall mean start_x trend if it has no shots in
    a given period (rare, but be defensive for short/weird periods e.g.
    extra time).
    """
    shots = actions[actions["type_name"].isin(SHOT_TYPES)]
    result: dict[tuple[str, int], bool] = {}

    for (team_id, period_id), group in shots.groupby(["team_id", "period_id"]):
        median_end_x = group["end_x"].median()
        result[(str(team_id), int(period_id))] = bool(median_end_x > MIDFIELD_X)

    # Fallback for (team, period) combos with no shots: use mean start_x of
    # all that team's actions in that period vs the OTHER team's mean start_x
    # in the same period — whichever team sits deeper (lower mean start_x) is
    # generally the one defending that end, so the team with the higher mean
    # start_x in a period is (weakly) attacking right.
    team_ids = sorted(actions["team_id"].unique(), key=str)
    period_ids = sorted(actions["period_id"].unique())
    for period_id in period_ids:
        period_actions = actions[actions["period_id"] == period_id]
        means = period_actions.groupby("team_id")["start_x"].mean()
        for team_id in team_ids:
            key = (str(team_id), int(period_id))
            if key in result:
                continue
            if team_id not in means.index or len(means) < 2:
                continue
            other_mean = means.drop(team_id).mean()
            result[key] = bool(means[team_id] > other_mean)

    return result


def flip_actions_for_period(actions: pd.DataFrame, attacking_right: dict) -> pd.DataFrame:
    """Return a copy of `actions` where every action plays left-to-right,
    determined per (team_id, period_id) rather than a single global
    home/away flip. Mirrors socceraction.spadl.play_left_to_right's own
    flip math (field_length - x, field_width - y) but applies it whenever a
    team is attacking LEFT in that period (not just when team != home_team_id).
    """
    flipped = actions.copy()
    needs_flip = flipped.apply(
        lambda row: not attacking_right.get((str(row["team_id"]), int(row["period_id"])), True),
        axis=1,
    )
    for col in ["start_x", "end_x"]:
        flipped.loc[needs_flip, col] = FIELD_LENGTH - actions.loc[needs_flip, col]
    for col in ["start_y", "end_y"]:
        flipped.loc[needs_flip, col] = FIELD_WIDTH - actions.loc[needs_flip, col]
    return flipped


# ── Human-readable zone / direction text ─────────────────────────────────────

def zone_for_x(x: float, attacking_right_now: bool) -> str:
    """Bucket an x coordinate (0-105, raw/un-flipped) into thirds, labeled
    relative to which third of the pitch it is in absolute terms (defensive /
    middle / attacking third FOR THE TEAM IN POSSESSION)."""
    if attacking_right_now:
        if x < 35:
            return "defensive third"
        if x < 70:
            return "middle third"
        return "attacking third"
    else:
        if x > 70:
            return "defensive third"
        if x > 35:
            return "middle third"
        return "attacking third"


def absolute_third(x: float) -> str:
    if x < 35:
        return "left third"
    if x < 70:
        return "middle third"
    return "right third"


def direction_text(team_name: str, attacking_right_now: bool | None) -> str:
    if attacking_right_now is None:
        return "unknown"
    return f"{team_name} attacking {'right' if attacking_right_now else 'left'}"


def describe_event(row: pd.Series, player_name: str, team_name: str) -> str:
    type_name = (row.get("type_name") or "unknown").replace("_", " ")
    result_name = row.get("result_name") or "unknown"
    bodypart = (row.get("bodypart_name") or "").replace("_", " ")

    if row.get("type_name") in SHOT_TYPES:
        if result_name == GOAL_RESULT:
            return f"GOAL — {player_name} ({team_name}) scores with a {bodypart or 'shot'}." if bodypart else f"GOAL — {player_name} ({team_name}) scores."
        outcome = {"fail": "off target", "offside": "ruled offside"}.get(result_name, result_name)
        bp = f" with {bodypart}" if bodypart else ""
        return f"{player_name} ({team_name}) shoots{bp} — {outcome}."

    if row.get("type_name") == "pass" and result_name == "fail":
        return f"{player_name} ({team_name}) attempts a pass — lost possession."
    if row.get("type_name") == "pass":
        return f"{player_name} ({team_name}) passes the ball."
    if row.get("type_name") == "cross":
        return f"{player_name} ({team_name}) delivers a cross." if result_name == GOAL_RESULT else f"{player_name} ({team_name}) attempts a cross."
    if row.get("type_name") == "dribble":
        return f"{player_name} ({team_name}) carries the ball forward."
    if row.get("type_name") == "take_on":
        return f"{player_name} ({team_name}) takes on a defender — {'beats them' if result_name == GOAL_RESULT else 'is stopped'}."
    if row.get("type_name") == "tackle":
        return f"{player_name} ({team_name}) makes a tackle."
    if row.get("type_name") == "interception":
        return f"{player_name} ({team_name}) intercepts the ball."
    if row.get("type_name") == "clearance":
        return f"{player_name} ({team_name}) clears the danger."
    if row.get("type_name") == "foul":
        return f"{player_name} ({team_name}) commits a foul."
    if row.get("type_name") in ("keeper_save", "keeper_claim", "keeper_punch", "keeper_pick_up"):
        return f"{player_name} ({team_name}) — goalkeeper action ({type_name})."
    if row.get("type_name") in ("throw_in", "corner_crossed", "corner_short", "goalkick",
                                 "freekick_crossed", "freekick_short"):
        return f"{player_name} ({team_name}) takes a {type_name}."
    return f"{player_name} ({team_name}) — {type_name} ({result_name})."


def urgency_level(xt_delta: float, is_shot: bool) -> str:
    if is_shot or (xt_delta is not None and xt_delta > URGENCY_XT_THRESHOLD):
        return "high"
    if xt_delta is not None and xt_delta > 0.03:
        return "medium"
    return "low"


def format_timestamp(period_id: int, time_seconds: float) -> str:
    minute = int(time_seconds // 60)
    second = int(time_seconds % 60)
    if period_id >= 2:
        minute += 45 * (period_id - 1)
    return f"{minute:02d}:{second:02d}"


def at_second(period_id: int, time_seconds: float) -> int:
    # Continuous match clock across periods, 45 min assumed per period before
    # this one (sufficient for half 1/2; extra-time periods would need real
    # period lengths, not needed for this Euro 2020 group match).
    offset = 45 * 60 * (period_id - 1)
    return int(offset + time_seconds)


def main():
    print(f"Loading actions for match {MATCH_ID}...")
    actions, meta = load_match_actions(MATCH_ID)
    team_names = meta["team_names"]
    player_names = meta["player_names"]
    home_team_id = meta["home_team_id"]

    attacking_right = compute_attacking_right(actions)
    print("Attacking direction by (team, period):")
    for (team_id, period_id), right in sorted(attacking_right.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        print(f"  {team_names.get(team_id, team_id)} period {period_id}: {'right' if right else 'left'}")

    if not XT_MODEL_PATH.exists() or not VAEP_MODEL_PATH.exists():
        raise SystemExit(
            f"Missing fitted models — run `python fit_models.py` first.\n"
            f"Expected {XT_MODEL_PATH} and {VAEP_MODEL_PATH}."
        )

    with open(XT_MODEL_PATH, "rb") as f:
        xt_model = pickle.load(f)
    with open(VAEP_MODEL_PATH, "rb") as f:
        vaep_model = pickle.load(f)

    # xT: needs actions flipped left-to-right per (team, period), not just a
    # single global home/away flip.
    flipped_for_xt = flip_actions_for_period(actions, attacking_right)
    xt_values = xt_model.rate(flipped_for_xt)

    # VAEP: accepted simplification — let the library do its own (period-
    # unaware) home/away flip internally.
    game = game_series(meta)
    vaep_ratings = vaep_model.rate(game, actions)

    df = actions.copy()
    df["expected_threat_delta"] = pd.Series(xt_values, index=df.index)
    df["action_vaep_value"] = vaep_ratings["vaep_value"].reindex(df.index)

    moments = []
    momentum_by_team: dict[str, list[tuple[int, float]]] = {}

    for idx, row in df.iterrows():
        team_id = str(row["team_id"])
        player_id = str(row["player_id"])
        team_name = team_names.get(team_id, f"Team {team_id}")
        player_name = player_names.get(player_id, f"Player {player_id}")
        period_id = int(row["period_id"])
        sec = at_second(period_id, float(row["time_seconds"]))

        right_now = attacking_right.get((team_id, period_id))
        zone = zone_for_x(float(row["start_x"]), right_now) if right_now is not None else absolute_third(float(row["start_x"]))
        ball_location = absolute_third(float(row["start_x"]))

        xt_delta = row["expected_threat_delta"]
        xt_delta = float(xt_delta) if pd.notna(xt_delta) else None
        vaep_value = row["action_vaep_value"]
        vaep_value = float(vaep_value) if pd.notna(vaep_value) else 0.0

        is_shot = row["type_name"] in SHOT_TYPES
        is_goal = is_shot and row["result_name"] == GOAL_RESULT

        # Rolling momentum: sum of this team's action_vaep_value over the
        # last MOMENTUM_WINDOW_SECONDS of game time.
        history = momentum_by_team.setdefault(team_id, [])
        history.append((sec, vaep_value))
        cutoff = sec - MOMENTUM_WINDOW_SECONDS
        while history and history[0][0] < cutoff:
            history.pop(0)
        momentum = round(sum(v for _, v in history), 4)

        event_text = describe_event(row, player_name, team_name)
        danger = urgency_level(xt_delta, is_shot)

        summary_parts = [f"{team_name} — {event_text}"]
        if right_now is not None:
            summary_parts.append(f"({zone}, {direction_text(team_name, right_now)})")
        summary = " ".join(summary_parts)

        moment = {
            "atSecond": sec,
            "timestamp": format_timestamp(period_id, float(row["time_seconds"])),
            "match_half": period_id,
            "team_in_possession": team_name,
            "ball_zone": zone,
            "ball_location": ball_location,
            "direction": direction_text(team_name, right_now),
            "phase": f"{team_name} attacking" if right_now is not None and zone == "attacking third" else f"{team_name} in possession",
            "danger_level": "high" if is_goal else danger,
            "event": event_text,
            "summary": summary,
            "source": "analytics-ground-truth",
            "expected_threat_delta": round(xt_delta, 4) if xt_delta is not None else None,
            "action_vaep_value": round(vaep_value, 4),
            "momentum": momentum,
            "urgency_level": "high" if is_goal else danger,
        }
        moments.append(moment)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(moments, indent=2))
    print(f"\nWrote {len(moments)} moments -> {OUT_PATH}")

    goals = [m for m in moments if m["danger_level"] == "high" and "GOAL" in m["event"]]
    print(f"Goals found: {len(goals)}")
    for g in goals:
        print(f"  [{g['timestamp']}] {g['event']}")


if __name__ == "__main__":
    main()
