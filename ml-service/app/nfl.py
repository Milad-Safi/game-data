"""NFL TD picks and bounded source inspection, visible in FastAPI /docs."""
from enum import Enum
import json
from typing import Literal

from fastapi import APIRouter, Query
from fastapi.responses import Response

from . import nfl_data as data
from . import nfl_td

router = APIRouter(prefix="/v1/nfl", tags=["NFL · TD Predictor & data"])
Dataset = Enum("Dataset", {name: name for name in data.SPECS}, type=str)


def response(value):
    # Polars data can contain NaN/infinity and timestamps; normalize non-finite
    # numbers instead of emitting invalid JSON or failing the whole sample.
    import math
    def clean(v):
        if isinstance(v, float) and not math.isfinite(v):
            return None
        if isinstance(v, dict):
            return {k: clean(x) for k, x in v.items()}
        if isinstance(v, (list, tuple)):
            return [clean(x) for x in v]
        return v
    return Response(json.dumps(clean(value), default=str, allow_nan=False), media_type="application/json")


@router.get("/datasets")
def datasets():
    """Dataset catalog without downloading full seasons. Use availability for verified seasons."""
    return {"current_season": data.current_season(), "provider": "free nflverse only",
            "datasets": [{"dataset": name, "sample_route": f"/v1/nfl/data/{name}",
                          "availability_route": f"/v1/nfl/availability/{name}",
                          **data.source(name, data.current_season())} for name in data.SPECS],
            "freshness": "On-demand filesystem cache, one hour by default. No data downloads on startup. Retrieved time is not the source's last update.",
            "joins": ["PBP passer/receiver/rusher IDs → weekly roster GSIS IDs, constrained by season/team/week."]}


@router.get("/availability/{dataset}")
def availability(dataset: Dataset):
    """Verified release seasons (or actual row seasons for aggregate files)."""
    return data.availability(dataset.value)


@router.get("/data/{dataset}")
def rows(dataset: Dataset, season: int | None = Query(None, ge=1920, le=2100),
         week: int | None = Query(None, ge=0, le=22), team: str | None = None,
         game: str | None = None, player: str | None = Query(None, description="GSIS player ID"),
         season_type: Literal["REG", "POST"] | None = None,
         limit: int = Query(25, ge=1, le=200), offset: int = Query(0, ge=0),
         columns: str | None = Query(None, description="Optional comma-separated actual column names"),
         latest_snapshot: bool = Query(True, description="Depth charts: latest timestamp per team; false exposes history")):
    """Actual source rows and full schema. Unsupported filters return 422, never silently ignored.

    Team matches either side of a game.
    Samples are bounded, but cold loading may download a complete season internally.
    """
    return response(data.inspect_rows(dataset.value, season or data.current_season(), team=team, week=week,
                                     game=game, player=player, season_type=season_type, limit=limit,
                                     offset=offset, columns=columns, latest_snapshot=latest_snapshot))


@router.get("/teams/{team}/summary")
def summary(team: str, season: int | None = Query(None, ge=1999, le=2100)):
    """Initial regular-season summary. Definitions, denominator checks and deferred metrics included."""
    return response(data.team_summary(team, season or data.current_season()))


@router.get("/td-predictor/games")
def td_games(week: int | None = Query(None, ge=1, le=18), team: str | None = None):
    """Picks for EVERY upcoming current-season regular-season game; optionally filter week/team.

    No probabilities or numerical ratings. Missing evidence produces partial/empty picks.
    Each result contains its expected QBs, selected players, supporting stats and reasons.
    """
    return response(nfl_td.predict(week=week, team=team))


@router.get("/td-predictor/games/{game_id}")
def td_game(game_id: str):
    """Full game inspection: expected QB, eligible/excluded candidates, usage and TD splits."""
    return response(nfl_td.predict(game_id=game_id))
