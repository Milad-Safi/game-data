from __future__ import annotations

# NHL ingestion script
# Pulls schedule by date, then pulls boxscore + play-by-play per game
# Converts each game into 2 rows (home team row + away team row) in team_games

import datetime as dt
import random
import time

import requests
from sqlalchemy import text

from .db import engine

# NHL API base url used for every request
API = "https://api-web.nhle.com/v1"

# Request + retry tuning
REQUEST_TIMEOUT = 30
MAX_RETRIES = 10

# Small throttle after successful requests to reduce long-run 429 responses
BASE_THROTTLE_SEC = 0.15

# Exponential backoff parameters when retrying
BACKOFF_BASE = 0.7
BACKOFF_CAP = 20.0


def _sleep_with_jitter(seconds: float):
    # Adds a small random delay on top of the requested sleep time
    # This prevents many requests (or many processes) from syncing and spiking together
    if seconds <= 0:
        return

    jitter = random.uniform(0.0, 0.25)
    time.sleep(seconds + jitter)


def get_json(url: str) -> dict:
    # Generic GET helper with retry logic

    # Returns parsed JSON dict or raises RuntimeError if all retries fail
    last_err: Exception | None = None

    for attempt in range(MAX_RETRIES):
        try:
            r = requests.get(url, timeout=REQUEST_TIMEOUT)

            if r.status_code == 429:
                # Rate limited by NHL
                # Prefer server-provided Retry-After
                ra = r.headers.get("Retry-After")
                if ra is not None:
                    try:
                        wait = float(ra)
                    except Exception:
                        wait = BACKOFF_BASE * (2**attempt)
                else:
                    wait = BACKOFF_BASE * (2**attempt)

                wait = min(wait, BACKOFF_CAP)
                _sleep_with_jitter(wait)
                continue

            if 500 <= r.status_code < 600:
                # Server-side temporary issue
                wait = min(BACKOFF_BASE * (2**attempt), BACKOFF_CAP)
                _sleep_with_jitter(wait)
                continue

            # Any other non-2xx becomes an exception here
            r.raise_for_status()

            data = r.json()

            # Throttle after success so sustained runs do not hit 429 as often
            _sleep_with_jitter(BASE_THROTTLE_SEC)
            return data

        except (requests.Timeout, requests.ConnectionError) as e:
            # Network issues can happen during long ingest runs
            # Retry with exponential backoff
            last_err = e
            wait = min(BACKOFF_BASE * (2**attempt), BACKOFF_CAP)
            _sleep_with_jitter(wait)
            continue
        except Exception as e:
            # Any other exception is treated as non-retryable
            last_err = e
            break

    raise RuntimeError(f"Failed GET after retries: {url}") from last_err


def daterange(start: dt.date, end: dt.date):
    # Yields each date from start to end inclusive
    cur = start
    while cur <= end:
        yield cur
        cur += dt.timedelta(days=1)


def fetch_schedule(date: dt.date):
    # Pulls the NHL schedule payload for a given date
    url = f"{API}/schedule/{date.isoformat()}"
    return get_json(url)


def fetch_boxscore(game_id: int):
    # Pulls boxscore which contains final scores, basic team stats, player stats, etc
    url = f"{API}/gamecenter/{game_id}/boxscore"
    return get_json(url)


def fetch_play_by_play(game_id: int):
    # Pulls play-by-play which contains events (penalties, goals, etc)
    # Used to compute PP opportunities + PP goals when boxscore fields are missing
    url = f"{API}/gamecenter/{game_id}/play-by-play"
    return get_json(url)


def get_int_any(d: dict, keys: list[str]):
    # Tries multiple keys inside dict d and returns the first value that can be coerced to int
    for k in keys:
        v = d.get(k)
        if v is None:
            continue
        try:
            return int(v)
        except Exception:
            pass
    return None


def get_float_any(d: dict, keys: list[str]):
    # Tries multiple keys inside dict d and returns the first value that can be coerced to float
    for k in keys:
        v = d.get(k)
        if v is None:
            continue
        try:
            return float(v)
        except Exception:
            pass
    return None


