import { CurrentSeasonError } from "@/lib/nhl/currentSeason";
import { cleanStr, toNum } from "@/lib/nhl/parse";
import {
    type CompareFilter,
    buildPlayerName,
    fetchClubStats,
    fetchBoxscoreWithRetry,
    fetchRecentRegularSeasonGameIds,
    fetchSequentialBoxscores,
    isCompareFilter,
    isISODate,
    jsonNoStore,
    parseCompareWindow,
    todayISO_UTC,
} from "@/lib/nhl/compareBackend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PositionGroup = "all" | "forwards" | "defenders";

type LeaderValue = {
    playerId: number;
    name: string;
    value: number;
};

type RosterPlayer = {
    playerId: number;
    name: string;
    position: string;
};

type SkaterAgg = {
    playerId: number;
    name: string;
    position: string;
    goals: number;
    assists: number;
    points: number;
    sog: number;
    blocks: number;
    hits: number;
};

type SkaterComparePayload = {
    team: string;
    filterBy: CompareFilter;
    positionGroup: PositionGroup;
    gamesUsed: number;
    leaders: {
        goals: LeaderValue | null;
        assists: LeaderValue | null;
        points: LeaderValue | null;
        sog: LeaderValue | null;
        blocks: LeaderValue | null;
        hits: LeaderValue | null;
    };
};

function shotsAllowed(boxes: any[], team: string) {
    let forwards = 0, defenders = 0;
    for (const box of boxes) {
        const home = box?.homeTeam?.abbrev === team;
        if ((!home && box?.awayTeam?.abbrev !== team) || !["OFF", "FINAL"].includes(box?.gameState))
            throw new Error("Positional SOG requires completed matching games");
        const side = box?.playerByGameStats?.[home ? "awayTeam" : "homeTeam"];
        for (const [group, rows] of [["F", side?.forwards], ["D", side?.defense]] as const) {
            if (!Array.isArray(rows)) throw new Error("Missing opponent positional shots");
            for (const row of rows) {
                const shots = toNum(row.sog ?? row.shots);
                if (shots == null || shots < 0) throw new Error("Missing opponent shots");
                if (group === "F") forwards += shots; else defenders += shots;
            }
        }
    }
    return { games: boxes.length, forwards: boxes.length ? forwards / boxes.length : null,
        defenders: boxes.length ? defenders / boxes.length : null };
}

// Bound concurrency for a full season; reuse the existing cached boxscore loader.
async function positionalBoxes(ids: number[]) {
    const unique = [...new Set(ids)];
    const boxes: any[] = [];
    for (let i = 0; i < unique.length; i += 4)
        boxes.push(...await Promise.all(unique.slice(i, i + 4).map(id => fetchBoxscoreWithRetry(id))));
    return boxes;
}

function normalizePositionGroup(value: string | null): PositionGroup {
    if (value === "forwards") return "forwards";
    if (value === "defenders") return "defenders";
    return "all";
}

function isForwardPosition(position: string): boolean {
    return position === "C" || position === "L" || position === "R";
}

function matchesPositionGroup(position: string, group: PositionGroup): boolean {
    if (group === "all") return true;
    if (group === "forwards") return isForwardPosition(position);
    return position === "D";
}

async function fetchCurrentRoster(team: string): Promise<Map<number, RosterPlayer>> {
    const response = await fetch(`https://api-web.nhle.com/v1/roster/${team}/current`, {
        next: { revalidate: 3600 },
    });

    if (!response.ok) {
        return new Map<number, RosterPlayer>();
    }

    const data = await response.json();
    const roster = new Map<number, RosterPlayer>();

    for (const player of data?.forwards ?? []) {
        const playerId = toNum(player?.id);
        if (!playerId) continue;

        roster.set(playerId, {
            playerId,
            name: buildPlayerName(player?.firstName, player?.lastName),
            position: cleanStr(player?.positionCode)?.toUpperCase() ?? "",
        });
    }

    for (const player of data?.defensemen ?? []) {
        const playerId = toNum(player?.id);
        if (!playerId) continue;

        roster.set(playerId, {
            playerId,
            name: buildPlayerName(player?.firstName, player?.lastName),
            position: cleanStr(player?.positionCode)?.toUpperCase() ?? "",
        });
    }

    return roster;
}

function getTeamSkaterRowsFromBox(box: any, team: string): any[] {
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

    return [...(side?.forwards ?? []), ...(side?.defense ?? [])];
}

