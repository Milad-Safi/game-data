"""Regular-season points and playoff qualification from frozen observed Elo."""
from __future__ import annotations

from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from hashlib import sha256
from threading import Lock

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from . import elo
from .cache import cached
from .ingest_nhl import API, get_json

SEASON_ID = elo.ROSTER_PRIOR_SEASON_ID
OT_HISTORY_SEASONS = (20232024, 20242025, 20252026)
DEFAULT_SIMULATIONS = 10_000
DEFAULT_SEED = 2026
INPUT_CACHE_SECONDS = 60
OT_CACHE_SECONDS = 86400
COMPLETED_STATES = {"FINAL", "OFF"}
REMAINING_STATES = {"FUT", "PRE", "LIVE", "CRIT"}
router = APIRouter(prefix="/v1/simulator", tags=["Season projections"])
_input_lock = Lock()
_ot_lock = Lock()


class SimulationDataError(ValueError):
    pass


def _abbrev(value) -> str:
    value = value.get("default") if isinstance(value, dict) else value
    if not isinstance(value, str) or not value.strip():
        raise SimulationDataError("Missing team abbreviation in NHL data")
    return value.strip().upper()


def _integer(value, field: str) -> int:
    if type(value) is not int or value < 0:
        raise SimulationDataError(f"Invalid NHL {field}")
    return value


def fetch_club_schedule(team: str, season_id: int) -> list[dict]:
    payload = get_json(f"{API}/club-schedule-season/{team}/{season_id}")
    if payload.get("currentSeason") != season_id or not isinstance(payload.get("games"), list):
        raise SimulationDataError(f"Invalid season schedule for {team}, {season_id}")
    return payload["games"]


def _fetch_schedules(requests: list[tuple[str, int]]) -> tuple[dict, list[dict]]:
    results, failures = {}, []
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(fetch_club_schedule, team, season): (team, season)
                   for team, season in requests}
        for future in as_completed(pending):
            key = pending[future]
            try:
                results[key] = future.result()
            except Exception:
                failures.append({"team": key[0], "season_id": key[1]})
    return results, sorted(failures, key=lambda row: (row["season_id"], row["team"]))


def _game(raw: dict, season_id: int) -> dict | None:
    if raw.get("season") != season_id or raw.get("gameType") != 2:
        return None
    gid = _integer(raw.get("id"), "game ID")
    if len(str(gid)) != 10 or gid // 1000000 != season_id // 10000 or str(gid)[4:6] != "02":
        raise SimulationDataError("Schedule game ID does not match regular season")
    day = date.fromisoformat(raw["gameDate"]).isoformat()
    home, away = _abbrev(raw.get("homeTeam", {}).get("abbrev")), _abbrev(raw.get("awayTeam", {}).get("abbrev"))
    if home == away:
        raise SimulationDataError("Schedule game has identical opponents")
    neutral = raw.get("neutralSite")
    if neutral is not None and type(neutral) is not bool:
        raise SimulationDataError("Invalid neutral-site flag")
    return {
        "game_id": gid, "date": day, "home": home, "away": away,
        "neutral_site": neutral, "game_state": raw.get("gameState"),
        "schedule_state": raw.get("gameScheduleState"),
        "start_time_utc": raw.get("startTimeUTC"),
    }


