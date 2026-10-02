import { CurrentSeasonError, getCurrentSeasonId } from "@/lib/nhl/currentSeason";
import { NextResponse } from "next/server";
import { getTeamLogoSrc } from "@/lib/teamAssets";
import type {
    TeamScatterApiResponse,
    TeamScatterMetricMap,
    TeamScatterTeam,
} from "@/types/api";

const GAME_TYPE_ID = 2;

function toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

type TeamMetaApiRow = {
    id?: number | string;
    teamId?: number | string;
    triCode?: string;
    abbrev?: string;
    abbreviation?: string;
};

type TeamMetaApiResponse = {
    data?: TeamMetaApiRow[];
};
function round2(value: number | null) {
    if (value == null) {
        return null;
    }

    return Math.round(value * 100) / 100;
}

function pct01ToPct100(value: number | null) {
    if (value == null) {
        return null;
    }

    return round2(value <= 1 ? value * 100 : value);
}



type TeamMetaRow = {
    id: number;
    triCode: string;
};

async function getTeamMetaRows() {
    const response = await fetch("https://api.nhle.com/stats/rest/en/team", {
        next: { revalidate: 60 * 60 },
        headers: { "User-Agent": "game-data" },
    });

    if (!response.ok) {
        throw new Error(`team meta fetch failed: ${response.status}`);
    }

    const json = (await response.json()) as TeamMetaApiResponse;
    const rows: TeamMetaApiRow[] = Array.isArray(json.data) ? json.data : [];

    return rows
        .map((row) => {
            const id = toNumber(row.id ?? row.teamId);
            const triCode = String(
                row.triCode || row.abbrev || row.abbreviation || "",
            )
                .trim()
                .toUpperCase();

            if (id == null || !triCode) {
                return null;
            }

            return {
                id,
                triCode,
            } satisfies TeamMetaRow;
        })
        .filter((row): row is TeamMetaRow => row != null);
}

async function getLeagueReportRows(path: string, seasonId: number) {
    const baseEndpoint = `https://api.nhle.com/stats/rest/en/team/${path}`;
    const cayenneExp = encodeURIComponent(
        `seasonId=${seasonId} and gameTypeId=${GAME_TYPE_ID}`,
    );
    const endpoint =
        path === "summary"
            ? `${baseEndpoint}?cayenneExp=${cayenneExp}`
            : `${baseEndpoint}?isAggregate=false&isGame=false&start=0&limit=-1&cayenneExp=${cayenneExp}`;

    const response = await fetch(endpoint, {
        next: { revalidate: 300 },
        headers: { "User-Agent": "game-data" },
    });

    if (!response.ok) {
        throw new Error(`${path} fetch failed: ${response.status}`);
    }

    const json = await response.json();
    return Array.isArray(json?.data) ? json.data : [];
}

function buildMetricMap(
    summary: any,
    powerPlay: any,
    penaltyKill: any,
): TeamScatterMetricMap {
    return {
        ppOpportunities: toNumber(powerPlay?.ppOpportunities),
        overallPowerPlayPct: pct01ToPct100(
            toNumber(powerPlay?.overallPowerPlayPct),
        ),
        opportunities5v4: toNumber(powerPlay?.opportunities5v4),
        powerPlayPct5v4: pct01ToPct100(toNumber(powerPlay?.powerPlayPct5v4)),
        opportunities5v3: toNumber(powerPlay?.opportunities5v3),
        powerPlayPct5v3: pct01ToPct100(toNumber(powerPlay?.powerPlayPct5v3)),
        timesShorthanded: toNumber(penaltyKill?.timesShorthanded),
        penaltyKillPct: pct01ToPct100(toNumber(penaltyKill?.penaltyKillPct)),
        penaltyKillNetPct: pct01ToPct100(
            toNumber(penaltyKill?.penaltyKillNetPct),
        ),
        powerPlayGoalsFor: toNumber(powerPlay?.powerPlayGoalsFor),
        ppGoalsAgainstPerGame: round2(
            toNumber(penaltyKill?.ppGoalsAgainstPerGame),
        ),
        shotsAgainstPerGame: round2(toNumber(summary?.shotsAgainstPerGame)),
        shotsForPerGame: round2(toNumber(summary?.shotsForPerGame)),
        goalsAgainstPerGame: round2(toNumber(summary?.goalsAgainstPerGame)),
        goalsForPerGame: round2(toNumber(summary?.goalsForPerGame)),
        points: toNumber(penaltyKill?.points ?? powerPlay?.points),
        pointsPct: pct01ToPct100(
            toNumber(penaltyKill?.pointsPct ?? powerPlay?.pointPct),
        ),
    };
}

export async function GET(request: Request) {
    const url = new URL(request.url);
    try {
        const seasonId = toNumber(url.searchParams.get("season")) ?? await getCurrentSeasonId();
        const [metaRows, summaryRows, powerPlayRows, penaltyKillRows] =
            await Promise.all([
                getTeamMetaRows(),
                getLeagueReportRows("summary", seasonId),
                getLeagueReportRows("powerplaytime", seasonId),
                getLeagueReportRows("penaltykill", seasonId),
            ]);

        const summaryById = new Map<number, any>();
        const powerPlayById = new Map<number, any>();
        const penaltyKillById = new Map<number, any>();

        for (const row of summaryRows) {
            const teamId = toNumber(row?.teamId);

            if (teamId != null) {
                summaryById.set(teamId, row);
            }
        }

        for (const row of powerPlayRows) {
            const teamId = toNumber(row?.teamId);

            if (teamId != null) {
                powerPlayById.set(teamId, row);
            }
        }

        for (const row of penaltyKillRows) {
            const teamId = toNumber(row?.teamId);

            if (teamId != null) {
                penaltyKillById.set(teamId, row);
            }
        }

        const teams: TeamScatterTeam[] = metaRows
            .map((metaRow) => {
                const summary = summaryById.get(metaRow.id) ?? null;
                const powerPlay = powerPlayById.get(metaRow.id) ?? null;
                const penaltyKill = penaltyKillById.get(metaRow.id) ?? null;

                if (!summary && !powerPlay && !penaltyKill) {
                    return null;
                }

                const teamFullName = String(
                    powerPlay?.teamFullName ||
                        penaltyKill?.teamFullName ||
                        summary?.teamFullName ||
                        metaRow.triCode,
                ).trim();

                return {
                    teamAbbrev: metaRow.triCode,
                    teamFullName,
                    logoSrc: getTeamLogoSrc(teamFullName, metaRow.triCode),
                    gamesPlayed:
                        toNumber(summary?.gamesPlayed) ??
                        toNumber(powerPlay?.gamesPlayed) ??
                        toNumber(penaltyKill?.gamesPlayed),
                    metrics: buildMetricMap(summary, powerPlay, penaltyKill),
                } satisfies TeamScatterTeam;
            })
            .filter(Boolean)
            .sort((teamA, teamB) => {
                return teamA!.teamFullName.localeCompare(teamB!.teamFullName);
            }) as TeamScatterTeam[];

        const payload: TeamScatterApiResponse = {
            seasonId,
            gameTypeId: GAME_TYPE_ID,
            generatedAt: new Date().toISOString(),
            teams,
        };

        return NextResponse.json(payload);
    } catch (error: any) {
        return NextResponse.json(
            {
                error: "Failed to build visualizer team scatter payload",
                detail: String(error?.message ?? error),
            },
            { status: error instanceof CurrentSeasonError ? 503 : 500 },
        );
    }
}