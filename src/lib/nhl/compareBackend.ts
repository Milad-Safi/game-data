import { getSeasonStartYear } from "@/lib/nhl/season";
import { getCurrentSeasonId } from "@/lib/nhl/currentSeason";
import { NextResponse } from "next/server";

import { query } from "@/lib/db";
import { cleanStr } from "@/lib/nhl/parse";

export const COMPARE_REGULAR_SEASON_GAME_TYPE = 2;
export const DEFAULT_BOX_RETRY_COUNT = 5;
export const DEFAULT_RETRY_BASE_MS = 900;

export type CompareFilter =
    | "season"
    | "last1"
    | "last2"
    | "last3"
    | "last4"
    | "last5"
    | "last10";

export function jsonNoStore(body: unknown, init?: ResponseInit) {
    const headers = new Headers(init?.headers);
    headers.set("Cache-Control", "no-store");

    return NextResponse.json(body, {
        ...init,
        headers,
    });
}

export function isCompareFilter(value: string): value is CompareFilter {
    return [
        "season",
        "last1",
        "last2",
        "last3",
        "last4",
        "last5",
        "last10",
    ].includes(value);
}

export function parseCompareWindow(filterBy: CompareFilter): number | null {
    if (filterBy === "last1") return 1;
    if (filterBy === "last2") return 2;
    if (filterBy === "last3") return 3;
    if (filterBy === "last4") return 4;
    if (filterBy === "last5") return 5;
    if (filterBy === "last10") return 10;
    return null;
}

export function buildPlayerName(firstName: any, lastName: any): string {
    const first = cleanStr(firstName?.default) ?? "";
    const last = cleanStr(lastName?.default) ?? "";
    return `${first} ${last}`.trim();
}

export function isISODate(value: string | null): value is string {
    return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function todayISO_UTC(): string {
    return new Date().toISOString().slice(0, 10);
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number) {
    return status === 429 || status >= 500;
}

function getRetryDelayMs(
    response: Response,
    attempt: number,
    retryBaseMs: number
) {
    const retryAfter = response.headers.get("retry-after");
    const retryAfterSeconds = Number(retryAfter);

    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return retryAfterSeconds * 1000;
    }

    return retryBaseMs * attempt;
}

export async function fetchJsonWithRetry<T>(
    url: string,
    options?: {
        revalidate?: number;
        retryCount?: number;
        retryBaseMs?: number;
        init?: RequestInit;
    }
): Promise<T> {
    const retryCount = options?.retryCount ?? DEFAULT_BOX_RETRY_COUNT;
    const retryBaseMs = options?.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;

    for (let attempt = 1; attempt <= retryCount; attempt += 1) {
        const response = await fetch(url, {
            ...(options?.init ?? {}),
            ...(options?.revalidate != null
                ? { next: { revalidate: options.revalidate } }
                : {}),
        } as RequestInit);

        if (response.ok) {
            return (await response.json()) as T;
        }

        if (!isRetryableStatus(response.status) || attempt === retryCount) {
            throw new Error(`Fetch ${response.status} ${response.statusText}: ${url}`);
        }

        await sleep(getRetryDelayMs(response, attempt, retryBaseMs));
    }

    throw new Error(`Failed to fetch ${url}`);
}

export async function fetchBoxscoreWithRetry<T = any>(gameId: number): Promise<T> {
    return fetchJsonWithRetry<T>(
        `https://api-web.nhle.com/v1/gamecenter/${gameId}/boxscore`,
        {
            revalidate: 300,
            retryCount: DEFAULT_BOX_RETRY_COUNT,
            retryBaseMs: DEFAULT_RETRY_BASE_MS,
        }
    );
}

export async function fetchSequentialBoxscores<T = any>(
    gameIds: number[]
): Promise<T[]> {
    const uniqueGameIds = Array.from(
        new Set(gameIds.filter((gameId) => Number.isFinite(gameId) && gameId > 0))
    );

    const boxes: T[] = [];

    for (const gameId of uniqueGameIds) {
        const box = await fetchBoxscoreWithRetry<T>(gameId);
        boxes.push(box);
    }

    return boxes;
}

export async function fetchClubStats(
    team: string,
    options?: {
        cache?: RequestCache;
        revalidate?: number;
    }
): Promise<any | null> {
    const response = await fetch(
        `https://api-web.nhle.com/v1/club-stats/${team}/${await getCurrentSeasonId()}/${COMPARE_REGULAR_SEASON_GAME_TYPE}`,
        {
            ...(options?.cache ? { cache: options.cache } : {}),
            ...(options?.revalidate != null
                ? { next: { revalidate: options.revalidate } }
                : {}),
        } as RequestInit
    );

    if (!response.ok) return null;
    return response.json();
}

export async function fetchRecentRegularSeasonGameIds(
    team: string,
    window: number,
    asOf: string,
    explicitAsOf = true
): Promise<number[]> {
    const seasonYear = explicitAsOf
        ? getSeasonStartYear(new Date(`${asOf}T12:00:00Z`))
        : Math.floor(await getCurrentSeasonId() / 10000);
    const result = await query<{ game_id: string | number }>(
        `
      SELECT tg.game_id
      FROM team_games tg
      WHERE tg.team = $1
        AND LEFT(tg.game_id::text, 4)::int = $2
        AND tg.game_date <= $3
        AND SUBSTRING(tg.game_id::text, 5, 2) = '02'
      ORDER BY tg.game_date DESC, tg.game_id DESC
      LIMIT $4
    `,
        [team, seasonYear, asOf, window]
    );

    return result.rows
        .map((row) => Number(row.game_id))
        .filter((gameId) => Number.isFinite(gameId) && gameId > 0);
}