def parse_standings(payload: dict) -> tuple[dict, list[str]]:
    # The single official standings response supplies season, identities and points.
    # This endpoint supports only the explicit roster-prior season; no calendar fallback.
    teams = elo.active_teams(SEASON_ID, payload)
    elo.roster_mean(teams)
    standings, dates = {}, set()
    for raw in payload["standings"]:
        if raw.get("gameTypeId") != 2:
            raise SimulationDataError("Standings must be regular season")
        team = _abbrev(raw.get("teamAbbrev"))
        row = {key: _integer(raw.get(field), field) for key, field in (
            ("games_played", "gamesPlayed"), ("wins", "wins"), ("losses", "losses"),
            ("ot_losses", "otLosses"), ("points", "points"),
            ("rw", "regulationWins"), ("row", "regulationPlusOtWins"))}
        if row["games_played"] != row["wins"] + row["losses"] + row["ot_losses"]:
            raise SimulationDataError(f"Inconsistent official games played for {team}")
        if row["points"] != 2 * row["wins"] + row["ot_losses"]:
            raise SimulationDataError(f"Inconsistent official points for {team}")
        if not row["rw"] <= row["row"] <= row["wins"]:
            raise SimulationDataError(f"Inconsistent official RW/ROW/wins for {team}")
        row.update(conference=raw.get("conferenceName"), division=raw.get("divisionName"))
        standings[team] = row
        if raw.get("date"):
            dates.add(date.fromisoformat(raw["date"]).isoformat())
    if len(dates) > 1:
        raise SimulationDataError("Official standings rows have different snapshot dates")
    playoff_groups(sorted(standings), standings)
    return standings, sorted(dates)


def load_current_schedule(teams: list[str]) -> list[dict]:
    schedules, failures = _fetch_schedules([(team, SEASON_ID) for team in teams])
    if failures:
        raise SimulationDataError("Could not fetch every team's full current-season schedule")
    games, sources = {}, defaultdict(set)
    for (team, _), rows in sorted(schedules.items()):
        count = 0
        for raw in rows:
            game = _game(raw, SEASON_ID)
            if game is None:
                continue
            count += 1
            gid = game["game_id"]
            if team not in (game["home"], game["away"]) or any(t not in teams for t in (game["home"], game["away"])):
                raise SimulationDataError("Schedule contains unexpected teams")
            if game["schedule_state"] == "CNCL":
                raise SimulationDataError("A cancelled game needs schedule reconciliation before projecting")
            if game["game_state"] not in COMPLETED_STATES | REMAINING_STATES:
                raise SimulationDataError(f"Unknown state for scheduled game {gid}")
            if gid in games and games[gid] != game:
                raise SimulationDataError(f"Club schedules disagree for game {gid}; retry after NHL updates")
            games[gid] = game
            sources[gid].add(team)
        if not count:
            raise SimulationDataError(f"No regular-season schedule returned for {team}")
    for gid, game in games.items():
        if sources[gid] != {game["home"], game["away"]}:
            raise SimulationDataError(f"Game {gid} is missing from an opponent's schedule")
    return sorted(games.values(), key=lambda g: (g["date"], g["start_time_utc"] or "", g["game_id"]))