def pick_goalie_sv_from_box(box: dict, side: str) -> float | None:
    """
    Picks a single goalie save% for a team from the boxscore

    side meanings
      - "homeTeam" or "awayTeam"

    Where the data usually lives
      - box["playerByGameStats"][side]["goalies"]

    Fallback used when that is missing
      - box[side]["goalies"]
    """
    pbg = box.get("playerByGameStats") or {}
    team_stats = pbg.get(side) or {}
    goalies = team_stats.get("goalies") or []

    if not goalies:
        top = box.get(side) or {}
        goalies = top.get("goalies") or []

    if not goalies:
        return None

    # Prefer the goalie marked as starter, else fall back to first goalie row
    starters = [g for g in goalies if g.get("starter") is True]
    g = starters[0] if starters else goalies[0]

    v = g.get("savePctg")
    try:
        return float(v) if v is not None else None
    except Exception:
        return None


def _mmss_to_seconds(mmss: str) -> int:
    # Converts "MM:SS" into total seconds
    try:
        mm, ss = mmss.split(":")
        return int(mm) * 60 + int(ss)
    except Exception:
        return 0


def _event_abs_seconds(play: dict, reg_periods: int = 3) -> int:
    # Maps a play event to an absolute timestamp in seconds since game start
    pd = (play.get("periodDescriptor") or {})
    n = int(pd.get("number") or 0)
    ptype = (pd.get("periodType") or "").upper()
    tip = play.get("timeInPeriod") or "00:00"
    sec_in_period = _mmss_to_seconds(tip)

    # REG periods are 20 minutes each
    if ptype == "REG":
        base = max(0, n - 1) * 1200

    # OT periods are treated as 5 minutes each in this logic (regular season)
    elif ptype == "OT":
        if n <= reg_periods:
            ot_index = 0
        else:
            ot_index = n - reg_periods - 1
        base = reg_periods * 1200 + max(0, ot_index) * 300

    # SO and other types are treated as end of regulation baseline
    else:
        base = reg_periods * 1200

    return base + sec_in_period


