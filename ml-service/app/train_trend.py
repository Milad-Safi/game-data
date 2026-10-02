from __future__ import annotations

# Training pipeline for the team trend prediction model
# Builds rolling-window datasets from stored team games
# Trains a multiclass softmax logistic regression model
# Exports a JSON artifact consumed by the prediction endpoint

import datetime as dt
import json
import math
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss
from sklearn.preprocessing import StandardScaler

from .trend_db import (
    get_games,
    list_teams,
    get_team_baseline_asof_with_fallback,
    get_league_baseline_asof,
)
from .trend_features import window_features

# Label ordering used throughout training and inference
LABELS = ["DOWN", "FLAT", "UP"]


# Container for the fully assembled training dataset
# X and y are aligned row by row
# meta stores dataset-wide context for debugging and inspection
@dataclass
class TrendDataset:
    X: List[List[float]]
    y: List[int]
    feature_names: List[str]
    meta: Dict[str, Any]


# Train a multiclass softmax logistic regression model
# Uses scikit-learn but exports weights in the same JSON shape as the older NumPy version
def _train_softmax_lr(
    X: List[List[float]],
    y: List[int],
    steps: int = 3000,
    lr: float = 0.05,
    l2: float = 0.1,
    seed: int = 42,
) -> Dict[str, Any]:
    """
    Multiclass softmax logistic regression trained via scikit-learn

    Exported fields mirror the legacy model format
    - standardize.mu and standardize.sigma
    - weights shaped (F, 3)
    - bias shaped (3,)
    - training accuracy and negative log likelihood
    """
    # Standardize features so coefficients remain comparable across metrics
    scaler = StandardScaler(with_mean=True, with_std=True)
    Xs = scaler.fit_transform(X)

    # Convert L2 penalty to sklearn's inverse regularization strength
    C = 1.0 / max(float(l2), 1e-12)

    # lbfgs supports multinomial loss internally
    # multi_class is omitted to avoid version-specific crashes
    clf = LogisticRegression(
        solver="lbfgs",
        C=C,
        max_iter=max(int(steps), 100),
        random_state=seed,
    )
    clf.fit(Xs, y)

    # Transpose coefficients so shape matches exported convention
    W = clf.coef_.T
    b = clf.intercept_

    # Save standardization parameters explicitly
    mu = scaler.mean_
    sigma = scaler.scale_
    sigma = [float(s) if float(s) != 0.0 else 1.0 for s in sigma]

    # Training diagnostics
    P = clf.predict_proba(Xs)
    pred = clf.predict(Xs)
    acc = float((pred == y).mean())
    nll = float(log_loss(y, P, labels=[0, 1, 2]))

    return {
        "W": W,
        "b": b,
        "mu": mu,
        "sigma": sigma,
        "train_acc": acc,
        "train_nll": nll,
    }


# Clamp helper to keep feature transforms bounded
def _clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x




# Extra nonlinear term for extreme shot differential values
# Activates only when the differential exceeds a dead zone
def _shots_extreme_term(shot_diff_pg: float) -> float:
    dead = 8.0
    if -dead <= shot_diff_pg <= dead:
        return 0.0

    over = abs(shot_diff_pg) - dead
    raw = 0.10 * (over / 10.0)
    raw = _clamp(raw, 0.0, 0.30)
    return raw if shot_diff_pg > 0 else -raw


# Scalar heuristic score derived from a feature window
# Used only to define training labels, not as a model input
def window_score_from_features(feats: Dict[str, float]) -> float:
    gd_pg = float(feats.get("gd_pg", 0.0))
    gd_term = _clamp(gd_pg / 2.0, -1.5, 1.5)

    shot_diff_pg = float(feats.get("shot_diff_pg", 0.0))
    shot_term = _clamp(shot_diff_pg / 20.0, -1.5, 1.5)

    pp = float(feats.get("pp_pct", 0.0))
    pk = float(feats.get("pk_pct", 0.0))
    st_term = _clamp(((pp - 20.0) / 15.0) + ((pk - 80.0) / 15.0), -2.0, 2.0)

    shots_extreme = _shots_extreme_term(shot_diff_pg)

    return float(gd_term + 0.75 * shot_term + 0.5 * st_term + shots_extreme)


