import { CurrentSeasonError, getCurrentSeasonId } from "@/lib/nhl/currentSeason";
import { NextResponse } from "next/server";

import { query } from "@/lib/db";
import { NHL_TEAM_OPTIONS } from "@/lib/compare";
import { getTeamLogoSrc } from "@/lib/teamAssets";
import {
    HISTORICAL_GAMES_PAGE_SIZE,
    isHistoricalSeasonOption,
    getHistoricalSeasonOptions,
} from "@/lib/games";
import type {
    HistoricalDecision,
    HistoricalGameCard,
    HistoricalGamesSearchResponse,
} from "@/types/games";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_PAGE_SIZE = 24;

function clampPageSize(value: number) {
    if (!Number.isFinite(value) || value <= 0) {
        return HISTORICAL_GAMES_PAGE_SIZE;
    }

    return Math.min(Math.max(Math.trunc(value), 1), MAX_PAGE_SIZE);
}

function clampPage(value: number) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    return Math.max(1, Math.trunc(value));
}

function seasonStartYear(season: string) {
    return Number(season.slice(0, 4));
}

function getTeamOption(teamAbbrev: string) {
    return NHL_TEAM_OPTIONS.find((team) => team.value === teamAbbrev) ?? null;
}

function normaliseGameDate(value: unknown) {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return "";
        return value.toISOString().slice(0, 10);
    }

    if (typeof value === "string") {
        const trimmed = value.trim();

        if (!trimmed) return "";

        const directMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (directMatch) {
            return `${directMatch[1]}-${directMatch[2]}-${directMatch[3]}`;
        }

        const parsed = new Date(trimmed);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString().slice(0, 10);
        }
    }

    return "";
}

type TeamGameRow = {
    game_id: string | number;
    game_date: string | Date | null;
    opponent: string;
    is_home: boolean | null;
    goals_for: number | null;
    goals_against: number | null;
};

type BoxscoreDecision = {
    gameOutcome?: {
        lastPeriodType?: string;
    };
    periodDescriptor?: {
        periodType?: string;
    };
};

async function fetchDecisionForGame(gameId: number): Promise<HistoricalDecision> {
    if (!Number.isFinite(gameId)) return "reg";

    try {
        const response = await fetch(
            `https://api-web.nhle.com/v1/gamecenter/${gameId}/boxscore`,
            {
                next: { revalidate: 86400 },
                headers: { "User-Agent": "game-data" },
            }
        );

        if (!response.ok) return "reg";

        const box = (await response.json()) as BoxscoreDecision;
        const lastPeriodType = String(
            box?.gameOutcome?.lastPeriodType ?? ""
        ).toUpperCase();
        const periodType = String(
            box?.periodDescriptor?.periodType ?? ""
        ).toUpperCase();

        if (lastPeriodType === "SO" || periodType === "SO") return "so";
        if (lastPeriodType === "OT" || periodType === "OT") return "ot";
        return "reg";
    } catch {
        return "reg";
    }
}