def compute_special_teams_from_pbp(pbp: dict) -> dict:
    # Computes special teams totals directly from play-by-play

    plays = pbp.get("plays") or []
    home_team = (pbp.get("homeTeam") or {})
    away_team = (pbp.get("awayTeam") or {})
    home_id = int(home_team.get("id") or 0)
    away_id = int(away_team.get("id") or 0)
    reg_periods = int(pbp.get("regPeriods") or 3)

    # Penalty type codes that create manpower advantages
    manpower_types = {"MIN", "MAJ", "BEN"}

    # Types to ignore for PP opportunity math
    ignore_types = {"MIS", "GAM", "GAMMIS", "MAT", "PS"}

    # ---- PP opportunities
    # Store penalty durations by absolute time so true coincidentals can cancel out
    penalties_by_time: dict[int, dict[int, list[int]]] = {}
    for pl in plays:
        if (pl.get("typeDescKey") or "") != "penalty":
            continue

        details = pl.get("details") or {}
        p_type = str(details.get("typeCode") or "").upper()
        if not p_type or p_type in ignore_types or p_type not in manpower_types:
            continue

        duration_min = int(details.get("duration") or 0)
        if duration_min <= 0:
            continue

        team_id = int(details.get("eventOwnerTeamId") or 0)
        if team_id not in (home_id, away_id):
            continue

        t = _event_abs_seconds(pl, reg_periods=reg_periods)
        if t not in penalties_by_time:
            penalties_by_time[t] = {home_id: [], away_id: []}
        penalties_by_time[t][team_id].append(duration_min)

    pp_opps_home = 0
    pp_opps_away = 0

    for t in sorted(penalties_by_time.keys()):
        h = sorted(penalties_by_time[t].get(home_id, []))
        a = sorted(penalties_by_time[t].get(away_id, []))

        # Cancel coincidentals by matching same-duration penalties at the same timestamp
        i = j = 0
        h_rem: list[int] = []
        a_rem: list[int] = []

        while i < len(h) and j < len(a):
            if h[i] == a[j]:
                i += 1
                j += 1
            elif h[i] < a[j]:
                h_rem.append(h[i])
                i += 1
            else:
                a_rem.append(a[j])
                j += 1

        while i < len(h):
            h_rem.append(h[i])
            i += 1
        while j < len(a):
            a_rem.append(a[j])
            j += 1

        # Any remaining home penalty creates a PP opportunity for away
        pp_opps_away += len(h_rem)

        # Any remaining away penalty creates a PP opportunity for home
        pp_opps_home += len(a_rem)

    # ---- PP goals
    # Maintain active penalties as (end_time, releasable)
    # Releasable means it ends early after a PP goal (minors and bench minors)
    active_home: list[tuple[int, bool]] = []
    active_away: list[tuple[int, bool]] = []

    def prune(now: int):
        # Drop penalties that have expired by time now
        nonlocal active_home, active_away
        active_home = [(e, rel) for (e, rel) in active_home if e > now]
        active_away = [(e, rel) for (e, rel) in active_away if e > now]

    def add_penalty(team_id: int, start_s: int, p_type: str, duration_min: int):
        # Adds penalty segments into active list
        # Double minor is represented as two releasable segments
        nonlocal active_home, active_away
        releasable = p_type in {"MIN", "BEN"}

        if p_type == "MIN" and duration_min == 4:
            segs = [(start_s + 2 * 60, True), (start_s + 4 * 60, True)]
        else:
            segs = [(start_s + duration_min * 60, releasable)]

        if team_id == home_id:
            active_home.extend(segs)
        else:
            active_away.extend(segs)

    def advantage_team() -> int | None:
        # Determines which team has the man advantage at this moment
        # If penalty counts are equal, there is no advantage
        dh = len(active_home)
        da = len(active_away)
        if dh == da:
            return None

        # If away has more active penalties, home has advantage, and vice versa
        return home_id if da > dh else away_id

    def end_earliest_releasable(penalized_team_id: int):
        # After a PP goal, end the earliest releasable penalty on the penalized team
        nonlocal active_home, active_away

        arr = active_home if penalized_team_id == home_id else active_away
        releasables = [e for (e, rel) in arr if rel]
        if not releasables:
            return

        earliest = min(releasables)
        removed = False
        new_arr: list[tuple[int, bool]] = []

        for (e, rel) in arr:
            if not removed and rel and e == earliest:
                removed = True
                continue
            new_arr.append((e, rel))

        if penalized_team_id == home_id:
            active_home = new_arr
        else:
            active_away = new_arr

    pp_goals_home = 0
    pp_goals_away = 0

    # Process plays in chronological order to simulate penalties properly
    ordered = sorted(
        plays,
        key=lambda p: (
            _event_abs_seconds(p, reg_periods=reg_periods),
            int(p.get("sortOrder") or 0),
        ),
    )

    for pl in ordered:
        now = _event_abs_seconds(pl, reg_periods=reg_periods)
        prune(now)

        tkey = (pl.get("typeDescKey") or "")
        details = pl.get("details") or {}

        if tkey == "penalty":
            p_type = str(details.get("typeCode") or "").upper()
            if not p_type or p_type in ignore_types or p_type not in manpower_types:
                continue

            duration_min = int(details.get("duration") or 0)
            if duration_min <= 0:
                continue

            team_id = int(details.get("eventOwnerTeamId") or 0)
            if team_id not in (home_id, away_id):
                continue

            add_penalty(team_id, now, p_type, duration_min)

        elif tkey == "goal":
            scoring_team = int(details.get("eventOwnerTeamId") or 0)
            if scoring_team not in (home_id, away_id):
                continue

            # Only count as PP goal if scoring team currently has advantage
            adv = advantage_team()
            if adv is None or adv != scoring_team:
                continue

            # Record PP goal and release earliest releasable penalty for the penalized team
            if scoring_team == home_id:
                pp_goals_home += 1
                penalized = away_id
            else:
                pp_goals_away += 1
                penalized = home_id

            end_earliest_releasable(penalized)

    # Translate PP stats into PK stats
    home_pk_ga = pp_goals_away
    away_pk_ga = pp_goals_home
    home_pk_opps = pp_opps_away
    away_pk_opps = pp_opps_home

    return {
        "home_pp_goals": pp_goals_home,
        "home_pp_opps": pp_opps_home,
        "away_pp_goals": pp_goals_away,
        "away_pp_opps": pp_opps_away,
        "home_pk_goals_against": home_pk_ga,
        "home_pk_opps": home_pk_opps,
        "away_pk_goals_against": away_pk_ga,
        "away_pk_opps": away_pk_opps,
    }


