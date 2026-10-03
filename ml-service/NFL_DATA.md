# NFL TD Predictor backend

Python/FastAPI only, using the existing free nflverse/nflreadpy loaders. No API keys,
NFL database, TypeScript comparison changes, frontend, probabilities or numerical
player ratings. Only the current NFL season's completed regular-season games feed
TD calculations. Current season comes from the existing nflreadpy resolver.

## Inspect

Run from `ml-service`: `.venv/bin/python -m uvicorn app.main:app --reload --port 8000`.
Open **http://localhost:8000/docs**, section **NFL · TD Predictor & data**.

- `GET /v1/nfl/td-predictor/games`: EVERY upcoming regular-season game, expected QBs,
  up to two main picks, one distinct sneaky pick when justified, stats and reasons.
  Optional `week` (1–18) and `team` filters. No season parameter or historical fallback.
- `GET /v1/nfl/td-predictor/games/{game_id}`: additionally includes both teams'
  eligible/excluded candidates, QB connections, rushing shares, recent opportunities,
  offensive TD distribution and opponent TD allowance relative to the current league.
- Existing bounded source inspection remains at `/v1/nfl/datasets`,
  `/v1/nfl/availability/{dataset}`, `/v1/nfl/data/{dataset}` and
  `/v1/nfl/teams/{team}/summary`. It is useful for investigating the predictor's inputs.
  These inspection endpoints retain their explicit season filters; the predictor
  never uses historical seasons.

Useful requests:

- `/v1/nfl/td-predictor/games?week=4`
- `/v1/nfl/td-predictor/games?team=BUF`
- `/v1/nfl/td-predictor/games/2026_04_NE_BUF`

Game IDs should come from the list endpoint. Completed, already-started and non-REG
games are not prediction targets. Schedule times are interpreted in America/New_York.
Future matchups use today's evidence; this is not a projection of future roster moves,
QB changes or injury recovery. Missing game-week injury reports are flagged per game.

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

## Selection rules (deliberately simple, not trained)

**Main eligibility:** current eligible roster player, supported position (QB/RB/WR/TE),
at least one relevant opportunity in the last two verified team games, and either a
red-zone opportunity or five season opportunities. Receiving opportunities must come
from the expected QB; rushing opportunity is considered for RBs and the expected QB.

Order eligible candidates lexicographically by inside-5 opportunities, inside-10,
red-zone, recent opportunities, positional opponent allowance relative to league,
then season opportunities. Stable player ID breaks remaining equality. Select up to
TWO across BOTH teams, not two per team. No weighted composite score is calculated.

**Sneaky eligibility is separate:** outside team top two in all-QB targets + carries,
no more than 20% of those team opportunities, recent relevant opportunity, plus either
at least two expected-QB red-zone targets OR at least two red-zone carries including
an inside-10 carry. Exclude selected main picks. Order by relevant red-zone opportunity
fraction, inside-10 opportunities, recent opportunity, then player ID. This emphasizes
small but valuable roles, not simply the third overall candidate. No superstar fallback
is forced when this pool is empty.

Return `partial` and an explicit reason if there is no justified main/sneaky pick.
Before the first completed game (or with no verified PBP), return upcoming games with
`insufficient_data` and empty picks. Never borrow last season or invent player roles.

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
