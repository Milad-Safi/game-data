from __future__ import annotations

# DB access helpers for trend training + inference
# Pulls team_games rows in the exact shapes the feature builder expects
# Also computes rolling opponent baselines and league fallback baselines
# Uses simple in-process caches to avoid re-querying the same baselines

from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text

from .db import engine
from .season import query_season_year


def _regular_season_condition(alias: str = "tg") -> str:
    # NHL game_id format: YYYYTTNNNN where TT == 02 means regular season
    # This condition extracts TT using integer math
    # (game_id // 10000) removes the last 4 digits, then % 100 grabs TT
    return f"((CAST({alias}.game_id / 10000 AS INTEGER) % 100) = 2)"


def list_teams() -> List[str]:
    # Return all distinct team abbreviations present in the DB
    # Only includes regular-season rows based on game_id TT == 02
    q = text(
        f"""
        SELECT DISTINCT team
        FROM team_games tg
        WHERE {_regular_season_condition("tg")}
        ORDER BY team
        """
    )
    with engine.connect() as conn:
        rows = conn.execute(q).mappings().all()
    return [str(r["team"]) for r in rows]


def get_games(
    team: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Full game log for one team, chronological order (ASC)
    Only pulls regular season games
    Used mostly by training because training needs an ordered timeline
    """
    where = ["tg.team = :team", _regular_season_condition("tg")]
    params: Dict[str, Any] = {"team": team}

    # Optional date range filters
    if start_date:
        where.append("tg.game_date >= :start_date")
        params["start_date"] = start_date
    if end_date:
        where.append("tg.game_date <= :end_date")
        params["end_date"] = end_date

    # Include opponent and goalie_sv_pct in case other feature sets want it later
    # Trend features can ignore goalie_sv_pct without needing schema changes
    q = text(
        f"""
        SELECT
            tg.game_id,
            tg.game_date,
            tg.is_home,
            tg.opponent,
            tg.goals_for,
            tg.goals_against,
            tg.shots_for,
            tg.shots_against,
            tg.pp_goals,
            tg.pp_opps,
            tg.pk_goals_against,
            tg.pk_opps,
            tg.goalie_sv_pct,
            tg.win
        FROM team_games tg
        WHERE {" AND ".join(where)}
        ORDER BY tg.game_date ASC, tg.game_id ASC
        """
    )

    with engine.connect() as conn:
        rows = conn.execute(q, params).mappings().all()

    # Convert SQLAlchemy RowMapping to plain dict so downstream code stays simple
    return [dict(r) for r in rows]


def get_last_n(team: str, as_of: str, n: int) -> List[Dict[str, Any]]:
    """
    Last N games strictly BEFORE as_of
    Returned in DESC order (newest first) because that is convenient for UI/debugging
    Regular season only
    """
    q = text(
        f"""
        SELECT
            tg.game_id,
            tg.game_date,
            tg.is_home,
            tg.opponent,
            tg.goals_for,
            tg.goals_against,
            tg.shots_for,
            tg.shots_against,
            tg.pp_goals,
            tg.pp_opps,
            tg.pk_goals_against,
            tg.pk_opps,
            tg.goalie_sv_pct,
            tg.win
        FROM team_games tg
        WHERE tg.team = :team
          AND tg.game_date < :as_of
          AND CAST(tg.game_id / 1000000 AS INTEGER) = :season_year
          AND {_regular_season_condition("tg")}
        ORDER BY tg.game_date DESC, tg.game_id DESC
        LIMIT :n
        """
    )
    with engine.connect() as conn:
        rows = conn.execute(q, {"team": team, "as_of": as_of, "n": n, "season_year": query_season_year(as_of)}).mappings().all()
    return [dict(r) for r in rows]




# -------------------------------------------------------------------
# Baselines used by feature engineering
# Baseline concept: what a team "normally" does per game around a date
# Opponent baseline is used to build relative features like rel_gf_pg
# League baseline is used when an opponent has too few games (early season)
# In-process caching avoids repeating identical queries during training
# -------------------------------------------------------------------

# Cache key is (team, as_of, m)
_BASELINE_CACHE: Dict[Tuple[str, str, int], Dict[str, Any]] = {}

# League cache key is as_of string
_LEAGUE_CACHE: Dict[str, Dict[str, Any]] = {}


def _pct_or_none(numer: float, denom: float) -> Optional[float]:
    # Return a safe ratio, avoiding divide-by-zero
    if denom <= 0:
        return None
    return float(numer) / float(denom)


def _aggregate_baseline(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Turn a list of game rows into baseline expectations
    Output is per-game averages and special teams rates
    goalie_sv_pct is intentionally not part of baseline
    """
    n = len(rows)
    if n == 0:
        return {
            "games_used": 0,
            "gf_pg": None,
            "ga_pg": None,
            "sf_pg": None,
            "sa_pg": None,
            "pp_pct": None,
            "pk_pct": None,
        }

    # Sum raw totals first
    gf = sum(int(r.get("goals_for") or 0) for r in rows)
    ga = sum(int(r.get("goals_against") or 0) for r in rows)
    sf = sum(int(r.get("shots_for") or 0) for r in rows)
    sa = sum(int(r.get("shots_against") or 0) for r in rows)

    pp_goals = sum(int(r.get("pp_goals") or 0) for r in rows)
    pp_opps = sum(int(r.get("pp_opps") or 0) for r in rows)
    pk_ga = sum(int(r.get("pk_goals_against") or 0) for r in rows)
    pk_opps = sum(int(r.get("pk_opps") or 0) for r in rows)

    # PP% is scored / opportunities
    pp_pct = _pct_or_none(pp_goals, pp_opps)

    # PK% is 1 - (allowed / opportunities)
    pk_pct = None
    if pk_opps > 0:
        pk_pct = 1.0 - (float(pk_ga) / float(pk_opps))

    # Convert totals to per-game averages
    return {
        "games_used": n,
        "gf_pg": gf / n,
        "ga_pg": ga / n,
        "sf_pg": sf / n,
        "sa_pg": sa / n,
        "pp_pct": pp_pct,
        "pk_pct": pk_pct,
    }


def get_team_baseline_asof(team: str, as_of: str, m: int) -> Dict[str, Any]:
    """
    Rolling baseline for one team as-of a date
    Pulls last m games strictly BEFORE as_of
    Strictly-before prevents information leakage into features
    """
    key = (team, as_of, m)
    if key in _BASELINE_CACHE:
        return _BASELINE_CACHE[key]

    # Pull only the columns needed for baseline aggregation
    q = text(
        f"""
        SELECT
            tg.goals_for,
            tg.goals_against,
            tg.shots_for,
            tg.shots_against,
            tg.pp_goals,
            tg.pp_opps,
            tg.pk_goals_against,
            tg.pk_opps
        FROM team_games tg
        WHERE tg.team = :team
          AND tg.game_date < :as_of
          AND {_regular_season_condition("tg")}
        ORDER BY tg.game_date DESC, tg.game_id DESC
        LIMIT :m
        """
    )

    with engine.connect() as conn:
        rows = conn.execute(q, {"team": team, "as_of": as_of, "m": m}).mappings().all()

    baseline = _aggregate_baseline([dict(r) for r in rows])
    _BASELINE_CACHE[key] = baseline
    return baseline


def get_league_baseline_asof(as_of: str) -> Dict[str, Any]:
    """
    League-wide baseline expectations as-of a date
    Uses all regular-season rows strictly BEFORE as_of
    Returned numbers represent league average performance in the DB
    """
    if as_of in _LEAGUE_CACHE:
        return _LEAGUE_CACHE[as_of]

    # AVG for per-row averages like goals_for
    # SUM for PP/PK components so the rate is computed over total opps, not avg of rates
    q = text(
        f"""
        SELECT
            AVG(tg.goals_for)     AS gf_pg,
            AVG(tg.goals_against) AS ga_pg,
            AVG(tg.shots_for)     AS sf_pg,
            AVG(tg.shots_against) AS sa_pg,
            SUM(COALESCE(tg.pp_goals, 0))         AS pp_goals,
            SUM(COALESCE(tg.pp_opps, 0))          AS pp_opps,
            SUM(COALESCE(tg.pk_goals_against, 0)) AS pk_ga,
            SUM(COALESCE(tg.pk_opps, 0))          AS pk_opps,
            COUNT(*) AS rows_used
        FROM team_games tg
        WHERE tg.game_date < :as_of
          AND {_regular_season_condition("tg")}
        """
    )

    with engine.connect() as conn:
        r = conn.execute(q, {"as_of": as_of}).mappings().first()

    # If the DB is empty or query returns nothing, return a safe empty baseline
    if not r:
        league = {
            "rows_used": 0,
            "gf_pg": None,
            "ga_pg": None,
            "sf_pg": None,
            "sa_pg": None,
            "pp_pct": None,
            "pk_pct": None,
        }
    else:
        # Compute league PP% from summed totals
        pp_pct = _pct_or_none(float(r["pp_goals"] or 0), float(r["pp_opps"] or 0))

        # Compute league PK% from summed totals
        pk_pct = None
        pk_opps = float(r["pk_opps"] or 0)
        if pk_opps > 0:
            pk_pct = 1.0 - (float(r["pk_ga"] or 0) / pk_opps)

        league = {
            "rows_used": int(r["rows_used"] or 0),
            "gf_pg": float(r["gf_pg"]) if r["gf_pg"] is not None else None,
            "ga_pg": float(r["ga_pg"]) if r["ga_pg"] is not None else None,
            "sf_pg": float(r["sf_pg"]) if r["sf_pg"] is not None else None,
            "sa_pg": float(r["sa_pg"]) if r["sa_pg"] is not None else None,
            "pp_pct": pp_pct,
            "pk_pct": pk_pct,
        }

    _LEAGUE_CACHE[as_of] = league
    return league


def get_team_baseline_asof_with_fallback(
    team: str, as_of: str, m: int, *, min_games: int = 5
) -> Dict[str, Any]:
    """
    Baseline with safety fallback
    If the team has fewer than min_games prior games, return league averages instead
    games_used still reflects the real team count so downstream can measure confidence
    """
    b = get_team_baseline_asof(team, as_of, m)
    if int(b.get("games_used") or 0) >= min_games:
        return b

    league = get_league_baseline_asof(as_of)
    return {
        "games_used": int(b.get("games_used") or 0),
        "gf_pg": league.get("gf_pg"),
        "ga_pg": league.get("ga_pg"),
        "sf_pg": league.get("sf_pg"),
        "sa_pg": league.get("sa_pg"),
        "pp_pct": league.get("pp_pct"),
        "pk_pct": league.get("pk_pct"),
        "fallback": "league",
    }


def clear_baseline_caches() -> None:
    # Manual cache reset for development or tests
    _BASELINE_CACHE.clear()
    _LEAGUE_CACHE.clear()
