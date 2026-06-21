"""Shared helpers: StatsBomb open-data → SPADL, with on-disk caching.

Requires the analytics/.venv (Python 3.12 — socceraction pins <3.13).
See analytics/requirements.txt.
"""
from __future__ import annotations

import warnings
from pathlib import Path

import pandas as pd

CACHE_DIR = Path(__file__).parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)


def load_match_actions(match_id: int) -> tuple[pd.DataFrame, dict]:
    """Return (SPADL actions df, match meta) for a StatsBomb open-data match.

    meta = {"home_team_id", "team_names": {id: name}, "player_names": {id: name},
            "home_team_name", "away_team_name"}
    Cached on disk so repeated runs don't re-download/re-convert.

    NOTE: team_id/player_id in the SPADL frame are strings (e.g. "909"), not
    ints — meta keeps them as strings too so comparisons against
    actions.team_id (used by play_left_to_right / VAEP) actually match.
    """
    actions_cache = CACHE_DIR / f"actions_{match_id}.pkl"
    meta_cache = CACHE_DIR / f"meta_{match_id}.json"
    if actions_cache.exists() and meta_cache.exists():
        import json

        actions = pd.read_pickle(actions_cache)
        meta = json.loads(meta_cache.read_text())
        return actions, meta

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        from kloppy import statsbomb
        import socceraction.spadl as spadl
        import socceraction.spadl.kloppy as sk

        dataset = statsbomb.load_open_data(match_id=match_id)
        # Period 5 (penalty shootout, when present) has no "attacking direction"
        # — kloppy's coordinate transform raises OrientationError on it. Shootout
        # kicks aren't open-play actions anyway, so drop them before conversion.
        dataset = dataset.filter(lambda e: e.period.id != 5)
        actions = sk.convert_to_actions(dataset, game_id=match_id)
        actions = spadl.add_names(actions)

        teams = dataset.metadata.teams
        team_names = {str(t.team_id): t.name for t in teams}
        player_names = {
            str(p.player_id): p.name for t in teams for p in t.players
        }
        home_team = next(t for t in teams if t.ground.value == "home")
        away_team = next(t for t in teams if t is not home_team)
        meta = {
            "match_id": match_id,
            "home_team_id": str(home_team.team_id),
            "away_team_id": str(away_team.team_id),
            "home_team_name": home_team.name,
            "away_team_name": away_team.name,
            "team_names": team_names,
            "player_names": player_names,
        }

    actions.to_pickle(actions_cache)
    import json

    meta_cache.write_text(json.dumps(meta))
    return actions, meta


def game_series(meta: dict) -> pd.Series:
    """Minimal `game` row VAEP/xT helpers expect (only home_team_id is read)."""
    return pd.Series({"game_id": meta["match_id"], "home_team_id": meta["home_team_id"]})
