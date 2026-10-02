import { CurrentSeasonError, getCurrentSeasonId } from "@/lib/nhl/currentSeason";
import { getSeasonId } from "@/lib/nhl/season";
import { NextResponse } from "next/server";

import { query } from "@/lib/db";

export const runtime = "nodejs";

type MatchupFilter =
  | "season"
  | "last1"
  | "last2"
  | "last3"
  | "last4"
  | "last5"
  | "last10";

type Skater = {
  playerId: number;
  name: { default: string } | string;
  goals?: number;
  assists?: number;
  points?: number;
  sog?: number;
  shotAttempts?: number;
  shotsAttempted?: number;
  blockedShots?: number;
  blocks?: number;
};

type Goalie = {
  playerId: number;
  name: { default: string } | string;
  savePercentage?: number;
  saves?: number;
  shotsAgainst?: number;
};

type Boxscore = {
  playerByGameStats: {
    homeTeam: {
      forwards: Skater[];
      defense: Skater[];
      goalies?: Goalie[];
    };
    awayTeam: {
      forwards: Skater[];
      defense: Skater[];
      goalies?: Goalie[];
    };
  };
  homeTeam?: { abbrev?: string; score?: number; sog?: number };
  awayTeam?: { abbrev?: string; score?: number; sog?: number };
  periodDescriptor?: {
    number?: number;
    periodType?: string;
    maxRegulationPeriods?: number;
  };
  gameOutcome?: { lastPeriodType?: string; otPeriods?: number };
};

type PlayByPlayEvent = {
  typeDescKey?: string;
  details?: {
    shootingPlayerId?: number;
    blockingPlayerId?: number;
    eventOwnerTeamId?: number;
  };
};

type PlayByPlayResponse = {
  plays?: PlayByPlayEvent[];
};

type MatchupGameMeta = {
  season: number;
  gameId: number;
  gameDate: string;
  isTeamHome: boolean;
};

type PlayedMatchupGame = {
  meta: MatchupGameMeta;
  box: Boxscore;
};

type SkaterAgg = {
  playerId: number;
  name: string;
  goals: number;
  assists: number;
  points: number;
  sog: number;
  shotAttempts: number;
  blocks: number;
};

type GoalieAgg = {
  playerId: number;
  name: string;
  saves: number;
  shotsAgainst: number;
};

type MatchupRecordLine = {
  w: number;
  l: number;
  otl: number;
};

type ValueLeader = {
  playerId: number;
  name: string;
  value: number;
};

const REVALIDATE = 86400;
const BOX_RETRY_COUNT = 5;
const FETCH_RETRY_BASE_MS = 900;
const BOX_CONCURRENCY = 2;
const PBP_CONCURRENCY = 2;

function nameOf(n: Skater["name"] | Goalie["name"]) {
  return typeof n === "string" ? n : (n?.default ?? "");
}

function num(x: unknown) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function firstFinite(...values: unknown[]) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function round2(n: number | null) {
  if (n == null) return null;
  return +n.toFixed(2);
}

function round3(n: number | null) {
  if (n == null) return null;
  return +n.toFixed(3);
}

function newRec(): MatchupRecordLine {
  return { w: 0, l: 0, otl: 0 };
}

function isOtlGame(box: Boxscore) {
  const last = (box.gameOutcome?.lastPeriodType ?? "").toUpperCase();
  if (last === "OT" || last === "SO") return true;

  const pd = (box.periodDescriptor?.periodType ?? "").toUpperCase();
  if (pd === "OT" || pd === "SO") return true;

  return false;
}

function parseFilter(raw: string | null): MatchupFilter {
  const value = (raw ?? "season").trim().toLowerCase();

  if (
    value === "season" ||
    value === "last1" ||
    value === "last2" ||
    value === "last3" ||
    value === "last4" ||
    value === "last5" ||
    value === "last10"
  ) {
    return value;
  }

  return "season";
}