def upsert_rows(rows: list[dict]) -> int:
    # Inserts or updates rows into team_games
    # Conflict key is (game_id, team)
    if not rows:
        return 0

    sql = text("""
        INSERT INTO team_games
        (game_id, game_date, team, opponent, is_home,
         goals_for, goals_against,
         shots_for, shots_against,
         pp_goals, pp_opps,
         pk_goals_against, pk_opps,
         goalie_sv_pct, win)
        VALUES
        (:game_id, :game_date, :team, :opponent, :is_home,
         :goals_for, :goals_against,
         :shots_for, :shots_against,
         :pp_goals, :pp_opps,
         :pk_goals_against, :pk_opps,
         :goalie_sv_pct, :win)
        ON CONFLICT (game_id, team) DO UPDATE SET
          game_date = EXCLUDED.game_date,
          opponent = EXCLUDED.opponent,
          is_home = EXCLUDED.is_home,
          goals_for = EXCLUDED.goals_for,
          goals_against = EXCLUDED.goals_against,
          win = EXCLUDED.win,
          
          shots_for = EXCLUDED.shots_for,
          shots_against = EXCLUDED.shots_against,
          pp_goals = EXCLUDED.pp_goals,
          pp_opps = EXCLUDED.pp_opps,
          pk_goals_against = EXCLUDED.pk_goals_against,
          pk_opps = EXCLUDED.pk_opps,
          goalie_sv_pct = EXCLUDED.goalie_sv_pct;
    """)

    with engine.begin() as conn:
        for row in rows:
            conn.execute(sql, row)

    return len(rows)


