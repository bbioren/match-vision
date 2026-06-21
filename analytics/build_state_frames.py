"""Walk SPADL actions for a StatsBomb open-data match and emit a JSON list of
"moment" objects matching the schema used by the live VLM pipeline
(src/services/match-context.js `interpretMoment()` /
src/services/match-memory.js `formatMemory()`), plus extra ground-truth
fields (expected_threat_delta, action_vaep_value, momentum, urgency_level).

Run (from analytics/, with the venv active):
    source .venv/bin/activate && python build_state_frames.py
    source .venv/bin/activate && python build_state_frames.py --match-id 3869685 --out ../data/analytics/argentina_vs_france_wc2022_final_timeline.json

Default (no args): match 3788741, Turkey vs Italy, Euro 2020 group stage.
Writes ../data/analytics/turkey_vs_italy_euro2020_timeline.json

--- Period durations are real, not assumed -----------------------------------
Periods are NOT fixed-length. A Euro 2020 group match runs ~52 real minutes
in period 1 due to stoppage time; a World Cup final with extra time has four
periods (1-2 regular, 3-4 extra time), each a different real length. atSecond
is computed as a true continuous match clock by summing each prior period's
*observed* duration (max time_seconds seen in that period), not a hardcoded
45-minutes-per-period assumption.

Penalty shootouts (period 5, when present) are filtered out upstream in
statsbomb_pipeline.py before SPADL conversion — kloppy's coordinate
transform has no "attacking direction" concept for shootout kicks.

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

import argparse
import json
import pickle
from pathlib import Path

import pandas as pd

from statsbomb_pipeline import CACHE_DIR, game_series, load_match_actions

DEFAULT_MATCH_ID = 3788741  # Turkey vs Italy, Euro 2020
FIELD_LENGTH = 105.0
FIELD_WIDTH = 68.0
MIDFIELD_X = FIELD_LENGTH / 2  # 52.5

DEFAULT_OUT_PATH = Path(__file__).parent.parent / "data" / "analytics" / "turkey_vs_italy_euro2020_timeline.json"

XT_MODEL_PATH = CACHE_DIR / "xt_model.pkl"
VAEP_MODEL_PATH = CACHE_DIR / "vaep_model.pkl"

MOMENTUM_WINDOW_SECONDS = 60
URGENCY_XT_THRESHOLD = 0.10
SHOT_TYPES = {"shot", "shot_penalty", "shot_freekick"}
GOAL_RESULT = "success"

# StatsBomb gives full legal names (e.g. "Lionel Andrés Messi Cuccittini"),
# but fans/broadcasters use a common name that often is NOT just "last word"
# (Spanish/Portuguese naming order means the recognized surname is frequently
# in the middle, e.g. "Di María" not "Hernández"; some players go by a
# nickname entirely, e.g. "Jorginho", "Dibu Martínez"). No generic string
# rule gets this right — hand-mapped per player_id for the two rosters here.
# Disambiguation kept (first name or nickname) only where a roster has two
# players sharing a surname (e.g. three Martínez in the 2022 Argentina squad).
COMMON_NAME_OVERRIDES = {
    # Argentina vs France, 2022 World Cup Final (match 3869685)
    "2995": "Di María",
    "3090": "Otamendi",
    "5503": "Messi",
    "5507": "Tagliafico",
    "5743": "Dybala",
    "6312": "Armani",
    "6377": "Correa",
    "6694": "Rulli",
    "6909": "Dibu Martínez",
    "7006": "Papu Gómez",
    "7161": "Pezzella",
    "7797": "De Paul",
    "11456": "Lautaro Martínez",
    "16308": "Paredes",
    "19597": "Acuña",
    "20572": "Romero",
    "21081": "Foyth",
    "26404": "Rodríguez",
    "27768": "Lisandro Martínez",
    "27886": "Mac Allister",
    "28263": "Montiel",
    "28268": "Palacios",
    "28637": "Almada",
    "29201": "Molina",
    "29560": "Álvarez",
    "38718": "Enzo Fernández",
    "2972": "Thuram",
    "3009": "Mbappé",
    "3026": "Rabiot",
    "3099": "Lloris",
    "3379": "Areola",
    "3543": "Mandanda",
    "3604": "Giroud",
    "4445": "Koundé",
    "5476": "Pavard",
    "5477": "Dembélé",
    "5485": "Varane",
    "5487": "Griezmann",
    "6704": "Theo Hernández",
    "7153": "Veretout",
    "7345": "Guendouzi",
    "7439": "Disasi",
    "8217": "Coman",
    "8519": "Upamecano",
    "10481": "Tchouaméni",
    "11135": "Konaté",
    "11990": "Fofana",
    "17592": "Saliba",
    "22097": "Kolo Muani",
    "24778": "Camavinga",
    # Turkey vs Italy, Euro 2020 (match 3788741) — most names are already
    # broadcast-style; only the Brazilian-Italians and one nickname differ.
    "4355": "Emerson Palmieri",
    "7024": "Jorginho",
}


# ── Period-aware attacking direction ─────────────────────────────────────────

def compute_attacking_right(actions: pd.DataFrame) -> dict[tuple[str, int], bool]:
    """For each (team_id, period_id), decide whether that team attacks toward
    increasing x ("right") in that period, using the median end_x of that
    team's shots in that period as the signal (shots cluster near the goal
    being attacked, regardless of which side of the pitch the broadcast shows
    as "home" that half).

    If a team has no shots in a period (e.g. it spent the whole half
    defending deep, like Turkey in period 1 of the Euro 2020 opener — 0
    shots), its direction is set to the OPPOSITE of the other team's
    shot-derived direction in that same period. This is a hard constraint of
    the sport (two teams in the same period always attack opposite ends), and
    far more reliable than a team's own mean field position: a team parked in
    a low block has a low mean start_x because it's under sustained pressure
    in its own half, not because of which goal it's attacking when it does
    get the ball forward — using its own mean position as a fallback (the
    previous approach here) gave Turkey "attacking left" in period 1, when in
    fact Italy's 14 shots that period clearly show Italy attacking left,
    which means Turkey — defending that goal — was attacking RIGHT.

    Only if NEITHER team in a period has any shots (true edge case) does this
    fall back to comparing mean start_x between the two teams.
    """
    shots = actions[actions["type_name"].isin(SHOT_TYPES)]
    result: dict[tuple[str, int], bool] = {}

    for (team_id, period_id), group in shots.groupby(["team_id", "period_id"]):
        median_end_x = group["end_x"].median()
        result[(str(team_id), int(period_id))] = bool(median_end_x > MIDFIELD_X)

    team_ids = sorted(actions["team_id"].unique(), key=str)
    period_ids = sorted(actions["period_id"].unique())

    # Fill in any team with no shots in a period as the opposite of the other
    # team's shot-derived direction in that same period.
    for period_id in period_ids:
        known = {tid: result[(tid, period_id)] for tid in team_ids if (tid, period_id) in result}
        if len(known) == 1:
            known_team, known_right = next(iter(known.items()))
            for team_id in team_ids:
                if team_id != known_team:
                    result[(str(team_id), int(period_id))] = not known_right

    # True edge case: neither team had a single shot in this period. Fall
    # back to comparing mean start_x (weak signal, better than nothing).
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


REGULATION_PERIOD_LENGTH_SECONDS = 45 * 60  # nominal half length
ET_PERIOD_LENGTH_SECONDS = 15 * 60  # nominal extra-time period length

def compute_period_offsets(actions: pd.DataFrame) -> dict[int, float]:
    """Offset for the START of each period, using FIFA's NOMINAL period bases
    (0:00, 45:00, 90:00, 105:00, ...) rather than each prior period's actual
    observed duration.

    This took two rounds to get right, both confirmed against real broadcast
    clock overlays for the 2022 final:

    1. Extra-time periods (3+) are always labeled from a fixed base (91:00,
       106:00) regardless of how much stoppage piled up in regulation —
       NOT continuing from wherever regulation's accumulated stoppage left
       off. Using a continuous-duration model overestimated ET timestamps by
       10-15 minutes (Mbappé's title-deciding penalty computed as ~134:07
       here, but the broadcast showed 119:44 at that exact video frame).

    2. The SAME convention applies between halves 1 and 2, not just into
       extra time: second-half clocks reset to a nominal 45:00 base and do
       NOT carry forward the first half's added time. E.g. half 1 ran
       45:00+7:21 (~52:21) of real stoppage-inclusive time, but half 2's
       clock was observed at 55:01 and 56:41 a few minutes into the second
       half — only explainable if half 2 is based at 45:00, not 52:21.

    Each period's OWN stoppage time still accumulates within that period
    (shown as e.g. "45:00 +7:21" near its end) — it just doesn't shift the
    *next* period's base.
    """
    period_ids = sorted(actions["period_id"].unique())
    offsets: dict[int, float] = {}
    for p in period_ids:
        if p <= 2:
            offsets[p] = REGULATION_PERIOD_LENGTH_SECONDS * (p - 1)
        else:
            offsets[p] = 2 * REGULATION_PERIOD_LENGTH_SECONDS + ET_PERIOD_LENGTH_SECONDS * (p - 3)
    return offsets


def format_timestamp(total_seconds: float) -> str:
    minute = int(total_seconds // 60)
    second = int(total_seconds % 60)
    return f"{minute:02d}:{second:02d}"


def at_second(period_id: int, time_seconds: float, period_offsets: dict[int, float]) -> int:
    return int(period_offsets[period_id] + time_seconds)


def build_timeline(match_id: int, out_path: Path, window_start: int | None = None, window_end: int | None = None, window_period: int | None = None):
    print(f"Loading actions for match {match_id}...")
    actions, meta = load_match_actions(match_id)
    team_names = meta["team_names"]
    player_names = {pid: COMMON_NAME_OVERRIDES.get(pid, name) for pid, name in meta["player_names"].items()}
    period_offsets = compute_period_offsets(actions)
    print("Period offsets (real seconds from kickoff):", period_offsets)

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
        sec = at_second(period_id, float(row["time_seconds"]), period_offsets)

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
            "timestamp": format_timestamp(sec),
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

    # Momentum is a rolling window over ALL preceding actions, computed above
    # before any windowing, so a trimmed clip still carries correct momentum
    # context into its first moments rather than starting artificially at 0.
    #
    # IMPORTANT: under the nominal-base period model, atSecond ranges OVERLAP
    # across periods — e.g. period 1 stoppage time can reach atSecond ~3144
    # (45:00 + ~7:24 added time), which numerically falls inside period 2's
    # nominal range (2700-3000 = minutes 45-50). Filtering by atSecond alone
    # would silently let period-1 stoppage actions leak into a "period 2"
    # window, so window_period (match_half) must also be checked when given.
    if window_start is not None or window_end is not None:
        lo = window_start if window_start is not None else 0
        hi = window_end if window_end is not None else float("inf")
        moments = [
            m for m in moments
            if lo <= m["atSecond"] <= hi and (window_period is None or m["match_half"] == window_period)
        ]
        for m in moments:
            m["atSecond"] -= lo  # rebase to the trimmed video's own t=0; timestamp keeps the real match-clock label

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(moments, indent=2))
    print(f"\nWrote {len(moments)} moments -> {out_path}")

    goals = [m for m in moments if m["danger_level"] == "high" and "GOAL" in m["event"]]
    print(f"Goals found: {len(goals)}")
    for g in goals:
        print(f"  [{g['timestamp']}] {g['event']}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--match-id", type=int, default=DEFAULT_MATCH_ID)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--window-start", type=int, default=None, help="atSecond (match-clock) to start the window at; output is rebased to 0")
    parser.add_argument("--window-end", type=int, default=None, help="atSecond (match-clock) to end the window at")
    parser.add_argument("--window-period", type=int, default=None, help="match_half to restrict the window to (required when window atSecond ranges could overlap across periods)")
    args = parser.parse_args()
    out_path = args.out or (
        DEFAULT_OUT_PATH if args.match_id == DEFAULT_MATCH_ID
        else Path(__file__).parent.parent / "data" / "analytics" / f"match_{args.match_id}_timeline.json"
    )
    build_timeline(args.match_id, out_path, window_start=args.window_start, window_end=args.window_end, window_period=args.window_period)


if __name__ == "__main__":
    main()