# Build rolling-window feature vectors and labels for a single team
# Labels compare past-window score to future-window score
def _build_windows_for_team(
    rows: List[Dict[str, Any]],
    n: int,
    k: int,
    eps: float,
    feature_names: Optional[List[str]] = None,
    *,
    opp_baseline_provider,
    league_baseline,
) -> Tuple[List[List[float]], List[int], List[str]]:
    X_list: List[List[float]] = []
    y_list: List[int] = []
    names: List[str] = feature_names or []

    total = len(rows)

    # Slide a window across the season
    for i in range(n, total - k):
        past = rows[i - n : i]
        fut = rows[i : i + k]

        # Compute aggregated features for past and future windows
        feats_p, meta_p = window_features(
            past,
            opp_baseline_provider=opp_baseline_provider,
            league_baseline=league_baseline,
        )
        feats_f, meta_f = window_features(
            fut,
            opp_baseline_provider=opp_baseline_provider,
            league_baseline=league_baseline,
        )

        # Skip windows with insufficient usable games
        if not feats_p or meta_p.get("n_used", 0) == 0:
            continue
        if not feats_f or meta_f.get("n_used", 0) == 0:
            continue

        # Lock feature ordering on first valid window
        if not names:
            names = sorted(feats_p.keys())

        # Convert feature windows into a directional label
        score_p = window_score_from_features(feats_p)
        score_f = window_score_from_features(feats_f)
        delta = score_f - score_p

        if delta <= -eps:
            label = 0
        elif delta >= eps:
            label = 2
        else:
            label = 1

        x = [float(feats_p.get(fn, 0.0)) for fn in names]
        X_list.append(x)
        y_list.append(int(label))

    return X_list, y_list, names


# Assemble the full training dataset across all teams
def build_trend_dataset(
    n: int = 10,
    k: int = 5,
    eps: float = 0.13,
    through: Optional[str] = None,
) -> TrendDataset:
    teams = list_teams()
    X_all: List[List[float]] = []
    y_all: List[int] = []
    feature_names: List[str] = []

    # League baseline used to normalize team context
    league_baseline = get_league_baseline_asof(through or dt.date.today().isoformat())

    for t in teams:
        rows = get_games(t, end_date=through)
        if len(rows) < (n + k + 2):
            continue

        # Per-team opponent baseline lookup
        def _opp_baseline_provider(opp: str, as_of: str) -> Dict[str, Any]:
            return get_team_baseline_asof_with_fallback(opp, as_of, m=10)

        X_t, y_t, feature_names = _build_windows_for_team(
            rows,
            n=n,
            k=k,
            eps=eps,
            feature_names=feature_names if feature_names else None,
            opp_baseline_provider=_opp_baseline_provider,
            league_baseline=league_baseline,
        )

        X_all.extend(X_t)
        y_all.extend(y_t)

    if not X_all or not feature_names:
        raise RuntimeError("No training rows created (not enough games or windows).")

    # Dataset metadata stored alongside the model for transparency
    meta = {
        "n": n,
        "k": k,
        "eps": eps,
        "n_rows": len(X_all),
        "class_counts": {
            "DOWN": int(sum(1 for v in y_all if v == 0)),
            "FLAT": int(sum(1 for v in y_all if v == 1)),
            "UP": int(sum(1 for v in y_all if v == 2)),
        },
        "through": through,
        "teams_used": len(teams),
    }

    return TrendDataset(X=X_all, y=y_all, feature_names=feature_names, meta=meta)


# High-level training entry point
# Produces and saves the final JSON model artifact
def train_trend(
    n: int = 9,
    k: int = 5,
    eps: float = 0.11,
    through: Optional[str] = None,
    steps: int = 4000,
    lr: float = 0.05,
    l2: float = 0.2,
) -> Dict[str, Any]:
    ds = build_trend_dataset(n=n, k=k, eps=eps, through=through)
    fit = _train_softmax_lr(ds.X, ds.y, steps=steps, lr=lr, l2=l2)

    model = {
        "kind": "softmax_logreg",
        "labels": LABELS,
        "feature_names": ds.feature_names,
        "standardize": {
            "mu": list(fit["mu"]),
            "sigma": list(fit["sigma"]),
        },
        "weights": fit["W"].tolist(),
        "bias": fit["b"].tolist(),
        "train": {
            "steps": steps,
            "lr": lr,
            "l2": l2,
            "train_acc": fit["train_acc"],
            "train_nll": fit["train_nll"],
        },
        "dataset": ds.meta,
        "trained_at": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    }

    # Persist model artifact for inference
    os.makedirs("app/models", exist_ok=True)
    path = "app/models/trend_model.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(model, f, indent=2)

    return {"ok": True, "saved_to": path, "model": model}


# Allow local execution for manual retraining
if __name__ == "__main__":
    out = train_trend()
    print(out["saved_to"])