def ingest_date(date: dt.date, debug: bool = False) -> int:
    # Ingests every game that happened on a single date
    # Flow per date
    #   - fetch schedule for that date
    #   - extract game ids
    #   - for each game id
    #       - fetch boxscore
    #       - compute stats fields (shots, PP, PK, goalie save%)
    #       - if PP/PK fields missing, fetch play-by-play and compute from events
    #       - upsert 2 rows (home + away)

    data = fetch_schedule(date)

    # schedule payload stores games inside gameWeek blocks
    game_ids: list[int] = []
    for day in data.get("gameWeek", []):
        if day.get("date") == date.isoformat():
            for g in day.get("games", []):
                gid = g.get("id")
                if gid:
                    game_ids.append(int(gid))

    print(f"{date.isoformat()} found {len(game_ids)} games: {game_ids[:5]}")
    inserted = 0

    for gid in game_ids:
        box = fetch_boxscore(int(gid))
        if str(box.get("gameState") or "").upper() not in {"FINAL", "OFF"}:
            print(f"Skipping unfinished game {gid}")
            continue

        home = box.get("homeTeam", {}) or {}
        away = box.get("awayTeam", {}) or {}

        home_abbrev = home.get("abbrev")
        away_abbrev = away.get("abbrev")

        # Scores are final numbers on boxscore
        home_score = int(home.get("score", 0) or 0)
        away_score = int(away.get("score", 0) or 0)

        # teamStats contains PP fields sometimes, but not always
        team_stats = box.get("teamStats", {}) or {}
        home_stats = team_stats.get("home", {}) or {}
        away_stats = team_stats.get("away", {}) or {}

        # Shots on goal can appear at top-level team objects as "sog"
        # If missing, attempt to pull from teamStats with alternate key names
        home_sf = get_int_any(home, ["sog"])
        away_sf = get_int_any(away, ["sog"])

        if home_sf is None:
            home_sf = get_int_any(home_stats, ["sog", "shotsOnGoal", "shots"])
        if away_sf is None:
            away_sf = get_int_any(away_stats, ["sog", "shotsOnGoal", "shots"])

        # PP goals + PP opportunities
        home_pp_goals = get_int_any(home_stats, ["powerPlayGoals", "ppGoals"])
        home_pp_opps = get_int_any(home_stats, ["powerPlayOpportunities", "ppOpportunities"])
        away_pp_goals = get_int_any(away_stats, ["powerPlayGoals", "ppGoals"])
        away_pp_opps = get_int_any(away_stats, ["powerPlayOpportunities", "ppOpportunities"])

        # PK goals against + times shorthanded
        home_pk_ga = get_int_any(home_stats, ["penaltyKillGoalsAgainst"])
        home_pk_opps = get_int_any(home_stats, ["timesShorthanded"])
        away_pk_ga = get_int_any(away_stats, ["penaltyKillGoalsAgainst"])
        away_pk_opps = get_int_any(away_stats, ["timesShorthanded"])

        # If PK is missing, derive it from opponent PP where possible
        if home_pk_ga is None:
            home_pk_ga = away_pp_goals
        if home_pk_opps is None:
            home_pk_opps = away_pp_opps
        if away_pk_ga is None:
            away_pk_ga = home_pp_goals
        if away_pk_opps is None:
            away_pk_opps = home_pp_opps

        # Decide if play-by-play special teams compute is needed
        needs_special = any(
            v is None
            for v in (
                home_pp_goals, home_pp_opps,
                away_pp_goals, away_pp_opps,
                home_pk_ga, home_pk_opps,
                away_pk_ga, away_pk_opps,
            )
        )

        if needs_special:
            # play-by-play compute is slower, so only do it when needed
            try:
                pbp = fetch_play_by_play(int(gid))
                st = compute_special_teams_from_pbp(pbp)

                home_pp_goals = st["home_pp_goals"] if home_pp_goals is None else home_pp_goals
                home_pp_opps = st["home_pp_opps"] if home_pp_opps is None else home_pp_opps
                away_pp_goals = st["away_pp_goals"] if away_pp_goals is None else away_pp_goals
                away_pp_opps = st["away_pp_opps"] if away_pp_opps is None else away_pp_opps

                home_pk_ga = st["home_pk_goals_against"] if home_pk_ga is None else home_pk_ga
                home_pk_opps = st["home_pk_opps"] if home_pk_opps is None else home_pk_opps
                away_pk_ga = st["away_pk_goals_against"] if away_pk_ga is None else away_pk_ga
                away_pk_opps = st["away_pk_opps"] if away_pk_opps is None else away_pk_opps
            except Exception as e:
                # If play-by-play fails, ingestion continues
                if debug:
                    print("WARN: play-by-play special teams compute failed", gid, e)

        # Goalie save% per team from boxscore goalie rows
        home_sv = pick_goalie_sv_from_box(box, "homeTeam")
        away_sv = pick_goalie_sv_from_box(box, "awayTeam")

        # Build the two DB rows for this game
        rows = [
            {
                "game_id": int(gid),
                "game_date": date.isoformat(),
                "team": home_abbrev,
                "opponent": away_abbrev,
                "is_home": True,
                "goals_for": home_score,
                "goals_against": away_score,
                "shots_for": home_sf,
                "shots_against": away_sf,
                "pp_goals": home_pp_goals,
                "pp_opps": home_pp_opps,
                "pk_goals_against": home_pk_ga,
                "pk_opps": home_pk_opps,
                "goalie_sv_pct": home_sv,
                "win": (home_score > away_score),
            },
            {
                "game_id": int(gid),
                "game_date": date.isoformat(),
                "team": away_abbrev,
                "opponent": home_abbrev,
                "is_home": False,
                "goals_for": away_score,
                "goals_against": home_score,
                "shots_for": away_sf,
                "shots_against": home_sf,
                "pp_goals": away_pp_goals,
                "pp_opps": away_pp_opps,
                "pk_goals_against": away_pk_ga,
                "pk_opps": away_pk_opps,
                "goalie_sv_pct": away_sv,
                "win": (away_score > home_score),
            },
        ]

        # upsert_rows returns number of rows written (2 per game normally)
        inserted += upsert_rows(rows)

    return inserted


def ingest_range(start: str, end: str, debug_day: str | None = None):
    # Ingests date-by-date across an inclusive ISO date range
    s = dt.date.fromisoformat(start)
    e = dt.date.fromisoformat(end)
    total = 0

    for d in daterange(s, e):
        total += ingest_date(d, debug=(debug_day == d.isoformat()))
        print(f"{d.isoformat()}: +{total} rows total")

    print("DONE. Total inserted rows:", total)


if __name__ == "__main__":
    #   python -m app.ingest_nhl YYYY-MM-DD YYYY-MM-DD [DEBUG_DAY]
    import sys

    if len(sys.argv) not in (3, 4):
        print("Usage: python -m app.ingest_nhl YYYY-MM-DD YYYY-MM-DD [DEBUG_DAY]")
        raise SystemExit(1)

    start = sys.argv[1]
    end = sys.argv[2]
    debug_day = sys.argv[3] if len(sys.argv) == 4 else None

    ingest_range(start, end, debug_day=debug_day)
