from __future__ import annotations

# Trend inference (prediction) code
# Loads the saved softmax logistic regression model JSON
# Pulls last N games from DB, builds the exact same feature vector used in training
# Standardizes features, runs a linear layer, then softmax to get probabilities

import json
from pathlib import Path
from typing import Any, Dict

from sklearn.utils.extmath import softmax

from .trend_db import (
    get_last_n,
    get_team_baseline_asof_with_fallback,
)
from .trend_features import window_features


def _softmax1(z: list[float]) -> list[float]:
    """
    Softmax for one vector of logits
    call sklearn's softmax since it handles numerical stability
    """
    return softmax([z])[0].tolist()


def load_trend_model(path: str = "app/models/trend_model.json") -> Dict[str, Any]:
    """
    Loads the saved model JSON into a dict

    The default argument uses the repo-style path "app/models/trend_model.json"
    That can break in production when the working directory is different
    """
    p = Path(path)

    # If the caller passed the default path string OR the file is not found,
    # fall back to resolving "models/trend_model.json" next to this module
    if path == "app/models/trend_model.json" or not p.exists():
        base_dir = Path(__file__).resolve().parent
        p = base_dir / "models" / "trend_model.json"

    # Read and parse JSON from disk
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def predict_team_trend(
    team: str,
    as_of: str,
    n: int = 5,
    model_path: str = "app/models/trend_model.json",
) -> Dict[str, Any]:
    # Predicts a trend label for a team "as of" a specific date

    # Load weights, standardization params, and feature order from JSON
    model = load_trend_model(model_path)


    rows = get_last_n(team, as_of, n=n)

    # window_features needs an opponent baseline provider for Option B features

    # The DB baseline helper requires m
    # Passing m=10 matches training and fixes prod crash from missing argument
    def opp_provider(opp: str, as_of_for_opp: str) -> Dict[str, Any]:
        # Baseline uses opponent's last 10 games strictly before as_of_for_opp
        # If opponent has too few games, function falls back to league baseline internally
        return get_team_baseline_asof_with_fallback(opp, as_of_for_opp, m=10)

    # Build feature dict from the last-N window
    feats, meta = window_features(
        rows,
        opp_baseline_provider=opp_provider,
    )

    # If there are not enough games, return a "no prediction" payload
    if not feats or meta["n_used"] == 0:
        return {
            "team": team,
            "as_of": as_of,
            "n_requested": n,
            "n_used": 0,
            "range": None,
            "trend": None,
            "confidence": None,
            "probs": None,
            "features": None,
            "note": "Not enough games before as_of to compute trend.",
        }

    # The model stores the exact feature order used during training
    # Build x in that order, defaulting missing features to 0.0
    feature_names = model["feature_names"]
    x = [float(feats.get(fn, 0.0)) for fn in feature_names]

    # Standardize using training-time mean and stddev
    # xs[i] = (x[i] - mu[i]) / sigma[i]
    mu = [float(v) for v in model["standardize"]["mu"]]
    sigma = [float(v) for v in model["standardize"]["sigma"]]
    xs = [(xi - mi) / si for xi, mi, si in zip(x, mu, sigma)]

    # Pull linear layer params from JSON
    # weights is stored as shape (F, 3) and bias is shape (3,)
    W = model["weights"]
    b = model["bias"]

    # Compute logits for each class
    # logits[j] = sum_i xs[i] * W[i][j] + b[j]
    logits = [
        sum(xs[i] * float(W[i][j]) for i in range(len(xs))) + float(b[j])
        for j in range(3)
    ]

    # Convert logits into probabilities with softmax
    p = _softmax1(logits)

    # Pick the class with the max probability
    labels = model["labels"]
    idx = int(max(range(len(p)), key=lambda i: p[i]))
    trend = labels[idx]
    confidence = float(p[idx])

    # Keep all class probabilities for UI and debugging
    probs = {labels[i]: float(p[i]) for i in range(len(labels))}

    # Return a single payload the frontend can render
    return {
        "team": team,
        "as_of": as_of,
        "n_requested": n,
        "n_used": meta["n_used"],
        "range": meta["range"],
        "trend": trend,
        "confidence": confidence,
        "probs": probs,
        "features": feats,
        "model_info": {
            # trained_at is the timestamp saved when train_trend wrote the JSON
            "trained_at": model.get("trained_at"),
            # dataset meta is saved by the trainer so inference can report settings
            "n": model.get("dataset", {}).get("n"),
            "k": model.get("dataset", {}).get("k"),
            "eps": model.get("dataset", {}).get("eps"),
        },
    }