function filterWindow(filterBy: MatchupFilter): number | null {
  if (filterBy === "last1") return 1;
  if (filterBy === "last2") return 2;
  if (filterBy === "last3") return 3;
  if (filterBy === "last4") return 4;
  if (filterBy === "last5") return 5;
  if (filterBy === "last10") return 10;
  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

function getRetryDelayMs(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterSeconds = Number(retryAfter);

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  return FETCH_RETRY_BASE_MS * attempt;
}

async function fetchJsonWithRetry<T>(url: string): Promise<T> {
  for (let attempt = 1; attempt <= BOX_RETRY_COUNT; attempt += 1) {
    const response = await fetch(url, { next: { revalidate: REVALIDATE } });

    if (response.ok) {
      return (await response.json()) as T;
    }

    if (!isRetryableStatus(response.status) || attempt === BOX_RETRY_COUNT) {
      throw new Error(`Fetch ${response.status} ${response.statusText}: ${url}`);
    }

    await sleep(getRetryDelayMs(response, attempt));
  }

  throw new Error(`Failed to fetch ${url}`);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let i = 0;

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function fetchRosterIds(team: string) {
  const url = `https://api-web.nhle.com/v1/roster/${team}/current`;
  const res = await fetch(url, { next: { revalidate: 3600 } });

  const skaters = new Set<number>();
  const goalies = new Set<number>();

  if (!res.ok) return { skaters, goalies };

  const data = await res.json();

  for (const p of [...(data?.forwards ?? []), ...(data?.defensemen ?? [])]) {
    const id = num(p?.id);
    if (id) skaters.add(id);
  }

  for (const g of data?.goalies ?? []) {
    const id = num(g?.id);
    if (id) goalies.add(id);
  }

  return { skaters, goalies };
}

async function fetchMatchupGames(team: string, opp: string, startYear: number): Promise<MatchupGameMeta[]> {
  const result = await query<{
    game_id: string | number;
    game_date: string;
    is_home: boolean | null;
  }>(
    `
      SELECT tg.game_id, tg.game_date, tg.is_home
      FROM team_games tg
      WHERE tg.team = $1
        AND tg.opponent = $2
        AND SUBSTRING(tg.game_id::text, 5, 2) = '02'
        AND LEFT(tg.game_id::text, 4)::int IN ($3, $4)
      ORDER BY tg.game_date DESC, tg.game_id DESC
    `,
    [team, opp, startYear, startYear - 1]
  );

  return result.rows
    .map((row) => {
      const gameId = Number(row.game_id);
      if (!Number.isFinite(gameId) || gameId <= 0) return null;

      const startYear = Number(String(gameId).slice(0, 4));
      const season = Number(`${startYear}${startYear + 1}`);

      return {
        season: Number.isFinite(season) ? season : getSeasonId(startYear),
        gameId,
        gameDate: String(row.game_date ?? ""),
        isTeamHome: !!row.is_home,
      } satisfies MatchupGameMeta;
    })
    .filter((row): row is MatchupGameMeta => row !== null);
}

function addSkaterAgg(map: Map<number, SkaterAgg>, p: Skater, allowedIds: Set<number>) {
  const id = num(p.playerId);
  if (!id || !allowedIds.has(id)) return;

  const row = map.get(id) ?? {
    playerId: id,
    name: nameOf(p.name),
    goals: 0,
    assists: 0,
    points: 0,
    sog: 0,
    shotAttempts: 0,
    blocks: 0,
  };

  const goals = num(p.goals);
  const assists = num(p.assists);
  const points = num(p.points) || goals + assists;

  row.goals += goals;
  row.assists += assists;
  row.points += points;
  row.sog += num(p.sog);
  row.shotAttempts += firstFinite(
    (p as any)?.shotAttempts,
    (p as any)?.shotsAttempted,
    (p as any)?.shotAttemptsFor
  );
  row.blocks += firstFinite((p as any)?.blockedShots, (p as any)?.blocks);

  map.set(id, row);
}

function addGoalieAgg(map: Map<number, GoalieAgg>, g: Goalie, allowedIds: Set<number>) {
  const id = num(g.playerId);
  if (!id || !allowedIds.has(id)) return;

  const row = map.get(id) ?? {
    playerId: id,
    name: nameOf(g.name),
    saves: 0,
    shotsAgainst: 0,
  };

  const saves = num((g as any)?.saves);
  const shotsAgainst = num((g as any)?.shotsAgainst);

  row.saves += saves;
  row.shotsAgainst += shotsAgainst;

  map.set(id, row);
}

function addShotAttemptsFromPbp(
  plays: PlayByPlayEvent[],
  allowedSkaterIds: Set<number>,
  skaterAgg: Map<number, SkaterAgg>
) {
  for (const play of plays) {
    const type = (play.typeDescKey ?? "").toLowerCase();

    if (
      type !== "shot-on-goal" &&
      type !== "missed-shot" &&
      type !== "blocked-shot"
    ) {
      continue;
    }

    const shooterId = num(play.details?.shootingPlayerId);
    if (!shooterId || !allowedSkaterIds.has(shooterId)) continue;

    const row = skaterAgg.get(shooterId);
    if (!row) continue;

    row.shotAttempts += 1;
  }
}

function toHistoryLeader(row: SkaterAgg | null) {
  if (!row) return null;

  return {
    playerId: row.playerId,
    name: row.name,
    goals: row.goals,
    points: row.points,
    sog: row.sog,
  };
}

function topSkaterBy(
  list: SkaterAgg[],
  key: keyof Pick<SkaterAgg, "goals" | "points" | "sog">
) {
  if (!list.length) return null;

  return list.reduce((best, cur) => {
    if (cur[key] > best[key]) return cur;
    if (cur[key] === best[key] && cur.name.localeCompare(best.name) < 0) return cur;
    return best;
  }, list[0]);
}

function topValueLeaders(
  list: SkaterAgg[],
  key: keyof Pick<SkaterAgg, "goals" | "assists" | "sog" | "shotAttempts" | "blocks">,
  count: number
): ValueLeader[] {
  return [...list]
    .sort((a, b) => {
      if (b[key] !== a[key]) return b[key] - a[key];
      return a.name.localeCompare(b.name);
    })
    .filter((row) => row[key] > 0)
    .slice(0, count)
    .map((row) => ({
      playerId: row.playerId,
      name: row.name,
      value: row[key],
    }));
}

function topSavePctLeaders(list: GoalieAgg[], count: number): ValueLeader[] {
  return list
    .map((row) => ({
      playerId: row.playerId,
      name: row.name,
      value: row.shotsAgainst > 0 ? row.saves / row.shotsAgainst : 0,
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value;
      return a.name.localeCompare(b.name);
    })
    .slice(0, count)
    .map((row) => ({
      ...row,
      value: round3(row.value) ?? 0,
    }));
}

function buildEmptyResponse(
  team: string,
  opp: string,
  filterBy: MatchupFilter,
  seasons: number[],
  perSeason: { season: number; gameIds: number[] }[],
  perSeasonPlayed: { season: number; gameIds: number[] }[]
) {
  return {
    team,
    opp,
    filterBy,
    seasons,
    perSeason,
    perSeasonPlayed,
    gamesFound: 0,
    lastPlayedDate: null,

    records: {
      [team]: newRec(),
      [opp]: newRec(),
    },

    avgGoalsFor: {
      [team]: null,
      [opp]: null,
    },

    avgGoalsAgainst: {
      [team]: null,
      [opp]: null,
    },

    avgShotsOnGoal: {
      [team]: null,
      [opp]: null,
    },

    leaders: {
      [team]: {
        topGoals: null,
        topPoints: null,
        topSog: null,
        goalsLeaders: [],
        assistLeaders: [],
        sogLeaders: [],
        shotAttemptLeaders: [],
        blockLeaders: [],
        savePctLeaders: [],
      },
      [opp]: {
        topGoals: null,
        topPoints: null,
        topSog: null,
        goalsLeaders: [],
        assistLeaders: [],
        sogLeaders: [],
        shotAttemptLeaders: [],
        blockLeaders: [],
        savePctLeaders: [],
      },
    },
  };
}

// GET /api/matchups/history?team=TOR&opp=BOS&filterBy=last5
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const team = (searchParams.get("team") || "").trim().toUpperCase();
    const opp = (searchParams.get("opp") || "").trim().toUpperCase();
    const filterBy = parseFilter(searchParams.get("filterBy"));

    if (!team || !opp) {
      return NextResponse.json({ error: "Need ?team=TOR&opp=BOS" }, { status: 400 });
    }

    const currentSeason = await getCurrentSeasonId();
    const startYear = Math.floor(currentSeason / 10000);
    const seasons = [currentSeason, getSeasonId(startYear - 1)];
    const allGames = await fetchMatchupGames(team, opp, startYear);

    const perSeason = seasons.map((season) => ({
      season,
      gameIds: allGames
        .filter((game) => game.season === season)
        .map((game) => game.gameId),
    }));

    if (!allGames.length) {
      return NextResponse.json(
        buildEmptyResponse(team, opp, filterBy, seasons, perSeason, perSeason)
      );
    }

    const playedResults = await mapLimit(allGames, BOX_CONCURRENCY, async (game) => {
      const box = await fetchJsonWithRetry<Boxscore>(
        `https://api-web.nhle.com/v1/gamecenter/${game.gameId}/boxscore`
      );

      const homeSkaters = [
        ...(box.playerByGameStats?.homeTeam?.forwards ?? []),
        ...(box.playerByGameStats?.homeTeam?.defense ?? []),
      ];
      const awaySkaters = [
        ...(box.playerByGameStats?.awayTeam?.forwards ?? []),
        ...(box.playerByGameStats?.awayTeam?.defense ?? []),
      ];

      const homeGoalies = box.playerByGameStats?.homeTeam?.goalies ?? [];
      const awayGoalies = box.playerByGameStats?.awayTeam?.goalies ?? [];

      const hasPlayableStats =
        homeSkaters.length > 0 ||
        awaySkaters.length > 0 ||
        homeGoalies.length > 0 ||
        awayGoalies.length > 0;

      if (!hasPlayableStats) return null;

      return {
        meta: game,
        box,
      } satisfies PlayedMatchupGame;
    });

    const playedGames = playedResults.filter(
      (item): item is PlayedMatchupGame => item !== null
    );

    const perSeasonPlayed = seasons.map((season) => ({
      season,
      gameIds: playedGames
        .filter((game) => game.meta.season === season)
        .map((game) => game.meta.gameId),
    }));

    let selectedGames =
      filterBy === "season"
        ? playedGames.filter((game) => game.meta.season === currentSeason)
        : [...playedGames];

    const window = filterWindow(filterBy);
    if (window != null) {
      selectedGames = selectedGames.slice(0, window);
    }

    if (!selectedGames.length) {
      return NextResponse.json(
        buildEmptyResponse(team, opp, filterBy, seasons, perSeason, perSeasonPlayed)
      );
    }

    const [teamRoster, oppRoster] = await Promise.all([
      fetchRosterIds(team),
      fetchRosterIds(opp),
    ]);

    const teamSkatersAgg = new Map<number, SkaterAgg>();
    const oppSkatersAgg = new Map<number, SkaterAgg>();
    const teamGoaliesAgg = new Map<number, GoalieAgg>();
    const oppGoaliesAgg = new Map<number, GoalieAgg>();

    const recTeam = newRec();
    const recOpp = newRec();

    let gfTeamTotal = 0;
    let gfOppTotal = 0;
    let sogTeamTotal = 0;
    let sogOppTotal = 0;

    await mapLimit(selectedGames, PBP_CONCURRENCY, async (game) => {
      const { box } = game;
      const isTeamHome = game.meta.isTeamHome;

      const pbp = await fetchJsonWithRetry<PlayByPlayResponse>(
        `https://api-web.nhle.com/v1/gamecenter/${game.meta.gameId}/play-by-play`
      );

      const homeSkaters = [
        ...(box.playerByGameStats?.homeTeam?.forwards ?? []),
        ...(box.playerByGameStats?.homeTeam?.defense ?? []),
      ];
      const awaySkaters = [
        ...(box.playerByGameStats?.awayTeam?.forwards ?? []),
        ...(box.playerByGameStats?.awayTeam?.defense ?? []),
      ];

      const homeGoalies = box.playerByGameStats?.homeTeam?.goalies ?? [];
      const awayGoalies = box.playerByGameStats?.awayTeam?.goalies ?? [];

      const teamSkaters = isTeamHome ? homeSkaters : awaySkaters;
      const oppSkaters = isTeamHome ? awaySkaters : homeSkaters;

      const teamGoalies = isTeamHome ? homeGoalies : awayGoalies;
      const oppGoalies = isTeamHome ? awayGoalies : homeGoalies;

      for (const p of teamSkaters) addSkaterAgg(teamSkatersAgg, p, teamRoster.skaters);
      for (const p of oppSkaters) addSkaterAgg(oppSkatersAgg, p, oppRoster.skaters);

      for (const g of teamGoalies) addGoalieAgg(teamGoaliesAgg, g, teamRoster.goalies);
      for (const g of oppGoalies) addGoalieAgg(oppGoaliesAgg, g, oppRoster.goalies);

      addShotAttemptsFromPbp(pbp.plays ?? [], teamRoster.skaters, teamSkatersAgg);
      addShotAttemptsFromPbp(pbp.plays ?? [], oppRoster.skaters, oppSkatersAgg);

      const homeScore = num((box as any)?.homeTeam?.score);
      const awayScore = num((box as any)?.awayTeam?.score);
      const homeSog = num((box as any)?.homeTeam?.sog);
      const awaySog = num((box as any)?.awayTeam?.sog);

      const teamScore = isTeamHome ? homeScore : awayScore;
      const oppScore = isTeamHome ? awayScore : homeScore;
      const teamSog = isTeamHome ? homeSog : awaySog;
      const oppSog = isTeamHome ? awaySog : homeSog;

      gfTeamTotal += teamScore;
      gfOppTotal += oppScore;
      sogTeamTotal += teamSog;
      sogOppTotal += oppSog;

      if (teamScore !== oppScore) {
        const teamWon = teamScore > oppScore;
        const otl = isOtlGame(box);

        if (teamWon) {
          recTeam.w += 1;
          if (otl) recOpp.otl += 1;
          else recOpp.l += 1;
        } else {
          recOpp.w += 1;
          if (otl) recTeam.otl += 1;
          else recTeam.l += 1;
        }
      }
    });

    const gamesFound = selectedGames.length;

    const teamSkaterList = [...teamSkatersAgg.values()];
    const oppSkaterList = [...oppSkatersAgg.values()];
    const teamGoalieList = [...teamGoaliesAgg.values()];
    const oppGoalieList = [...oppGoaliesAgg.values()];

    const topGoalsTeam = topSkaterBy(teamSkaterList, "goals");
    const topGoalsOpp = topSkaterBy(oppSkaterList, "goals");

    const topPointsTeam = topSkaterBy(teamSkaterList, "points");
    const topPointsOpp = topSkaterBy(oppSkaterList, "points");

    const topSogTeam = topSkaterBy(teamSkaterList, "sog");
    const topSogOpp = topSkaterBy(oppSkaterList, "sog");

    return NextResponse.json({
      team,
      opp,
      filterBy,
      seasons,
      perSeason,
      perSeasonPlayed,
      gamesFound,
      lastPlayedDate: selectedGames[0]?.meta.gameDate ?? null,

      records: {
        [team]: recTeam,
        [opp]: recOpp,
      },

      avgGoalsFor: {
        [team]: round2(gfTeamTotal / gamesFound),
        [opp]: round2(gfOppTotal / gamesFound),
      },

      avgGoalsAgainst: {
        [team]: round2(gfOppTotal / gamesFound),
        [opp]: round2(gfTeamTotal / gamesFound),
      },

      avgShotsOnGoal: {
        [team]: round2(sogTeamTotal / gamesFound),
        [opp]: round2(sogOppTotal / gamesFound),
      },

      leaders: {
        [team]: {
          topGoals: toHistoryLeader(topGoalsTeam),
          topPoints: toHistoryLeader(topPointsTeam),
          topSog: toHistoryLeader(topSogTeam),
          goalsLeaders: topValueLeaders(teamSkaterList, "goals", 3),
          assistLeaders: topValueLeaders(teamSkaterList, "assists", 3),
          sogLeaders: topValueLeaders(teamSkaterList, "sog", 3),
          shotAttemptLeaders: topValueLeaders(teamSkaterList, "shotAttempts", 2),
          blockLeaders: topValueLeaders(teamSkaterList, "blocks", 2),
          savePctLeaders: topSavePctLeaders(teamGoalieList, 2),
        },

        [opp]: {
          topGoals: toHistoryLeader(topGoalsOpp),
          topPoints: toHistoryLeader(topPointsOpp),
          topSog: toHistoryLeader(topSogOpp),
          goalsLeaders: topValueLeaders(oppSkaterList, "goals", 3),
          assistLeaders: topValueLeaders(oppSkaterList, "assists", 3),
          sogLeaders: topValueLeaders(oppSkaterList, "sog", 3),
          shotAttemptLeaders: topValueLeaders(oppSkaterList, "shotAttempts", 2),
          blockLeaders: topValueLeaders(oppSkaterList, "blocks", 2),
          savePctLeaders: topSavePctLeaders(oppGoalieList, 2),
        },
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: e instanceof CurrentSeasonError ? 503 : 500 });
  }
}