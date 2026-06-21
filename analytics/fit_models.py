"""Fit xT and VAEP on a training set of Euro 2020 StatsBomb open-data matches.

Run once (or whenever TRAIN_MATCH_IDS changes):
    source .venv/bin/activate && python fit_models.py

Caches fitted models to analytics/cache/{xt,vaep}_model.pkl so
build_state_frames.py can load them without refitting.
"""
from __future__ import annotations

import pickle
import warnings
from pathlib import Path

import pandas as pd

from statsbomb_pipeline import CACHE_DIR, game_series, load_match_actions

# Euro 2020 group-stage matches (excludes the target match 3788741, Turkey vs
# Italy, which is reserved as the held-out match build_state_frames.py rates).
TRAIN_MATCH_IDS = [
    3788758,  # Ukraine vs North Macedonia
    3788773,  # Portugal vs France
    3788765,  # Switzerland vs Turkey
    3788761,  # Sweden vs Slovakia
    3788760,  # Croatia vs Czech Republic
    3794687,  # Belgium vs Portugal
    3794690,  # Netherlands vs Czech Republic
    3794685,  # Italy vs Austria
    3794692,  # Sweden vs Ukraine
    3794689,  # Wales vs Denmark
]

XT_MODEL_PATH = CACHE_DIR / "xt_model.pkl"
VAEP_MODEL_PATH = CACHE_DIR / "vaep_model.pkl"


def fit_xt(train_ids: list[int]):
    from socceraction.xthreat import ExpectedThreat
    import socceraction.spadl as spadl

    all_actions = []
    for match_id in train_ids:
        actions, meta = load_match_actions(match_id)
        all_actions.append(spadl.play_left_to_right(actions, meta["home_team_id"]))
    combined = pd.concat(all_actions, ignore_index=True)

    model = ExpectedThreat()
    model.fit(combined)
    return model


def fit_vaep(train_ids: list[int]):
    from socceraction.vaep import VAEP

    model = VAEP(nb_prev_actions=3)
    features, labels = [], []
    for match_id in train_ids:
        actions, meta = load_match_actions(match_id)
        game = game_series(meta)
        features.append(model.compute_features(game, actions))
        labels.append(model.compute_labels(game, actions))
    X = pd.concat(features, ignore_index=True)
    y = pd.concat(labels, ignore_index=True)
    model.fit(X, y)
    return model


def main():
    print(f"Fitting xT and VAEP on {len(TRAIN_MATCH_IDS)} Euro 2020 matches...")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        xt_model = fit_xt(TRAIN_MATCH_IDS)
        print("xT fitted.")
        vaep_model = fit_vaep(TRAIN_MATCH_IDS)
        print("VAEP fitted.")

    with open(XT_MODEL_PATH, "wb") as f:
        pickle.dump(xt_model, f)
    with open(VAEP_MODEL_PATH, "wb") as f:
        pickle.dump(vaep_model, f)
    print(f"Saved {XT_MODEL_PATH} and {VAEP_MODEL_PATH}")


if __name__ == "__main__":
    main()
