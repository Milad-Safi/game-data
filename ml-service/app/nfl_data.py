"""Shared read-only nflverse loaders for NFL analytics. No database writes or startup downloads."""
from __future__ import annotations

import datetime as dt
import os
import re
import tempfile
from threading import RLock

import polars as pl
import requests
from fastapi import HTTPException

from .cache import cached

# Disk caching avoids retaining multiple full PBP seasons in a small Render worker.
# Set these before importing nflreadpy, whose downloader is initialized on import.
os.environ.setdefault("NFLREADPY_CACHE", "filesystem")
os.environ.setdefault("NFLREADPY_CACHE_DIR", os.path.join(tempfile.gettempdir(), "game-data-nfl-cache"))
os.environ.setdefault("NFLREADPY_CACHE_DURATION", "3600")
os.environ.setdefault("NFLREADPY_TIMEOUT", "60")
import nflreadpy as nfl  # noqa: E402

LOCK = RLock()
BASE = "https://github.com/nflverse/nflverse-data/releases"
SPECS = {
    "schedule": ("schedules", "games", "load_schedules"),
    "teams": ("teams", "teams_colors_logos", "load_teams"),
    "team_stats": ("stats_team", "stats_team_week_{season}", "load_team_stats"),
    "player_stats": ("stats_player", "stats_player_week_{season}", "load_player_stats"),
    "pbp": ("pbp", "play_by_play_{season}", "load_pbp"),
    "rosters": ("rosters", "roster_{season}", "load_rosters"),
    "weekly_rosters": ("weekly_rosters", "roster_weekly_{season}", "load_rosters_weekly"),
    "depth_charts": ("depth_charts", "depth_charts_{season}", "load_depth_charts"),
    "injuries": ("injuries", "injuries_{season}", "load_injuries"),
    "players": ("players", "players", "load_players"),
}
NOTES = {
    "depth_charts": "2025 onward contains timestamped snapshots (dt), not a weekly schema. Defaults to the latest snapshot per team. Not confirmation of an upcoming starting QB.",
    "injuries": "Source availability has had interruptions. Inspect actual rows and weeks; a release file is not a promise of a complete or current injury report.",
    "teams": "Metadata includes historical abbreviations. Filtered to teams in the requested season schedule.",
    "players": "Cross-source ID mappings; use GSIS IDs for PBP/roster joins, never player names alone.",
}


def current_season():
    return nfl.get_current_season()


def source(dataset, season):
    tag, filename, _ = SPECS[dataset]
    dictionary = {"schedule": "schedules", "weekly_rosters": "rosters", "teams": "teams"}.get(dataset, dataset)
    return {
        "provider": "nflverse", "url": f"{BASE}/download/{tag}/{filename.format(season=season)}.parquet",
        "dictionary": f"https://nflreadr.nflverse.com/articles/dictionary_{dictionary}.html",
        "note": NOTES.get(dataset, "Free nflverse release data; inspect source schema and freshness before modelling."),
        "attribution": "nflverse; see dataset release for source attribution and licence",
    }


def manifest(dataset):
    tag, pattern, _ = SPECS[dataset]
    def fetch():
        try:
            r = requests.get(f"https://api.github.com/repos/nflverse/nflverse-data/releases/tags/{tag}", timeout=30)
            r.raise_for_status()
            return {a["name"]: {"updated_at": a["updated_at"], "bytes": a["size"]} for a in r.json()["assets"]}
        except (requests.RequestException, KeyError, ValueError) as exc:
            raise HTTPException(503, "nflverse release listing unavailable; retry later (GitHub may rate-limit anonymous requests).") from exc
    assets = cached(f"nfl:manifest:{tag}", 3600, fetch)
    rx = re.compile("^" + re.escape(pattern).replace(r"\{season\}", r"(\d{4})") + r"\.parquet$")
    seasons = sorted(int(m.group(1)) for name in assets if (m := rx.match(name)) and m.lastindex)
    return assets, seasons


def load(dataset, season):
    """Serialize cold loads; nflreadpy's disk cache handles reuse across requests."""
    if season > current_season():
        raise HTTPException(422, "Season is later than the current NFL season.")
    with LOCK:
        try:
            fn = getattr(nfl, SPECS[dataset][2])
            if dataset in ("teams", "players"):
                return fn()
            return fn(season)
        except (ConnectionError, ValueError, requests.RequestException) as exc:
            # A missing season is different from an upstream outage. Do not fall back
            # to an older season while labelling the response as the requested one.
            assets, seasons = manifest(dataset)
            expected = SPECS[dataset][1].format(season=season) + ".parquet"
            if "{season}" in SPECS[dataset][1] and expected not in assets:
                raise HTTPException(404, {"message": "Requested nflverse season is not published.", "dataset": dataset, "season": season, "available_seasons": seasons}) from exc
            raise HTTPException(503, {"message": "nflverse data could not be loaded; retry later.", "dataset": dataset, "season": season}) from exc


