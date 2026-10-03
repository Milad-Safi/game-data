"""Read-only, team-level Elo. Independent of trend inference and ingestion writes."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timezone
from math import fsum
from threading import Lock

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from .cache import cached
from .db import engine
from .ingest_nhl import API, fetch_boxscore, get_json
from .season import CurrentSeasonError, current_season_id

INITIAL_ELO = 1500.0
K_FACTOR = 10.0
HOME_ADVANTAGE_ELO = 30.0
# Fraction of the distance from 1500 removed at each season boundary.
OFFSEASON_REGRESSION_FRACTION = 0.25
ELO_CACHE_SECONDS = 60
ROSTER_PRIOR_SEASON_ID = 20262027
ROSTER_ELO_PER_POINT = 30.0
TURNOVER_FADE_GAMES = 20
TURNOVER_PENALTIES = {"low": 0.0, "medium": -10.0, "high": -20.0}
# Manual 2026-27 inputs; historical franchise ratings must not seed this season.
ROSTER_PRIORS = {
    "ANA": (7.0, "medium"), "BOS": (6.7, "low"),
    "BUF": (7.8, "low"), "CAR": (9.0, "low"),
    "CBJ": (5.8, "medium"), "CGY": (3.0, "medium"),
    "CHI": (4.6, "medium"), "COL": (9.2, "low"),
    "DAL": (8.7, "low"), "DET": (5.5, "low"),
    "EDM": (7.4, "medium"), "FLA": (9.0, "medium"),
    "LAK": (6.3, "medium"), "MIN": (7.2, "low"),
    "MTL": (8.2, "low"), "NJD": (6.5, "low"),
    "NSH": (4.7, "low"), "NYI": (5.9, "low"),
    "NYR": (6.4, "medium"), "OTT": (7.3, "medium"),
    "PHI": (6.3, "low"), "PIT": (6.6, "low"),
    "SEA": (5.8, "low"), "SJS": (6.7, "medium"),
    "STL": (5.3, "medium"), "TBL": (7.8, "low"),
    "TOR": (8.0, "high"), "UTA": (6.8, "medium"),
    "VAN": (4.0, "medium"), "VGK": (7.6, "low"),
    "WPG": (5.4, "low"), "WSH": (7.4, "high"),
}

router = APIRouter(prefix="/v1/elo", tags=["Elo"])
_snapshot_lock = Lock()


def home_win_probability(home_elo: float, away_elo: float, neutral_site: bool = False) -> float:
    advantage = 0.0 if neutral_site else HOME_ADVANTAGE_ELO
    return 1.0 / (1.0 + 10.0 ** (
        (away_elo - home_elo - advantage) / 400.0
    ))


def load_history(season_id: int) -> list[dict]:
    # Read both perspectives: selecting only home rows would hide disagreements.
    with engine.connect() as conn:
        conn.execute(text("SET TRANSACTION READ ONLY"))
        rows = conn.execute(text("""
            SELECT game_id, game_date, team, opponent, is_home,
                   goals_for, goals_against
            FROM team_games
            WHERE SUBSTRING(game_id::text, 5, 2) = '02'
              AND game_id / 1000000 <= :season_year
              AND game_id / 1000000 >= :first_year
            ORDER BY game_date ASC, game_id ASC
        """), {
            "season_year": season_id // 10000,
            "first_year": season_id // 10000 if season_id == ROSTER_PRIOR_SEASON_ID else 0,
        }).mappings().all()
    return [dict(row) for row in rows]


def active_teams(season_id: int, standings_payload: dict | None = None) -> list[str]:
    # Only team identity is used; no standings calculations or points logic.
    payload = standings_payload if standings_payload is not None else get_json(f"{API}/standings/now")
    rows = payload.get("standings", [])
    teams = []
    for row in rows:
        if row.get("seasonId") != season_id:
            raise ValueError("Active team feed does not match the resolved season")
        value = row.get("teamAbbrev")
        team = value.get("default") if isinstance(value, dict) else value
        if not isinstance(team, str) or not team.strip():
            raise ValueError("Missing active team abbreviation")
        teams.append(team.strip().upper())
    if not teams or len(teams) != len(set(teams)):
        raise ValueError("Missing or duplicate active teams")
    return sorted(teams)


def _score(value) -> bool:
    return type(value) is int and value >= 0


def _official_scores(game: dict) -> tuple[int, int]:
    box = fetch_boxscore(game["game_id"])
    home, away = box.get("homeTeam", {}), box.get("awayTeam", {})
    hs, aws = home.get("score"), away.get("score")
    if (box.get("id") != game["game_id"]
            or box.get("gameType") != 2
            or box.get("season") != game["season"] * 10000 + game["season"] + 1
            or box.get("gameState") not in {"FINAL", "OFF"}
            or box.get("gameDate") != game["game_date"].isoformat()
            or home.get("abbrev") != game["home"]
            or away.get("abbrev") != game["away"]
            or not _score(hs) or not _score(aws) or hs == aws):
        raise ValueError("Official boxscore is incomplete or does not match the game")
    return hs, aws


def validated_games(rows: list[dict], as_of: date) -> tuple[list[dict], list[dict]]:
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["game_id"]].append(row)
    games, warnings = [], []
    for game_id, perspectives in grouped.items():
        try:
            gid = int(game_id)
            if len(str(gid)) != 10 or str(gid)[4:6] != "02":
                raise ValueError("Invalid regular-season game ID")
            # Identical duplicate perspectives are harmless; conflicting ones are not.
            unique = []
            for row in perspectives:
                if row not in unique:
                    unique.append(row)
            if len(unique) != 2:
                raise ValueError("Expected two agreeing team perspectives")
            home = next((r for r in unique if r["is_home"] is True), None)
            away = next((r for r in unique if r["is_home"] is False), None)
            if home is None or away is None:
                raise ValueError("Expected one home row and one away row")
            if (not isinstance(home["team"], str) or not home["team"]
                    or not isinstance(away["team"], str) or not away["team"]
                    or home["team"] != home["team"].strip().upper()
                    or away["team"] != away["team"].strip().upper()
                    or home["team"] == away["team"]
                    or home["team"] != away["opponent"]
                    or away["team"] != home["opponent"]
                    or home["game_date"] != away["game_date"]
                    or type(home["game_date"]) is not date
                    or home["game_date"] > as_of
                    or not all(_score(r[k]) for r in unique
                               for k in ("goals_for", "goals_against"))
                    or home["goals_for"] != away["goals_against"]
                    or home["goals_against"] != away["goals_for"]):
                raise ValueError("Invalid or inconsistent teams, scores, date, or home/away")
            game = {
                "game_id": gid, "game_date": home["game_date"],
                "season": gid // 1000000,
                "home": home["team"], "away": away["team"],
                "home_score": home["goals_for"], "away_score": away["goals_for"],
            }
            if game["home_score"] == game["away_score"]:
                try:
                    game["home_score"], game["away_score"] = _official_scores(game)
                except Exception:
                    raise ValueError("Tied stored score could not be resolved from a completed official boxscore") from None
                warnings.append({"game_id": gid, "action": "resolved_in_memory",
                                 "reason": "Replaced tied stored scores with official final scores"})
            games.append(game)
        except (ValueError, TypeError, KeyError) as exc:
            warnings.append({"game_id": str(game_id), "action": "excluded",
                             "reason": str(exc)})
    return sorted(games, key=lambda g: (g["game_date"], g["game_id"])), warnings


def turnover_adjustment(initial_penalty: float, games_played: int) -> float:
    return initial_penalty * max(0.0, 1.0 - games_played / TURNOVER_FADE_GAMES)


def roster_mean(teams: list[str]) -> float:
    if len(teams) != len(ROSTER_PRIORS) or set(teams) != set(ROSTER_PRIORS):
        raise ValueError("Active teams do not match the 2026-27 roster priors")
    return fsum(ROSTER_PRIORS[team][0] for team in teams) / len(teams)


def calculate_roster_ratings(games: list[dict], teams: list[str]) -> dict:
    """Update underlying Elo; apply turnover only to pregame effective strength."""
    mean_score = roster_mean(teams)
    ratings = {}
    for team in teams:
        score, turnover = ROSTER_PRIORS[team]
        base = INITIAL_ELO + ROSTER_ELO_PER_POINT * (score - mean_score)
        penalty = TURNOVER_PENALTIES[turnover]
        ratings[team] = {
            "roster_score": score, "turnover_level": turnover,
            "base_elo": base, "opening_effective_elo": base + penalty,
            "initial_turnover_adjustment": penalty,
            "elo": base, "games_processed": 0, "games_played": 0,
            "last_processed_game_id": None, "last_processed_game_date": None,
        }
    # Also enforce scope here for callers passing a multi-season validated log.
    games = sorted(
        (g for g in games if g["season"] == ROSTER_PRIOR_SEASON_ID // 10000
         and str(g["game_id"])[4:6] == "02"),
        key=lambda g: (g["game_date"], g["game_id"]),
    )

    def effective(row):
        return row["elo"] + turnover_adjustment(
            row["initial_turnover_adjustment"], row["games_played"]
        )

    for game in games:
        if game["home"] not in ratings or game["away"] not in ratings:
            raise ValueError("Game contains a team without a 2026-27 roster prior")
        home, away = ratings[game["home"]], ratings[game["away"]]
        expected = home_win_probability(effective(home), effective(away))
        actual = float(game["home_score"] > game["away_score"])
        change = K_FACTOR * (actual - expected)
        home["elo"] += change
        away["elo"] -= change
        for row in (home, away):
            row["games_processed"] += 1
            row["games_played"] += 1
            row["last_processed_game_id"] = game["game_id"]
            row["last_processed_game_date"] = game["game_date"].isoformat()
    for row in ratings.values():
        row["turnover_adjustment"] = turnover_adjustment(
            row["initial_turnover_adjustment"], row["games_played"]
        )
        row["effective_elo"] = effective(row)
    return {
        "teams": [{"team": team, **ratings[team]} for team in sorted(teams)],
        "games_processed": len(games),
        "last_processed_game_id": games[-1]["game_id"] if games else None,
        "last_processed_game_date": games[-1]["game_date"].isoformat() if games else None,
    }


def calculate_ratings(games: list[dict], teams: list[str], season_id: int) -> dict:
    """Use roster priors for 2026-27; retain historical replay for other seasons."""
    if season_id == ROSTER_PRIOR_SEASON_ID:
        return calculate_roster_ratings(games, teams)
    ratings: dict[str, dict] = {}

    def entry(team):
        return ratings.setdefault(team, {
            "elo": INITIAL_ELO, "games_processed": 0,
            "last_processed_game_id": None, "last_processed_game_date": None,
        })

    def advance_season(year):
        # Transfer once, at the franchise-code transition, before regression.
        if year == 2024 and "ARI" in ratings:
            ratings["UTA"] = ratings.pop("ARI")
        for rating in ratings.values():
            rating["elo"] = INITIAL_ELO + (1.0 - OFFSEASON_REGRESSION_FRACTION) * (
                rating["elo"] - INITIAL_ELO
            )

    target_year = season_id // 10000
    year = games[0]["season"] if games else target_year
    for game in games:
        if game["season"] < year or game["season"] > target_year:
            raise ValueError("Game chronology is inconsistent with season order")
        while year < game["season"]:
            year += 1
            advance_season(year)
        home, away = entry(game["home"]), entry(game["away"])
        expected = home_win_probability(home["elo"], away["elo"])
        actual = float(game["home_score"] > game["away_score"])
        change = K_FACTOR * (actual - expected)
        home["elo"] += change
        away["elo"] -= change
        for rating in (home, away):
            rating["games_processed"] += 1
            rating["last_processed_game_id"] = game["game_id"]
            rating["last_processed_game_date"] = game["game_date"].isoformat()
    # Also regress into the officially resolved season before its first game.
    while year < target_year:
        year += 1
        advance_season(year)
    return {
        "teams": [{"team": team, **entry(team)} for team in sorted(teams)],
        "games_processed": len(games),
        "last_processed_game_id": games[-1]["game_id"] if games else None,
        "last_processed_game_date": games[-1]["game_date"].isoformat() if games else None,
    }


def current_ratings() -> dict:
    season_id = current_season_id()

    def build():
        teams = active_teams(season_id)
        now = datetime.now(timezone.utc)
        games, warnings = validated_games(load_history(season_id), now.date())
        use_roster_priors = season_id == ROSTER_PRIOR_SEASON_ID
        if not games:
            warnings.append({"game_id": None, "action": "warning",
                             "reason": "No valid current-season games; using opening roster priors"
                             if use_roster_priors else "No valid historical games; all ratings start at 1500"})
        return {
            "season_id": season_id, "computed_at": now.isoformat(),
            "config": {"initial_elo": INITIAL_ELO, "k_factor": K_FACTOR,
                       "home_ice_elo_advantage": HOME_ADVANTAGE_ELO,
                       "initialization": "roster_priors" if use_roster_priors else "historical_elo",
                       "offseason_regression_fraction": None if use_roster_priors else OFFSEASON_REGRESSION_FRACTION,
                       **({"league_mean_roster_score": roster_mean(teams),
                           "roster_elo_per_point": ROSTER_ELO_PER_POINT,
                           "turnover_penalties": dict(TURNOVER_PENALTIES),
                           "turnover_fade_games": TURNOVER_FADE_GAMES}
                          if use_roster_priors else {})},
            **calculate_ratings(games, teams, season_id), "warnings": warnings,
        }

    with _snapshot_lock:
        return cached(f"elo_roster_v1:{season_id}", ELO_CACHE_SECONDS, build)


def _snapshot() -> dict:
    try:
        return current_ratings()
    except CurrentSeasonError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Elo data is unavailable; please retry later.") from exc


@router.get("/ratings")
def ratings_endpoint():
    return _snapshot()


@router.get("/matchup")
def matchup_endpoint(home: str, away: str):
    home, away = home.strip().upper(), away.strip().upper()
    if not home or not away or home == away:
        raise HTTPException(status_code=400, detail="Provide two distinct active team abbreviations.")
    snapshot = _snapshot()
    teams = {row["team"]: row for row in snapshot["teams"]}
    if home not in teams or away not in teams:
        raise HTTPException(status_code=400, detail="Unknown or inactive team abbreviation.")
    home_elo, away_elo = teams[home]["elo"], teams[away]["elo"]
    home_adjustment = teams[home].get("turnover_adjustment", 0.0)
    away_adjustment = teams[away].get("turnover_adjustment", 0.0)
    home_effective, away_effective = home_elo + home_adjustment, away_elo + away_adjustment
    probability = home_win_probability(home_effective, away_effective)
    return {
        "season_id": snapshot["season_id"], "computed_at": snapshot["computed_at"],
        "home": home, "away": away, "home_elo": home_elo, "away_elo": away_elo,
        "home_turnover_adjustment": home_adjustment, "away_turnover_adjustment": away_adjustment,
        "home_effective_elo": home_effective, "away_effective_elo": away_effective,
        "home_win_probability": probability, "away_win_probability": 1.0 - probability,
        "home_ice_elo_advantage": HOME_ADVANTAGE_ELO,
        "warnings": snapshot["warnings"],
    }
