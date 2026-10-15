# NFL TD Predictor backend

Python/FastAPI only, using the existing free nflverse/nflreadpy loaders. No API keys,
NFL database, TypeScript comparison changes, probabilities or numerical
player ratings. Only the current NFL season's completed regular-season games feed
TD calculations. Current season comes from the existing nflreadpy resolver.

## Inspect

Run from `ml-service`: `.venv/bin/python -m uvicorn app.main:app --reload --port 8000`.
Open **http://localhost:8000/docs**, section **NFL · TD Predictor & data**.

- `GET /v1/nfl/td-predictor/games`: every upcoming regular-season game in the next NFL week, expected QBs,
  1–5 total picks when eligible evidence exists, including a distinct lower-volume sneaky pick, stats and reasons.
  Optional `team` filter. No season parameter or historical fallback.
- `GET /v1/nfl/td-predictor/games/{game_id}`: additionally includes both teams'
  eligible/excluded candidates, QB connections, rushing shares, recent opportunities,
  offensive TD distribution and opponent TD allowance relative to the current league.
- Existing bounded source inspection remains at `/v1/nfl/datasets`,
  `/v1/nfl/availability/{dataset}`, `/v1/nfl/data/{dataset}` and
  `/v1/nfl/teams/{team}/summary`. It is useful for investigating the predictor's inputs.
  These inspection endpoints retain their explicit season filters; the predictor
  never uses historical seasons.

Useful requests:

- `/v1/nfl/td-predictor/games`
- `/v1/nfl/td-predictor/games?team=BUF`
- `/v1/nfl/td-predictor/games/{game_id}`

Game IDs should come from the list endpoint. Completed, already-started and non-REG
games are not prediction targets. Schedule times are interpreted in America/New_York.
Upcoming-week matchups use today's evidence and availability. Missing game-week injury reports are flagged per game.

## Data reuse and cleanup

`nfl_data.py` retains schedules, teams, team/player stats, PBP, current and weekly
rosters, depth charts, injuries and player ID mappings. `nfl_td.py` adds aggregation
and transparent selection; `nfl.py` exposes it through the existing router.

Removed unused participation/FTN/NGS exploration dataset entries, charting joins,
defensive diagnostics and `/v1/nfl/defense/diagnostics`. Repository references were
checked first; no site feature depended on those Python exploration paths. No package
or shared cache was removed. Historical coverage analysis is no longer part of this API.

## Evidence definitions

- Completed games require both schedule scores and matching PBP terminal scoreboards.
  Mismatches are excluded from ALL opportunities and team-game denominators and listed.
  Duplicate PBP play keys or ambiguous roster joins fail explicitly.
- Deleted/no-play rows and two-point tries are excluded. Targets include identifiable
  incompletions, excluding sacks/spikes. Missing receivers are ignored and counted,
  never assigned. Target shares use identifiable targets only.
- Rushing excludes kneels, includes QB scrambles. Non-scramble QB carries are exposed,
  but are not labelled as confirmed designed plays.
- Red zone / inside 10 / inside 5 use the play's starting distance to goal: <=20/10/5.
  Inside-5 counts are shown even for small samples; one isolated receiving opportunity
  cannot independently qualify a sneaky pick.
- Receiving connections are keyed by team + expected QB GSIS ID + receiver GSIS ID.
  A new QB with no current-season history has zero connection evidence; another QB's
  targets are never substituted. Generic historical team targets remain inspectable.
- Recent means the last TWO verified completed team games, including zero-usage games.
- TD scoring uses `td_player_id` and `td_team`, not automatically the passer or first
  receiver. Weekly season/team/GSIS positions classify historical scores; current roster
  position is a fallback. FB/HB map to RB. Unclassified or unusual TDs remain `other`.
  Defensive/special-teams TDs are not offensive pass/rush TDs. Unknown joins are counted.
- Offensive and opposing defensive categories: RB rushing, QB rushing, WR receiving,
  TE receiving, RB receiving, other. Opponent rates divide by verified opponent games;
  league rates divide by all verified team-games (two per game). Zero games => null rate.
  Small-sample category differences are descriptive, not fitted statistical effects.

## Expected QB and availability

Prefer an eligible scheduled QB; otherwise take latest depth-chart QB order, then
current-season identifiable passing volume over the team's last two verified games.
Treat that selection as the starter. Skip unavailable QBs and return skipped IDs/reasons.

