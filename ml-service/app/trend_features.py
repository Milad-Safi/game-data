from __future__ import annotations

# Feature builder for the trend model
# Input is a window of team_games rows and output is a flat numeric feature dict
# This stays pure Python so training and inference both share the exact same math

from typing import Any, Callable, Dict, List, Optional, Tuple



def _safe_div(a: float, b: float) -> Optional[float]:
    # Divide with a guard so division by zero returns None
    if b == 0:
        return None
    return a / b


def _linear_slope(values: List[float]) -> float:
    """
    Least-squares slope over x = 1..N
    I use this to measure recent momentum in goal diff and shot diff
    If N < 2 or x variance is zero, slope returns 0.0
    """
    n = len(values)
    if n < 2:
        return 0.0

    # x is a simple timeline index 1..n
    xs = list(range(1, n + 1))
    x_mean = sum(xs) / n
    y_mean = sum(values) / n

    # slope = cov(x,y) / var(x)
    num = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, values))
    den = sum((x - x_mean) ** 2 for x in xs)

    if den == 0:
        return 0.0

    return num / den


def _clamp(x: float, lo: float, hi: float) -> float:
    # Clamp into a range so weird inputs do not explode downstream
    return max(lo, min(hi, x))


def window_features(
    rows_desc: List[Dict[str, Any]],
    *,
    # Option B inputs
    # If a baseline provider is passed, this adds "relative to opponent expectations" features
    # provider signature: provider(opponent_team, as_of_date_iso) -> dict with:
    # gf_pg, ga_pg, sf_pg, sa_pg, pp_pct, pk_pct, games_used (int), optional fallback tag
    opp_baseline_provider: Optional[Callable[[str, str], Dict[str, Any]]] = None,
    # Minimum opponent prior games before trusting that opponent baseline
    min_opp_games: int = 5,
    # League averages can be used as neutral fallback when opponent baseline is unstable
    league_baseline: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, float], Dict[str, Any]]:
    """
    rows_desc is last-N rows in DESC order (newest first)
    Returns (features, meta)

    Important rules baked in here
    - goalie_sv_pct is not used at all
    - special teams use a sentinel -1.0 when missing
    - if opp_baseline_provider is None, only raw window features are produced
    - if opp_baseline_provider exists, relative features are added (Option B)
    """
    if not rows_desc:
        # No games means no features
        return {}, {"range": None, "n_used": 0}

    # Convert to chronological order (oldest -> newest) so slope math makes sense
    rows = list(reversed(rows_desc))
    n = len(rows)

    # Window totals
    gf = sum(float(r.get("goals_for") or 0) for r in rows)
    ga = sum(float(r.get("goals_against") or 0) for r in rows)
    sf = sum(float(r.get("shots_for") or 0) for r in rows)
    sa = sum(float(r.get("shots_against") or 0) for r in rows)

    # Special teams totals
    pp_goals = sum(float(r.get("pp_goals") or 0) for r in rows)
    pp_opps = sum(float(r.get("pp_opps") or 0) for r in rows)
    pk_ga = sum(float(r.get("pk_goals_against") or 0) for r in rows)
    pk_opps = sum(float(r.get("pk_opps") or 0) for r in rows)

    # Per-game sequences for slope features
    gd_vals = [
        float(r.get("goals_for") or 0) - float(r.get("goals_against") or 0)
        for r in rows
    ]
    shot_diff_vals = [
        float(r.get("shots_for") or 0) - float(r.get("shots_against") or 0)
        for r in rows
    ]

    # PP% and PK% as decimals 0..1, or None if not computable
    pp_pct = _safe_div(pp_goals, pp_opps)

    # PK% = 1 - (PP goals allowed / PP opportunities faced)
    pk_pct = (1.0 - _safe_div(pk_ga, pk_opps)) if pk_opps > 0 else None

    # Home rate in the window
    home_count = sum(1 for r in rows if bool(r.get("is_home")))
    home_rate = home_count / n

    # Date range in this window
    newest = str(max(r.get("game_date") for r in rows))
    oldest = str(min(r.get("game_date") for r in rows))

    # Base feature set (raw window stats)
    feats: Dict[str, float] = {
        # Goal diff per game
        "gd_pg": (gf - ga) / n,

        # Core per-game rates
        "gf_pg": gf / n,
        "ga_pg": ga / n,
        "sf_pg": sf / n,
        "sa_pg": sa / n,

        # Shot diff per game
        "shot_diff_pg": (sf - sa) / n,

        # Shot share uses total window shots for a stable fraction
        "shot_share": (sf / (sf + sa)) if (sf + sa) > 0 else 0.0,

        # Sentinel -1.0 is used when special teams cannot be computed
        "pp_pct": float(pp_pct) if pp_pct is not None else -1.0,
        "pk_pct": float(pk_pct) if pk_pct is not None else -1.0,

        # Context feature for home-heavy windows
        "home_rate": float(home_rate),

        # Momentum features
        "gd_slope": float(_linear_slope(gd_vals)),
        "shot_diff_slope": float(_linear_slope(shot_diff_vals)),
    }

    if opp_baseline_provider is not None:
        # League baseline is optional, used only when opponent baseline is unstable
        lf = league_baseline or {}

        # Per-game deltas get averaged at the end
        rel_gf_vals: List[float] = []
        rel_ga_vals: List[float] = []
        rel_sf_vals: List[float] = []
        rel_sa_vals: List[float] = []
        rel_share_vals: List[float] = []
        rel_pp_delta_vals: List[float] = []
        rel_pk_delta_vals: List[float] = []
        opp_strength_vals: List[float] = []

        for r in rows:
            # Opponent and date define which baseline to fetch
            opp = str(r.get("opponent") or "")
            game_date = str(r.get("game_date") or "")

            # Baseline is pulled strictly before game_date by the provider
            b = opp_baseline_provider(opp, game_date) or {}
            games_used = int(b.get("games_used") or 0)

            # Context strength is a 0..1 score based on opponent baseline sample size
            opp_strength_vals.append(
                _clamp(games_used / float(max(1, min_opp_games)), 0.0, 1.0)
            )

            # If opponent has too few prior games, fall back to league averages when available
            use = b
            if games_used < min_opp_games and lf:
                use = {
                    "gf_pg": lf.get("gf_pg"),
                    "ga_pg": lf.get("ga_pg"),
                    "sf_pg": lf.get("sf_pg"),
                    "sa_pg": lf.get("sa_pg"),
                    "pp_pct": lf.get("pp_pct"),
                    "pk_pct": lf.get("pk_pct"),
                }

            # Expectations mapping
            # Opponent ga_pg and sa_pg are what the opponent usually allows
            # That becomes expected gf and sf for this team in this matchup
            # Opponent gf_pg and sf_pg are what the opponent usually creates
            # That becomes expected ga and sa for this team in this matchup
            exp_gf = use.get("ga_pg")
            exp_ga = use.get("gf_pg")
            exp_sf = use.get("sa_pg")
            exp_sa = use.get("sf_pg")

            team_gf = float(r.get("goals_for") or 0)
            team_ga = float(r.get("goals_against") or 0)
            team_sf = float(r.get("shots_for") or 0)
            team_sa = float(r.get("shots_against") or 0)

            # Per-game deltas vs expectations
            rel_gf_vals.append(team_gf - float(exp_gf) if exp_gf is not None else 0.0)
            rel_ga_vals.append(team_ga - float(exp_ga) if exp_ga is not None else 0.0)
            rel_sf_vals.append(team_sf - float(exp_sf) if exp_sf is not None else 0.0)
            rel_sa_vals.append(team_sa - float(exp_sa) if exp_sa is not None else 0.0)

            # Relative shot share compares observed share vs expected share
            rel_share = 0.0
            if exp_sf is not None and exp_sa is not None:
                denom = float(exp_sf) + float(exp_sa)
                if denom > 0:
                    exp_share = float(exp_sf) / denom
                    obs_share = (
                        team_sf / (team_sf + team_sa)
                        if (team_sf + team_sa) > 0
                        else 0.0
                    )
                    rel_share = obs_share - exp_share
            rel_share_vals.append(rel_share)

            # Game-level PP/PK deltas vs opponent baseline
            g_pp_goals = float(r.get("pp_goals") or 0)
            g_pp_opps = float(r.get("pp_opps") or 0)
            g_pk_ga = float(r.get("pk_goals_against") or 0)
            g_pk_opps = float(r.get("pk_opps") or 0)

            g_pp_pct = _safe_div(g_pp_goals, g_pp_opps)
            g_pk_pct = (1.0 - _safe_div(g_pk_ga, g_pk_opps)) if g_pk_opps > 0 else None

            # Opponent PK% is the expected resistance against this PP
            # Opponent PP% is the expected threat against this PK
            opp_pk = use.get("pk_pct")
            opp_pp = use.get("pp_pct")

            rel_pp_delta_vals.append(
                (float(g_pp_pct) - float(opp_pk))
                if (g_pp_pct is not None and opp_pk is not None)
                else 0.0
            )
            rel_pk_delta_vals.append(
                (float(g_pk_pct) - float(opp_pp))
                if (g_pk_pct is not None and opp_pp is not None)
                else 0.0
            )

        # Window averages for relative features
        rel_gf_pg = sum(rel_gf_vals) / n
        rel_ga_pg = sum(rel_ga_vals) / n
        rel_sf_pg = sum(rel_sf_vals) / n
        rel_sa_pg = sum(rel_sa_vals) / n

        feats.update(
            {
                # Relative deltas per game
                "rel_gf_pg": float(rel_gf_pg),
                "rel_ga_pg": float(rel_ga_pg),

                # Relative goal diff per game
                "rel_gd_pg": float(rel_gf_pg - rel_ga_pg),

                # Relative shot diff per game
                "rel_shot_diff_pg": float(rel_sf_pg - rel_sa_pg),

                # Relative shot share delta
                "rel_shot_share": float(sum(rel_share_vals) / n) if rel_share_vals else 0.0,

                # Special teams deltas
                "rel_pp_delta": float(sum(rel_pp_delta_vals) / n) if rel_pp_delta_vals else 0.0,
                "rel_pk_delta": float(sum(rel_pk_delta_vals) / n) if rel_pk_delta_vals else 0.0,

                # Context strength average across the window
                "opp_ctx_strength": float(sum(opp_strength_vals) / n) if opp_strength_vals else 0.0,
            }
        )

    # Meta is used for debugging and for tracking the effective window range
    meta = {"range": {"newest": newest, "oldest": oldest}, "n_used": n}
    return feats, meta