def availability(dataset):
    assets, seasons = manifest(dataset)
    if dataset == "schedule":
        # These releases contain all years in one asset; verify seasons from rows.
        with LOCK:
            try:
                df = nfl.load_schedules(True)
                seasons = sorted(df["season"].drop_nulls().unique().to_list())
            except (ConnectionError, ValueError) as exc:
                raise HTTPException(503, "Cannot inspect seasons inside the nflverse aggregate asset.") from exc
    filename = SPECS[dataset][1].format(season=current_season()) + ".parquet"
    return {"dataset": dataset, "available_seasons": seasons or None,
            "latest_season": max(seasons) if seasons else None,
            "current_season": current_season(),
            "current_season_available": current_season() in seasons if seasons else None,
            "season_availability_basis": "rows" if dataset == "schedule" else "release filenames; population must be checked separately",
            "current_asset": assets.get(filename), **source(dataset, current_season())}


def filter_rows(df, *, team=None, week=None, game=None, player=None, season_type=None):
    filters = [
        (team.upper() if team else None, ["team", "team_abbr", "home_team", "away_team", "posteam", "defteam", "possession_team"], "team"),
        (week, ["week"], "week"),
        (game, ["game_id", "nflverse_game_id"], "game"),
        (player, ["player_id", "gsis_id", "player_gsis_id", "passer_player_id", "receiver_player_id", "rusher_player_id"], "player (GSIS ID)"),
        (season_type, ["season_type", "game_type"], "season_type"),
    ]
    for value, candidates, label in filters:
        if value is None:
            continue
        columns = [c for c in candidates if c in df.columns]
        if not columns:
            raise HTTPException(422, f"This dataset has no {label} filter; inspect its schema or use a PBP join.")
        df = df.filter(pl.any_horizontal([pl.col(c) == value for c in columns]))
    return df


def inspect_rows(dataset, season, *, team=None, week=None, game=None, player=None, season_type=None, limit=25, offset=0, columns=None, latest_snapshot=True):
    df = load(dataset, season)
    if dataset == "teams":
        schedule = load("schedule", season)
        teams = set(schedule["home_team"].to_list() + schedule["away_team"].to_list())
        df = df.filter(pl.col("team_abbr").is_in(teams))
    if dataset == "depth_charts" and latest_snapshot and "dt" in df.columns:
        df = df.filter(pl.col("dt") == pl.col("dt").max().over("team"))
    df = filter_rows(df, team=team, week=week, game=game, player=player, season_type=season_type)
    schema = {c: str(t) for c, t in df.schema.items()}
    total = df.height
    if columns:
        chosen = list(dict.fromkeys(c.strip() for c in columns.split(",") if c.strip()))
        invalid = sorted(set(chosen) - set(df.columns))
        if invalid:
            raise HTTPException(422, {"unknown_columns": invalid, "available_columns": df.columns})
        df = df.select(chosen)
    return {"dataset": dataset, "season": season, "source": source(dataset, season),
            "retrieved_at": dt.datetime.now(dt.timezone.utc).isoformat(), "cache_ttl_seconds": int(os.environ["NFLREADPY_CACHE_DURATION"]),
            "total_matching_rows": total, "limit": limit, "offset": offset, "schema": schema,
            "rows": df.slice(offset, limit).to_dicts()}


