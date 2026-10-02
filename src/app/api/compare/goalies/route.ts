import { CurrentSeasonError } from "@/lib/nhl/currentSeason";
import { NextResponse } from "next/server";

import { cleanStr, toNum } from "@/lib/nhl/parse";
import { toiToMinutes } from "@/lib/nhl/toi";
import {
    type CompareFilter,
    buildPlayerName,
    fetchClubStats,
    fetchRecentRegularSeasonGameIds,
    fetchSequentialBoxscores,
    isCompareFilter,
    isISODate,
    parseCompareWindow,
    todayISO_UTC,
} from "@/lib/nhl/compareBackend";

export const runtime = "nodejs";
export const revalidate = 60;

type GoalieCompareValue = {
    playerId: number;
    name: string;
    gp: number;
    wins: number;
    savePct: number | null;
    gaa: number | null;
    shutouts: number;
};

type GoalieComparePayload = {
    team: string;
    filterBy: CompareFilter;
    gamesUsed: number;
    starter: GoalieCompareValue | null;
    additional: GoalieCompareValue | null;
};

type GoalieAgg = {
    playerId: number;
    name: string;
    gp: number;
    wins: number;
    shotsAgainst: number;
    saves: number;
    goalsAgainst: number;
    minutes: number;
    shutouts: number;
};

function getTeamGoalieRowsFromBox(box: any, team: string): any[] {
    const awayAbbrev = cleanStr(box?.awayTeam?.abbrev)?.toUpperCase() ?? "";
    const homeAbbrev = cleanStr(box?.homeTeam?.abbrev)?.toUpperCase() ?? "";
    const stats = box?.playerByGameStats;

    if (!stats) return [];

    const side =
        awayAbbrev === team
            ? stats?.awayTeam
            : homeAbbrev === team
                ? stats?.homeTeam
                : null;

    if (!side) return [];

    return Array.isArray(side?.goalies) ? side.goalies : [];
}

function addGoalieAgg(agg: Map<number, GoalieAgg>, row: any): void {
    const playerId = toNum(row?.playerId);
    if (!playerId) return;

    const minutes = toiToMinutes(row?.toi);
    if (minutes <= 0) return;

    const current =
        agg.get(playerId) ??
        {
            playerId,
            name: cleanStr(row?.name?.default) ?? "Unknown Goalie",
            gp: 0,
            wins: 0,
            shotsAgainst: 0,
            saves: 0,
            goalsAgainst: 0,
            minutes: 0,
            shutouts: 0,
        };

    const shotsAgainst = toNum(row?.shotsAgainst) ?? 0;
    const saves = toNum(row?.saves) ?? 0;
    const goalsAgainst = toNum(row?.goalsAgainst) ?? 0;

    current.gp += 1;
    current.wins += String(row?.decision ?? "").toUpperCase() === "W" ? 1 : 0;
    current.shotsAgainst += shotsAgainst;
    current.saves += saves;
    current.goalsAgainst += goalsAgainst;
    current.minutes += minutes;

    if (goalsAgainst === 0 && shotsAgainst > 0) {
        current.shutouts += 1;
    }

    agg.set(playerId, current);
}

function toCompareValue(row: GoalieAgg): GoalieCompareValue {
    return {
        playerId: row.playerId,
        name: row.name,
        gp: row.gp,
        wins: row.wins,
        savePct:
            row.shotsAgainst > 0
                ? Number((row.saves / row.shotsAgainst).toFixed(3))
                : null,
        gaa:
            row.minutes > 0
                ? Number(((row.goalsAgainst * 60) / row.minutes).toFixed(2))
                : null,
        shutouts: row.shutouts,
    };
}

function buildPayload(
    team: string,
    filterBy: CompareFilter,
    gamesUsed: number,
    values: GoalieCompareValue[]
): GoalieComparePayload {
    return {
        team,
        filterBy,
        gamesUsed,
        starter: values[0] ?? null,
        additional: values[1] ?? null,
    };
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const team = (url.searchParams.get("team") ?? "").trim().toUpperCase();
    const filterRaw = (url.searchParams.get("filterBy") ?? "season").trim().toLowerCase();
    const asOfParam = url.searchParams.get("as_of");
    const asOf = isISODate(asOfParam) ? asOfParam : todayISO_UTC();

    if (!team) {
        return NextResponse.json({ error: "Missing ?team=TOR" }, { status: 400 });
    }

    if (!isCompareFilter(filterRaw)) {
        return NextResponse.json({ error: "Invalid filterBy" }, { status: 400 });
    }

    const filterBy = filterRaw as CompareFilter;

    try {
        if (filterBy === "season") {
            const clubStats = await fetchClubStats(team, { revalidate: 300 });

            const values: GoalieCompareValue[] = (clubStats?.goalies ?? [])
                .map((row: any) => ({
                    playerId: toNum(row?.playerId) ?? 0,
                    name: buildPlayerName(row?.firstName, row?.lastName),
                    gp: toNum(row?.gamesPlayed) ?? 0,
                    wins: toNum(row?.wins) ?? 0,
                    savePct: toNum(row?.savePercentage),
                    gaa: toNum(row?.goalsAgainstAverage),
                    shutouts: toNum(row?.shutouts) ?? 0,
                }))
                .filter((row: GoalieCompareValue) => row.playerId > 0 && row.name)
                .sort((a: GoalieCompareValue, b: GoalieCompareValue) => {
                    if (b.gp !== a.gp) return b.gp - a.gp;
                    return b.wins - a.wins;
                });

            return NextResponse.json(buildPayload(team, filterBy, 0, values));
        }

        const window = parseCompareWindow(filterBy);
        if (window == null) {
            return NextResponse.json({ error: "Invalid last-X filter" }, { status: 400 });
        }

        const gameIds = await fetchRecentRegularSeasonGameIds(team, window, asOf, isISODate(asOfParam));
        const boxes = await fetchSequentialBoxscores(gameIds);
        const agg = new Map<number, GoalieAgg>();

        for (const box of boxes) {
            for (const row of getTeamGoalieRowsFromBox(box, team)) {
                addGoalieAgg(agg, row);
            }
        }

        const values = [...agg.values()]
            .map((row) => toCompareValue(row))
            .sort((a, b) => {
                if (b.gp !== a.gp) return b.gp - a.gp;
                return b.wins - a.wins;
            });

        return NextResponse.json(
            buildPayload(team, filterBy, gameIds.length, values)
        );
    } catch (error) {
        console.error("/api/compare/goalies failed", error);
        return NextResponse.json(
            { error: "Failed to build goalie compare data" },
            { status: error instanceof CurrentSeasonError ? 503 : 500 }
        );
    }
}