"""Official current season, plus explicit historical date conversion."""
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date
from threading import Lock
from time import monotonic

import requests

_cached_season: int | None = None
_expires_at = 0.0
_lock = Lock()
_query_year: ContextVar[int | None] = ContextVar("query_season_year", default=None)


class CurrentSeasonError(RuntimeError):
    pass


def season_start_year(as_of: str | date) -> int:
    day = date.fromisoformat(as_of) if isinstance(as_of, str) else as_of
    return day.year if day.month >= 7 else day.year - 1


def current_season_id() -> int:
    global _cached_season, _expires_at
    with _lock:
        if _cached_season is not None and monotonic() < _expires_at:
            return _cached_season
        try:
            response = requests.get(
                "https://api-web.nhle.com/v1/standings/now",
                timeout=10,
                headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"},
            )
            response.raise_for_status()
            rows = response.json().get("standings")
            if not isinstance(rows, list) or not rows:
                raise ValueError("Missing standings")
            season = rows[0].get("seasonId")
            if (type(season) is not int or len(str(season)) != 8
                    or season % 10000 != season // 10000 + 1
                    or any(row.get("seasonId") != season for row in rows)):
                raise ValueError("Invalid season")
        except Exception as exc:
            raise CurrentSeasonError("Current NHL season is unavailable. Please try again later.") from exc
        _cached_season = season
        _expires_at = monotonic() + 3600
        return season


@contextmanager
def current_season_query():
    """Select the current query season without changing model inference logic."""
    token = _query_year.set(current_season_id() // 10000)
    try:
        yield
    finally:
        _query_year.reset(token)


def query_season_year(as_of: str) -> int:
    year = _query_year.get()
    return year if year is not None else season_start_year(as_of)