function addSkaterAgg(
    agg: Map<number, SkaterAgg>,
    row: any,
    roster: Map<number, RosterPlayer>,
    positionGroup: PositionGroup
): void {
    const playerId = toNum(row?.playerId);
    if (!playerId) return;

    const rosterPlayer = roster.get(playerId);
    if (!rosterPlayer) return;
    if (!matchesPositionGroup(rosterPlayer.position, positionGroup)) return;

    const current =
        agg.get(playerId) ??
        {
            playerId,
            name: rosterPlayer.name,
            position: rosterPlayer.position,
            goals: 0,
            assists: 0,
            points: 0,
            sog: 0,
            blocks: 0,
            hits: 0,
        };

    current.goals += toNum(row?.goals) ?? 0;
    current.assists += toNum(row?.assists) ?? 0;
    current.points += toNum(row?.points) ?? 0;
    current.sog += toNum(row?.sog) ?? 0;
    current.blocks += toNum(row?.blockedShots) ?? 0;
    current.hits += toNum(row?.hits) ?? 0;

    agg.set(playerId, current);
}

function leaderFromAgg(
    agg: Map<number, SkaterAgg>,
    getValue: (row: SkaterAgg) => number | null,
    minimumValue = 0
): LeaderValue | null {
    let best: LeaderValue | null = null;

    for (const row of agg.values()) {
        const value = getValue(row);
        if (value == null || !Number.isFinite(value)) continue;
        if (value <= minimumValue) continue;

        if (!best || value > best.value) {
            best = {
                playerId: row.playerId,
                name: row.name,
                value: Number(value.toFixed(3)),
            };
        }
    }

    return best;
}

function buildPayload(
    team: string,
    filterBy: CompareFilter,
    positionGroup: PositionGroup,
    gamesUsed: number,
    agg: Map<number, SkaterAgg>
): SkaterComparePayload {
    return {
        team,
        filterBy,
        positionGroup,
        gamesUsed,
        leaders: {
            goals: leaderFromAgg(agg, (row) => row.goals),
            assists: leaderFromAgg(agg, (row) => row.assists),
            points: leaderFromAgg(agg, (row) => row.points),
            sog: leaderFromAgg(agg, (row) => row.sog),
            blocks: leaderFromAgg(agg, (row) => row.blocks),
            hits: leaderFromAgg(agg, (row) => row.hits),
        },
    };
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const team = (url.searchParams.get("team") ?? "").trim().toUpperCase();
    const filterRaw = (url.searchParams.get("filterBy") ?? "season").trim().toLowerCase();
    const positionGroup = normalizePositionGroup(url.searchParams.get("positionGroup"));
    const asOfParam = url.searchParams.get("as_of");
    const asOf = isISODate(asOfParam) ? asOfParam : todayISO_UTC();

    if (!team) {
        return jsonNoStore({ error: "Missing ?team=TOR" }, { status: 400 });
    }

    if (!isCompareFilter(filterRaw)) {
        return jsonNoStore({ error: "Invalid filterBy" }, { status: 400 });
    }

    const filterBy = filterRaw as CompareFilter;

    try {
        const roster = await fetchCurrentRoster(team);

        if (filterBy === "season") {
            const clubStats = await fetchClubStats(team, { cache: "no-store" });
            const agg = new Map<number, SkaterAgg>();

            for (const row of clubStats?.skaters ?? []) {
                const playerId = toNum(row?.playerId);
                if (!playerId) continue;

                const rosterPlayer = roster.get(playerId);
                if (!rosterPlayer) continue;
                if (!matchesPositionGroup(rosterPlayer.position, positionGroup)) continue;

                agg.set(playerId, {
                    playerId,
                    name: rosterPlayer.name || buildPlayerName(row?.firstName, row?.lastName),
                    position: rosterPlayer.position,
                    goals: toNum(row?.goals) ?? 0,
                    assists: toNum(row?.assists) ?? 0,
                    points: toNum(row?.points) ?? 0,
                    sog: toNum(row?.shots) ?? 0,
                    blocks: 0,
                    hits: 0,
                });
            }

            const ids = await fetchRecentRegularSeasonGameIds(team, null, asOf, isISODate(asOfParam));
            const boxes = await positionalBoxes(ids);
            return jsonNoStore({ ...buildPayload(team, filterBy, positionGroup, 0, agg), shotsAllowed: shotsAllowed(boxes, team) });
        }

        const window = parseCompareWindow(filterBy);
        if (window == null) {
            return jsonNoStore({ error: "Invalid last-X filter" }, { status: 400 });
        }

        const gameIds = await fetchRecentRegularSeasonGameIds(team, window, asOf, isISODate(asOfParam));
        const boxes = await fetchSequentialBoxscores(gameIds);
        const agg = new Map<number, SkaterAgg>();

        for (const box of boxes) {
            for (const row of getTeamSkaterRowsFromBox(box, team)) {
                addSkaterAgg(agg, row, roster, positionGroup);
            }
        }

        return jsonNoStore(
            { ...buildPayload(team, filterBy, positionGroup, gameIds.length, agg), shotsAllowed: shotsAllowed(boxes, team) }
        );
    } catch (error) {
        console.error("/api/compare/skaters failed", error);
        return jsonNoStore(
            { error: "Failed to build skater compare data" },
            { status: error instanceof CurrentSeasonError ? 503 : 500 }
        );
    }
}