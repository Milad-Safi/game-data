# NFL comparison: TypeScript snapshots

The NFL comparison does not call FastAPI/Render. Python exploration files remain unchanged.

- Page: `/nfl/compare`
- Read-only route: `/api/nfl/compare?team1=BUF&team2=KC&range=season`
- Ranges: `season`, `last1`, `last2`, `last3`, `last4`, `last5`, `last10` (each team's most recent included games).
- Refresh manually if needed: `npm run refresh:nfl -- 2026` using Node 24+.
- Automatic refresh: `.github/workflows/weekly-nfl-summary.yml`, Thursday 10:23 UTC, after nflverse's Wednesday-night corrections. Supports Actions → Run workflow as well.

The job streams free nflverse CSV files using TypeScript, recomputes the season, validates results and commits only `src/data/nfl-summary.json` to the default branch. No credentials for a data provider, external database or Python process are needed. The workflow uses GitHub's built-in token with `contents: write`; repository rules must permit the bot to update that file. The existing NHL workflow is not modified. Scheduled workflows start after this file is pushed to the default branch; GitHub controls scheduling and may delay runs or disable scheduled workflows in inactive public repositories.

The production route reads the small snapshot from this public repository's `main` branch, cached by Next.js for one hour. Weekly data changes therefore don't require a deployment. A bundled snapshot is the fallback if the remote copy cannot be checked. The page displays update date, latest included game date, source warnings and a warning after 10 days without an update. Local development uses the bundled file. If this repository moves, becomes private or changes default branch, update the route's source URL/publication mechanism. No GitHub write operation happens inside the public API route.

The first saved snapshot contains all 32 teams and 49 games through 2026-10-01, generated 2026-10-03. No games were excluded. Snapshot size is about 115 KB; full-season PBP is never downloaded on a page request.

## Data and safeguards

Sources are exclusively nflverse release files:
- `schedules/games.csv`
- `stats_team/stats_team_week_{season}.csv`
- `stats_player/stats_player_week_{season}.csv`
- `pbp/play_by_play_{season}.csv.gz`

Only regular-season games with both final schedule scores qualify. An included game requires both teams' stats, player yardage totals that reconcile with team passing/rushing/receiving yards, unique game/team/player and game/play keys, and matching PBP scoreboards. Missing or inconsistent games are reported and excluded from **every** metric so denominators stay consistent. The refresh refuses to remove previously verified games or replace a newer season; failed refreshes leave the previous snapshot untouched. Each refresh rebuilds from source to incorporate corrections without double-counting games. Snapshot files are written atomically.

Team aliases map nflverse `LA` to UI `LAR`, `JAC` to `JAX` and `WSH` to `WAS`. Dates and game IDs determine last-N ordering, not source row order. The season automatically rolls over in August; an explicit year can be passed to the refresh command.

## Definitions

- Points include all scoring phases. Team passing yards are net (gross passing plus signed negative sack yards). Total yards are net passing plus rushing.
- Turnovers are passing interceptions plus total lost fumbles; takeaways are opponent turnovers. Penalties use team aggregates.
- First downs include passing, rushing and penalty first downs. Third/fourth-down rates use summed conversion and failed-attempt flags, never an average of game percentages. Deleted plays are excluded; null non-statistical flags do not count as events.
- Position totals group player box scores by their recorded position and divide by team games, not individual appearances. RB includes RB/FB/HB. QB passing is gross; it differs from net team passing. Allowed production groups opponent players. Unattributed zero-yard team records are skipped; unattributed production is not silently assigned a position.
- Red-zone TD percentage is a **derived definition**, not a claim to reproduce official box-score red-zone totals: a drive with a recorded offensive down at or inside the opponent's 20 counts once, including drives starting there, penalty downs and kneel-down possessions. Only offensive pass/rush TDs count as successes. PAT/two-point plays are excluded. `fixed_drive`, possession team and game identify a drive. The page discloses this definition.
- No games or no conversion opportunities yields `null`, displayed as an em dash. Bars show quantities, not which side is better.

## Validation

Real 2026 refresh completed. Typecheck and production build passed. Temporary checks covered all 32 teams across seven ranges, reciprocal offence/defence accounting, finite/ranged rates, empty-season behaviour and agreement with independently inspected Buffalo metrics. Browser checks covered real values, range changes and mobile width. No new test infrastructure was added.

[nflverse release files](https://github.com/nflverse/nflverse-data/releases) · [Update schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html)