// GET /api/games/search?team=TOR&season=2025-2026&opponent=ANA&page=1&pageSize=12
export async function GET(request: Request) {
    const url = new URL(request.url);
    const team = (url.searchParams.get("team") ?? "").trim().toUpperCase();
    const season = url.searchParams.get("season");
    const opponent = (url.searchParams.get("opponent") ?? "").trim().toUpperCase();
    const page = clampPage(Number(url.searchParams.get("page") ?? "1"));
    const pageSize = clampPageSize(
        Number(url.searchParams.get("pageSize") ?? `${HISTORICAL_GAMES_PAGE_SIZE}`)
    );

    if (!team) {
        return NextResponse.json(
            { error: "Missing required team filter" },
            { status: 400 }
        );
    }

    let current: number;
    try {
        current = Math.floor(await getCurrentSeasonId() / 10000);
    } catch (error) {
        return NextResponse.json({ error: error instanceof CurrentSeasonError ? error.message : "Current NHL season unavailable" }, { status: 503 });
    }

    if (!isHistoricalSeasonOption(season, current)) {
        return NextResponse.json(
            { error: `Season must be one of: ${getHistoricalSeasonOptions(current).join(", ")}` },
            { status: 400 }
        );
    }

    const teamOption = getTeamOption(team);
    if (!teamOption) {
        return NextResponse.json({ error: "Invalid team" }, { status: 400 });
    }

    const opponentOption = opponent ? getTeamOption(opponent) : null;
    if (opponent && !opponentOption) {
        return NextResponse.json({ error: "Invalid opponent" }, { status: 400 });
    }

    try {
        const startYear = seasonStartYear(season);
        const where: string[] = [
            "tg.team = $1",
            "LEFT(tg.game_id::text, 4)::int = $2",
            "SUBSTRING(tg.game_id::text, 5, 2) = '02'",
            "tg.goals_for IS NOT NULL",
            "tg.goals_against IS NOT NULL",
        ];
        const params: Array<string | number> = [team, startYear];

        if (opponent) {
            params.push(opponent);
            where.push(`tg.opponent = $${params.length}`);
        }

        const whereSql = where.join("\n                AND ");

        const countResult = await query<{ total_games: string | number }>(
            `
                SELECT COUNT(*) AS total_games
                FROM team_games tg
                WHERE ${whereSql}
            `,
            params
        );

        const totalGames = Number(countResult.rows?.[0]?.total_games ?? 0);
        const totalPages = Math.max(1, Math.ceil(totalGames / pageSize));
        const safePage = Math.min(page, totalPages);
        const offset = (safePage - 1) * pageSize;

        const listParams = [...params, pageSize, offset];
        const rowsResult = await query<TeamGameRow>(
            `
                SELECT
                    tg.game_id,
                    tg.game_date,
                    tg.opponent,
                    tg.is_home,
                    tg.goals_for,
                    tg.goals_against
                FROM team_games tg
                WHERE ${whereSql}
                ORDER BY tg.game_date DESC, tg.game_id DESC
                LIMIT $${listParams.length - 1}
                OFFSET $${listParams.length}
            `,
            listParams
        );

        const rows = rowsResult.rows ?? [];

        const decisions = await Promise.all(
            rows.map(async (row) => {
                const gameId = Number(row.game_id);
                const decision = await fetchDecisionForGame(gameId);
                return [String(row.game_id), decision] as const;
            })
        );

        const decisionByGameId = new Map<string, HistoricalDecision>(decisions);

        const games: HistoricalGameCard[] = rows.map((row) => {
            const opponentAbbrev = String(row.opponent ?? "").trim().toUpperCase();
            const opponentTeam = getTeamOption(opponentAbbrev);
            const isHome = row.is_home === true;
            const teamScore = Number(row.goals_for ?? 0);
            const opponentScore = Number(row.goals_against ?? 0);

            return {
                gameId: String(row.game_id),
                gameDate: normaliseGameDate(row.game_date),
                searchedTeam: {
                    abbrev: teamOption.value,
                    label: teamOption.label,
                    logoSrc: getTeamLogoSrc(teamOption.label, teamOption.value),
                    score: teamScore,
                },
                opponent: {
                    abbrev: opponentAbbrev,
                    label: opponentTeam?.label ?? opponentAbbrev,
                    logoSrc: getTeamLogoSrc(
                        opponentTeam?.label ?? opponentAbbrev,
                        opponentAbbrev
                    ),
                    score: opponentScore,
                },
                venue: isHome ? "home" : "away",
                decision: decisionByGameId.get(String(row.game_id)) ?? "reg",
                searchedTeamWon: teamScore > opponentScore,
            };
        });

        const payload: HistoricalGamesSearchResponse = {
            filters: {
                team,
                season,
                opponent: opponent || null,
            },
            pagination: {
                page: safePage,
                pageSize,
                totalGames,
                totalPages,
            },
            games,
        };

        return NextResponse.json(payload, {
            headers: { "Cache-Control": "no-store" },
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                error: "Could not load historical games",
                detail: String(error?.message ?? error),
            },
            { status: 500 }
        );
    }
}