from __future__ import annotations

import datetime as dt

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .trend_model import predict_team_trend
from .season import CurrentSeasonError, current_season_query
from .nhlpy_proxy import nhl_client, capabilities as nhlpy_capabilities

# Use shared helper cache file
from .cache import cached

app = FastAPI(title="Game Data API", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _teams_all_cached():
    # Cache the NHL team list for 1 hour (same key + TTL as before)
    def build():
        c = nhl_client()
        return c.teams.teams()

    return cached("nhlpy_teams_all", 3600, build)


# Core endpoints

# Endpoint for getting the trend of the team (Machine Learning)
@app.get("/v1/trend/team")
def trend_team(team: str):
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    try:
        with current_season_query():
            return predict_team_trend(team=team.upper(), as_of=today)
    except CurrentSeasonError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
 
@app.get("/v1/nhl/capabilities")
def nhl_capabilities():
    result = nhlpy_capabilities()
    result.get("modules", {}).pop("edge", None)
    return {"ok": True, **result}

@app.get("/v1/nhl/teams/all")
def nhl_teams_all():
    return {"ok": True, "data": _teams_all_cached()}