Eligibility requires current team roster status ACT. Reserve/IR/PUP, inactive,
practice-squad, suspended, exempt, cut and retired statuses cannot be selected.
Unrecognized status is withheld rather than assumed active. Latest team report-week
Out/Doubtful excludes; Questionable and limited practice do not. When multiple reports
exist for a player in that same week, any Out/Doubtful signal excludes conservatively.
Old individual injury entries are not carried forward after a newer team report exists.
The API shows source report week, statuses and depth timestamp. An absent injury entry
is not a verified declaration of health. Required source failures return an error rather
than silently disabling injury filtering. There is no live-inactives guarantee.

Eligibility filters upcoming picks only. All verified past plays remain in totals even
if the player is now unavailable. Vacated opportunities are not assigned to backups.

## Selection rules (transparent heuristics, not trained)

Only the upcoming NFL week is generated. The response includes `upcoming_week`;
there is no week selector. As games finish and source caches refresh, season evidence
is recomputed. Once the current week's remaining kickoffs pass, the next week opens.

Evaluate rushing and receiving as separate routes; receiving evidence uses only the
expected QB. Recent route usage is required. Main eligibility requires two inside-10
opportunities, one plus a TD, or TDs in at least two separate current-season team games.
QB rushing additionally requires a rushing TD or three inside-5 carries. Stafford
remains excluded as a rushing pick, not as a passer.

Internal role evidence = `(0.5 * inside10 + route TDs + distinct scoring games) / team GP`.
Defense uses `(opponent category TDs + 3 * league category TD/game) / (opponent GP + 3)`.
The ratio to league adjusts evidence by `1 + clamp((ratio - 1)/2, -0.20, 0.20)`.
Recent route usage breaks ties. These are explicit heuristics, not validated probabilities;
no numerical ranking scores are returned. If no main candidate qualifies, the best
available recent-role candidate can be selected with a limited-evidence label.

Sneaky picks must be outside the top two team touch/target players AND top two TD scorers,
with <=20% total opportunity share. Known WR1/WR2 and starting RB/TE are excluded.
QBs with >=20% of inside-10 carries or TDs in >=2 games are main-role candidates, not sneaky.
Prefer inside-10/TD evidence. Otherwise use positional defense among recent-role candidates.
Reserve the sneaky slot before adding extra mains; never duplicate a player. No real-role
candidate means no invented pick. No betting odds or prior-season reputation are used.

Game pick limits use offense/opponent defensive TD rates, each stabilized with three
league-average games. Relative combined rate below 0.90 / 1.10 / 1.30 sets caps of 2 / 3 / 4;
1.30 or above caps at 5. The cap includes sneaky. Extra mains must retain at least half
the leading main's adjusted evidence, so games can finish below the cap. Game context
is descriptive, not a calibrated scoring forecast. No probabilities or 0–100 scores.

Reasons describe scoring consistency, inside-10 usage and recent route volume. Favorable
defense supports a pick; tougher defense appears as a short concern. Generic caveats
stay at game level rather than repeating on every card. New responses expose
`selection_version: role_first_v3`, `scoring_environment` and `scoring_evidence`.

The cards display targets and carries on plays SNAPPED inside the 10. This is not an
end-zone target count. PBP provides air yards but no explicit end-zone-target column;
we do not substitute an estimate. Past red-zone stats remain available for inspection.
Headshots come from current roster `headshot_url`; missing/broken images use team logos.

## Operations

No startup downloads. Existing nflreadpy filesystem cache defaults to one hour;
aggregate TD snapshot uses the existing in-memory cache for 15 minutes. A lock prevents
concurrent cold TD requests duplicating the build. PBP is narrowed to needed columns
before row iteration; only compact aggregates remain cached, not full PBP/depth files.
`generated_at` is calculation time, not proof of source freshness. Recomputing uses
current source data so corrections are incorporated when caches expire. Render cold
starts still apply. No background scheduler or infrastructure was added.

## Documentation

- https://nflreadpy.nflverse.com/api/load_functions/
- https://nflreadr.nflverse.com/articles/dictionary_pbp.html
- https://nflreadr.nflverse.com/articles/dictionary_rosters.html
- https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html

Data credit: nflverse and the original providers identified in each release. The
predictor does not load FTN, historical participation, coverage, weather or snap counts.

## Frontend

`/nfl/td-predictor` fetches the Python games endpoint once per page mount (Retry makes
one additional attempt). Matchups and reasons expand inline, and team filtering is local.
It uses the same `NEXT_PUBLIC_EDGE_API_BASE` setting as the existing simulator.
No per-game frontend routes or TypeScript predictor calculations were added.