def estimate_ot_rate() -> dict:
    """Use official final period types; never infer OT from stored scores."""
    rows = elo.load_history(max(OT_HISTORY_SEASONS))
    grouped = defaultdict(list)
    years = {season // 10000 for season in OT_HISTORY_SEASONS}
    for row in rows:
        if int(row["game_id"]) // 1000000 in years:
            grouped[int(row["game_id"])].append(row)
    if not grouped:
        raise SimulationDataError("No historical regular-season games available for OT estimation")
    expected, excluded = {}, {}
    requests = set()
    for gid, pair in grouped.items():
        home = [r for r in pair if r["is_home"] is True]
        away = [r for r in pair if r["is_home"] is False]
        if (len(pair) != 2 or len(home) != 1 or len(away) != 1
                or home[0]["team"] != away[0]["opponent"]
                or away[0]["team"] != home[0]["opponent"]
                or home[0]["game_date"] != away[0]["game_date"]):
            excluded[gid] = "Invalid historical fixture identity"
            continue
        year = gid // 1000000
        season = year * 10000 + year + 1
        expected[gid] = (season, home[0]["team"], away[0]["team"], home[0]["game_date"].isoformat())
        requests.update([(home[0]["team"], season), (away[0]["team"], season)])
    schedules, failures = _fetch_schedules(sorted(requests))
    outcomes = defaultdict(set)
    for (_, season), rows in sorted(schedules.items()):
        for raw in rows:
            try:
                game = _game(raw, season)
            except (ValueError, TypeError, KeyError):
                continue
            if game is None or game["game_id"] not in expected or game["game_state"] not in COMPLETED_STATES:
                continue
            gid = game["game_id"]
            if expected[gid] != (season, game["home"], game["away"], game["date"]):
                continue
            outcome = (raw.get("gameOutcome") or {}).get("lastPeriodType")
            if not outcome:
                outcome = (raw.get("periodDescriptor") or {}).get("periodType")
            if outcome in {"REG", "OT", "SO"}:
                outcomes[gid].add(outcome)
    verified = {}
    for gid in expected:
        choices = outcomes[gid]
        if len(choices) == 1:
            verified[gid] = next(iter(choices))
        else:
            excluded[gid] = "Conflicting official outcomes" if choices else "No verified official final outcome"
    if not verified:
        raise SimulationDataError("No historical OT/SO outcomes could be verified")
    counts = Counter(verified.values())
    ot_count = counts["OT"] + counts["SO"]
    by_season = []
    for season in OT_HISTORY_SEASONS:
        ids = {gid for gid in grouped if gid // 1000000 == season // 10000}
        valid = ids & verified.keys()
        by_season.append({"season_id": season, "candidate_games": len(ids),
                          "verified_games": len(valid),
                          "ot_so_games": sum(verified[gid] in {"OT", "SO"} for gid in valid),
                          "excluded_games": len(ids - valid),
                          "regulation_games": sum(verified[g] == "REG" for g in valid),
                          "overtime_games": sum(verified[g] == "OT" for g in valid),
                          "shootout_games": sum(verified[g] == "SO" for g in valid)})
    return {
        "seasons_used": [r["season_id"] for r in by_season if r["verified_games"]],
        "candidate_games": len(grouped), "verified_games": len(verified),
        "ot_so_games": ot_count, "rate": ot_count / len(verified),
        "regulation_games": counts["REG"], "overtime_games": counts["OT"], "shootout_games": counts["SO"],
        "regulation_rate": counts["REG"] / len(verified),
        "overtime_rate": counts["OT"] / len(verified),
        "shootout_rate": counts["SO"] / len(verified),
        "excluded_games": len(excluded), "by_season": by_season,
        "exclusions": [{"game_id": gid, "reason": reason} for gid, reason in sorted(excluded.items())],
        "schedule_fetch_failures": failures,
        "source": "Official NHL club-season schedules: completed REG/OT/SO outcomes",
        "verified_at": datetime.now(timezone.utc).isoformat(),
    }


def historical_ot_rate() -> dict:
    with _ot_lock:
        return cached("season_outcomes_v2:" + ",".join(map(str, OT_HISTORY_SEASONS)),
                      OT_CACHE_SECONDS, estimate_ot_rate)


def build_inputs() -> dict:
    payload = get_json(f"{API}/standings/now")
    fetched_at = datetime.now(timezone.utc)
    standings, snapshot_dates = parse_standings(payload)
    teams = sorted(standings)
    full_schedule = load_current_schedule(teams)
    completed = [g for g in full_schedule if g["game_state"] in COMPLETED_STATES]
    remaining = [g for g in full_schedule if g["game_state"] not in COMPLETED_STATES]
    real_games, warnings = elo.validated_games(elo.load_history(SEASON_ID), fetched_at.date())
    # Elo may lag official results while ingestion catches up. It supplies matchup
    # strength only; official standings supply points, tiebreakers and turnover GP.
    if {g["game_id"] for g in real_games} != {g["game_id"] for g in completed}:
        warnings.append({"action": "approximation", "reason": "Using latest available database Elo; its processed games differ from the completed official schedule"})
    ratings = elo.calculate_ratings(real_games, teams, SEASON_ID)
    elo_rows = {r["team"]: r for r in ratings["teams"]}
    completed_counts = Counter(t for g in completed for t in (g["home"], g["away"]))
    full_counts = Counter(t for g in full_schedule for t in (g["home"], g["away"]))
    for team in teams:
        gp = standings[team]["games_played"]
        if gp != completed_counts[team]:
            raise SimulationDataError(f"Official standings and schedule games played disagree for {team}; retry after updates")
    live = sum(g["game_state"] in {"LIVE", "CRIT"} for g in remaining)
    if live:
        warnings.append({"action": "approximation", "reason": f"{live} in-progress games are simulated from pregame strengths; live scores are not modeled"})
    unknown_neutral = sum(g["neutral_site"] is None for g in remaining)
    if unknown_neutral:
        warnings.append({"action": "assumption", "reason": f"{unknown_neutral} games lack neutral-site flags; treated as non-neutral"})
    return {
        "season_id": SEASON_ID, "standings_fetched_at": fetched_at.isoformat(),
        "standings_snapshot_dates": snapshot_dates,
        "standings_snapshot_time_utc": payload.get("standingsDateTimeUtc"),
        "standings": standings,
        "elo": elo_rows, "remaining_schedule": remaining,
        "full_schedule_games": len(full_schedule), "schedule_lengths": dict(full_counts),
        "last_real_game_processed_by_elo": {"game_id": ratings["last_processed_game_id"],
                                            "date": ratings["last_processed_game_date"]},
        "warnings": warnings,
    }


def current_inputs() -> dict:
    with _input_lock:
        return cached(f"season_playoff_inputs_v2:{SEASON_ID}", INPUT_CACHE_SECONDS, build_inputs)


def playoff_groups(teams: list[str], standings: dict) -> tuple[dict, dict]:
    alignment = {"Atlantic": "Eastern", "Metropolitan": "Eastern",
                 "Central": "Western", "Pacific": "Western"}
    divisions = {d: [] for d in alignment}
    conferences = {c: [] for c in set(alignment.values())}
    for i, team in enumerate(teams):
        d, c = standings[team]["division"], standings[team]["conference"]
        if d not in alignment or alignment[d] != c:
            raise SimulationDataError(f"Invalid official playoff alignment for {team}")
        divisions[d].append(i)
        conferences[c].append(i)
    if len(teams) != 32 or any(len(group) != 8 for group in divisions.values()):
        raise SimulationDataError("Expected four official eight-team divisions")
    return divisions, conferences


def assign_playoffs(teams, standings, points, rw, row_wins, wins, rng):
    """Rank the same simulated seasons; probabilities are fractions, not percentages.

    A fallback tie is one equal (points, RW, ROW, wins) group in one conference
    in one season, counted once even if also tied within a division. To measure
    berth impact, promote and demote each tied member within that equal group.
    Qualification is monotone in its own rank, so these extremes identify whether
    that team's berth depends on the random ordering (including division/WC paths).
    These counterfactual checks consume no randomness and do not alter the result.
    """
    divisions, conferences = playoff_groups(teams, standings)
    n, width = points.shape
    top3 = np.zeros((n, width), dtype=bool)
    wildcard = np.zeros_like(top3)
    winner = np.zeros_like(top3)
    ties = affected_groups = affected_team_decisions = tied_seasons = affected_seasons = 0
    division_boundaries = wildcard_boundaries = 0

    def select(order):
        selected, leaders = set(), set()
        for members in divisions.values():
            ranked = [i for i in order if i in members]
            selected.update(ranked[:3])
            leaders.add(ranked[0])
        wild = set()
        for members in conferences.values():
            eligible = [i for i in order if i in members and i not in selected]
            wild.update(eligible[:2])
        return selected, wild, leaders

    for run in range(n):
        keys = list(zip(points[run].tolist(), rw[run].tolist(),
                        row_wins[run].tolist(), wins[run].tolist()))
        # A unique seeded permutation provides one consistent tie order per season.
        priority = rng.permutation(width)
        order = sorted(range(width), key=lambda i: (*keys[i], int(priority[i])), reverse=True)
        selected, wild, leaders = select(order)
        top3[run, list(selected)] = True
        wildcard[run, list(wild)] = True
        winner[run, list(leaders)] = True
        for members in divisions.values():
            ranked = [i for i in order if i in members]
            division_boundaries += keys[ranked[2]] == keys[ranked[3]]
        has_tie = has_impact = False
        for members in conferences.values():
            eligible = [i for i in order if i in members and i not in selected]
            wildcard_boundaries += keys[eligible[1]] == keys[eligible[2]]
            groups = defaultdict(list)
            for i in members:
                groups[keys[i]].append(i)
            for group in groups.values():
                if len(group) < 2:
                    continue
                ties += 1
                has_tie = True
                affected = 0
                for i in group:
                    # Move only this member above/below its exact statistical peers.
                    peers = [j for j in order if keys[j] == keys[i]]
                    start = order.index(peers[0])
                    rest = [j for j in order if j not in peers]
                    others = [j for j in peers if j != i]
                    high = rest[:start] + [i] + others + rest[start:]
                    low = rest[:start] + others + [i] + rest[start:]
                    high_div, high_wc, _ = select(high)
                    low_div, low_wc, _ = select(low)
                    affected += (i in high_div | high_wc) != (i in low_div | low_wc)
                if affected:
                    affected_groups += 1
                    affected_team_decisions += affected
                    has_impact = True
        tied_seasons += has_tie
        affected_seasons += has_impact
    makes = top3 | wildcard
    checks = {
        "exactly_16_qualifiers_every_simulation": bool(np.all(makes.sum(axis=1) == 16)),
        "division_spots_every_simulation": {d: bool(np.all(top3[:, ids].sum(axis=1) == 3)) for d, ids in divisions.items()},
        "conference_qualifiers_every_simulation": {c: bool(np.all(makes[:, ids].sum(axis=1) == 8)) for c, ids in conferences.items()},
        "conference_wildcards_every_simulation": {c: bool(np.all(wildcard[:, ids].sum(axis=1) == 2)) for c, ids in conferences.items()},
        "division_winners_every_simulation": {d: bool(np.all(winner[:, ids].sum(axis=1) == 1)) for d, ids in divisions.items()},
        "probability_accounting_every_team": bool(np.all(~(top3 & wildcard)) and np.all(~winner | top3)),
    }
    if not all(all(v.values()) if isinstance(v, dict) else v for v in checks.values()):
        raise SimulationDataError("Playoff qualification accounting failed")
    checks.update({
        "conference_playoff_probability_sums": {c: float(makes[:, ids].sum() / n) for c, ids in conferences.items()},
        "league_playoff_probability_sum": float(makes.sum() / n),
        "division_winner_probability_sums": {d: float(winner[:, ids].sum() / n) for d, ids in divisions.items()},
        "random_tiebreaker": {
            "tied_conference_groups": ties, "simulations_with_ties": tied_seasons,
            "division_top3_boundary_ties": division_boundaries,
            "wildcard_boundary_ties": wildcard_boundaries,
            "groups_affecting_playoff_qualification": affected_groups,
            "team_qualification_decisions_depending_on_fallback": affected_team_decisions,
            "simulations_with_playoff_berth_impact": affected_seasons,
            "definition": "Equal points/RW/ROW/wins groups counted once per conference per simulation; berth impact verified by promoting/demoting tied teams",
        },
    })
    return {"make_playoffs_probability": makes, "miss_playoffs_probability": ~makes,
            "division_winner_probability": winner, "top_3_division_probability": top3,
            "wildcard_probability": wildcard}, checks


def simulate_points(inputs: dict, ot: dict, simulations: int = DEFAULT_SIMULATIONS,
                    seed: int = DEFAULT_SEED) -> dict:
    if not 1 <= simulations <= 100_000 or not 0 <= seed <= 2**32 - 1:
        raise ValueError("Invalid simulation count or seed")
    rates = np.array([ot["regulation_rate"], ot["overtime_rate"], ot["shootout_rate"]])
    if not (np.all(np.isfinite(rates)) and np.all(rates >= 0) and np.all(rates <= 1)
            and np.isclose(rates.sum(), 1) and np.isclose(rates[1:].sum(), ot["rate"])):
        raise SimulationDataError("Invalid historical OT/SO rate")
    teams = sorted(inputs["standings"])
    index = {team: i for i, team in enumerate(teams)}
    standings, ratings = inputs["standings"], inputs["elo"]
    starting_points = np.array([standings[t]["points"] for t in teams], dtype=np.int32)
    points = np.tile(starting_points, (simulations, 1))
    rw, row_wins, wins = [np.tile(np.array([standings[t][key] for t in teams], dtype=np.int32),
                                (simulations, 1)) for key in ("rw", "row", "wins")]
    gp = np.array([standings[t]["games_played"] for t in teams], dtype=np.int32)
    frozen_elo = np.array([ratings[t]["elo"] for t in teams], dtype=float)
    initial_penalties = np.array([ratings[t]["initial_turnover_adjustment"] for t in teams])
    rng = np.random.default_rng(seed)
    ot_games = np.zeros(simulations, dtype=np.int32)
    shootout_games = np.zeros(simulations, dtype=np.int32)
    schedule = inputs["remaining_schedule"]
    remaining_counts = Counter()
    for game in schedule:
        h, a = index[game["home"]], index[game["away"]]
        home_strength = frozen_elo[h] + elo.turnover_adjustment(initial_penalties[h], int(gp[h]))
        away_strength = frozen_elo[a] + elo.turnover_adjustment(initial_penalties[a], int(gp[a]))
        probability = elo.home_win_probability(home_strength, away_strength, neutral_site=game["neutral_site"] is True)
        # Ending type and winner are independent; draw ending type first.
        ending = np.searchsorted(np.cumsum(rates)[:2], rng.random(simulations), side="right")
        home_wins = rng.random(simulations) < probability
        reaches_ot = ending != 0
        shootout_games += ending == 2
        for team_index, won in ((h, home_wins), (a, ~home_wins)):
            wins[:, team_index] += won
            rw[:, team_index] += won & (ending == 0)
            row_wins[:, team_index] += won & (ending != 2)
        points[:, h] += 2 * home_wins.astype(np.int32) + (reaches_ot & ~home_wins)
        points[:, a] += 2 * (~home_wins).astype(np.int32) + (reaches_ot & home_wins)
        ot_games += reaches_ot
        # All runs play the same schedule, so GP/turnover paths are deterministic.
        gp[h] += 1
        gp[a] += 1
        remaining_counts[game["home"]] += 1
        remaining_counts[game["away"]] += 1
    expected_gp = np.array([inputs["schedule_lengths"][t] for t in teams])
    schedule_ok = bool(np.array_equal(gp, expected_gp))
    totals = points.sum(axis=1, dtype=np.int64)
    expected_totals = int(starting_points.sum()) + 2 * len(schedule) + ot_games
    points_ok = bool(np.array_equal(totals, expected_totals))
    future_rw = rw.sum(axis=1) - sum(standings[t]["rw"] for t in teams)
    future_row = row_wins.sum(axis=1) - sum(standings[t]["row"] for t in teams)
    future_wins = wins.sum(axis=1) - sum(standings[t]["wins"] for t in teams)
    wins_ok = bool(np.all(rw <= row_wins) and np.all(row_wins <= wins)
                   and np.all(future_rw == len(schedule) - ot_games)
                   and np.all(future_row == len(schedule) - shootout_games)
                   and np.all(future_wins == len(schedule)))
    if not schedule_ok or not points_ok or not wins_ok:
        raise SimulationDataError("Simulation schedule or standings-points accounting failed")
    playoff, playoff_verification = assign_playoffs(teams, standings, points, rw, row_wins, wins, rng)
    rows = []
    for i, team in enumerate(teams):
        current_gp = standings[team]["games_played"]
        adjustment = elo.turnover_adjustment(float(initial_penalties[i]), current_gp)
        p10, median, p90 = np.percentile(points[:, i], [10, 50, 90])
        rows.append({
            "team": team, "conference": standings[team]["conference"],
            "division": standings[team]["division"], "current_gp": current_gp,
            "current_rw": standings[team]["rw"], "current_row": standings[team]["row"],
            **{key: float(values[:, i].mean()) for key, values in playoff.items()},
            "wins": standings[team]["wins"], "losses": standings[team]["losses"],
            "ot_losses": standings[team]["ot_losses"], "current_points": standings[team]["points"],
            "remaining_games": remaining_counts[team], "final_games_played": int(gp[i]),
            "current_elo": float(frozen_elo[i]), "current_turnover_adjustment": adjustment,
            "current_effective_elo": float(frozen_elo[i]) + adjustment,
            "mean_projected_final_points": float(points[:, i].mean()),
            "median_projected_final_points": float(median),
            "p10_projected_final_points": float(p10), "p90_projected_final_points": float(p90),
        })
    rows.sort(key=lambda row: (-row["make_playoffs_probability"], -row["mean_projected_final_points"], row["team"]))
    return {
        "teams": rows,
        "metadata": {
            "season_id": inputs["season_id"], "simulations": simulations, "seed": seed,
            "remaining_games": len(schedule), "full_schedule_games": inputs["full_schedule_games"],
            "historical_ot_so": ot,
            "standings_fetched_at": inputs["standings_fetched_at"],
            "standings_snapshot_dates": inputs["standings_snapshot_dates"],
            "standings_snapshot_time_utc": inputs.get("standings_snapshot_time_utc"),
            "last_real_game_processed_by_elo": inputs["last_real_game_processed_by_elo"],
            "home_advantage_elo": elo.HOME_ADVANTAGE_ELO,
            "neutral_site_home_advantage_elo": 0,
            "underlying_elo_frozen": True, "turnover_fade_games": elo.TURNOVER_FADE_GAMES,
            "ot_assumption": "League-wide REG/OT/SO ending type is independent of winner and rating difference",
            "probability_units": "fraction from 0 to 1",
            "tiebreakers": ["points", "RW", "ROW", "wins", "seeded random order"],
            "random_generator": "NumPy default_rng / PCG64", "numpy_version": np.__version__,
            "percentile_method": "linear",
        },
        "verification": {
            **playoff_verification,
            "all_teams_finish_schedule": schedule_ok, "points_consistent_every_simulation": points_ok,
            "rw_row_wins_consistent_every_simulation": wins_ok,
            "starting_league_points": int(starting_points.sum()),
            "regulation_games_across_simulations": int(simulations * len(schedule) - ot_games.sum()),
            "ot_so_games_across_simulations": int(ot_games.sum()),
            "overtime_games_across_simulations": int((ot_games - shootout_games).sum()),
            "shootout_games_across_simulations": int(shootout_games.sum()),
            "total_final_points_across_simulations": int(totals.sum()),
            "expected_total_final_points_across_simulations": int(expected_totals.sum()),
            "sample_sha256": sha256(b"".join(a.astype("<i4", copy=False).tobytes() for a in (points, rw, row_wins, wins)) + b"".join(a.tobytes() for a in playoff.values())).hexdigest(),
        },
        "remaining_schedule": schedule, "warnings": inputs["warnings"],
    }


@router.get("/playoffs")
@router.get("/points")
def points_endpoint(simulations: int = Query(DEFAULT_SIMULATIONS, ge=1, le=100_000),
                    seed: int = Query(DEFAULT_SEED, ge=0, le=2**32 - 1)):
    try:
        # Historical data can take longer on a cold start; fetch it before current inputs.
        ot = historical_ot_rate()
        return simulate_points(current_inputs(), ot, simulations, seed)
    except SimulationDataError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Season projection data is unavailable; please retry later.") from exc