def team_summary(team, season):
    team = team.upper()
    schedule = load("schedule", season)
    active = set(schedule["home_team"].to_list() + schedule["away_team"].to_list())
    if team not in active:
        raise HTTPException(422, {"message": "Use a team abbreviation from this season's schedule.", "teams": sorted(active)})
    games = schedule.filter(((pl.col("home_team") == team) | (pl.col("away_team") == team)) & (pl.col("game_type") == "REG") & pl.col("home_score").is_not_null() & pl.col("away_score").is_not_null())
    gp = games.height
    ids = games["game_id"].to_list()
    points = sum(r["home_score"] if r["home_team"] == team else r["away_score"] for r in games.to_dicts())
    allowed = sum(r["away_score"] if r["home_team"] == team else r["home_score"] for r in games.to_dicts())
    result = {"team": team, "season": season, "season_type": "REG", "games_played": gp,
              "points_per_game": points / gp if gp else None, "points_allowed_per_game": allowed / gp if gp else None,
              "definitions": {"games": "Regular-season schedule rows with both final scores. Points include all scoring phases.",
                              "passing": "Net team passing = passing_yards + signed sack_yards_lost. Gross passing is also returned.",
                              "yards": "Net passing plus rushing, using nflverse team stats, including their kneel/spike accounting.",
                              "turnovers": "Passing interceptions + fumbles_lost_total (all phases); takeaways use opponent totals.",
                              "downs": "PBP converted / (converted + failed). First downs include rush, pass and penalty flags. Null event flags on non-statistical rows are excluded from sums.",
                              "penalties": "nflverse team-stat penalties and penalty_yards; not a count of PBP penalty mentions."},
              "deferred": {"red_zone_td_pct": "Deferred: choose and validate a drive-entry denominator, including drives starting inside the 20, before publishing.", "red_zone_td_pct_allowed": "Same drive-level definition required."}, "warnings": []}
    if not gp:
        return result
    stats = load("team_stats", season).filter(pl.col("game_id").is_in(ids) & (pl.col("season_type") == "REG"))
    own = stats.filter(pl.col("team") == team)
    opp = stats.filter(pl.col("opponent_team") == team)
    complete = own.height == gp and opp.height == gp and own["game_id"].n_unique() == gp and opp["game_id"].n_unique() == gp
    result["team_stats_games"] = own["game_id"].n_unique()
    def total(frame, col):
        return frame[col].sum() if col in frame.columns and frame[col].null_count() == 0 else None
    for frame, suffix in [(own, ""), (opp, "_allowed")]:
        gross, sacks, rush = (total(frame, c) for c in ["passing_yards", "sack_yards_lost", "rushing_yards"])
        net = gross + sacks if gross is not None and sacks is not None else None
        values = {"gross_pass_yards": gross, "pass_yards": net, "rush_yards": rush, "yards": net + rush if net is not None and rush is not None else None}
        for key, value in values.items():
            result[f"{key}{suffix}_per_game"] = value / gp if complete and value is not None else None
        ints, fumbles = total(frame, "passing_interceptions"), total(frame, "fumbles_lost_total")
        result["takeaways_per_game" if suffix else "turnovers_per_game"] = (ints + fumbles) / gp if complete and ints is not None and fumbles is not None else None
    for col in ["penalties", "penalty_yards"]:
        value = total(own, col)
        result[f"{col}_per_game"] = value / gp if complete and value is not None else None
    if not complete:
        result["warnings"].append("Team stats do not contain exactly one row per team/completed game; affected metrics are null, not divided by mismatched GP.")
    pbp = load("pbp", season).filter(pl.col("game_id").is_in(ids))
    covered = pbp["game_id"].n_unique()
    duplicate_keys = pbp.select("game_id", "play_id").is_duplicated().any()
    # Check terminal scoreboard against schedule before treating PBP as complete.
    scores = pbp.group_by("game_id").agg(pl.col("total_home_score").max().alias("pbp_home"), pl.col("total_away_score").max().alias("pbp_away"))
    checked = games.join(scores, on="game_id", how="left")
    pbp_complete = covered == gp and not duplicate_keys and checked.filter((pl.col("home_score") == pl.col("pbp_home")) & (pl.col("away_score") == pl.col("pbp_away"))).height == gp
    result["pbp_games"] = covered
    if "play_deleted" in pbp.columns:
        pbp = pbp.filter(pl.col("play_deleted").fill_null(0) != 1)
    def event_total(frame, col):
        return frame[col].sum() if col in frame.columns and frame[col].count() else None
    for side, suffix in [("posteam", ""), ("defteam", "_allowed")]:
        frame = pbp.filter(pl.col(side) == team)
        for down in ["third", "fourth"]:
            made, failed = (event_total(frame, f"{down}_down_{c}") for c in ["converted", "failed"])
            denom = made + failed if made is not None and failed is not None else 0
            result[f"{down}_down_pct{suffix}"] = 100 * made / denom if pbp_complete and denom else None
        first = [event_total(frame, c) for c in ["first_down_pass", "first_down_rush", "first_down_penalty"]]
        result[f"first_downs{suffix}_per_game"] = sum(first) / gp if pbp_complete and all(v is not None for v in first) else None
    if not pbp_complete:
        result["warnings"].append("PBP game coverage, scoreboard or unique play keys do not match completed schedule games; down metrics withheld.")
    return result
