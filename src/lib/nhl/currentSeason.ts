import "server-only";

const CACHE_MS = 60 * 60 * 1000;
let cached: { seasonId: number; expiresAt: number } | undefined;
let pending: Promise<number> | undefined;

export class CurrentSeasonError extends Error {
    constructor() {
        super("Current NHL season is unavailable. Please try again later.");
        this.name = "CurrentSeasonError";
    }
}

/** NHL standings are the only authority; cache successful results only. */
export async function getCurrentSeasonId(): Promise<number> {
    if (cached && cached.expiresAt > Date.now()) return cached.seasonId;
    if (pending) return pending;

    pending = (async () => {
        try {
            const response = await fetch("https://api-web.nhle.com/v1/standings/now", {
                cache: "no-store",
                signal: AbortSignal.timeout(10000),
                headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
            });
            if (!response.ok) throw new CurrentSeasonError();
            const payload = await response.json();
            const rows = payload?.standings;
            if (!Array.isArray(rows) || !rows.length) throw new CurrentSeasonError();
            const seasonId = rows[0]?.seasonId;
            if (typeof seasonId !== "number" || !Number.isInteger(seasonId) ||
                !/^\d{8}$/.test(String(seasonId)) ||
                seasonId % 10000 !== Math.floor(seasonId / 10000) + 1 ||
                rows.some((row) => row?.seasonId !== seasonId)) {
                throw new CurrentSeasonError();
            }
            cached = { seasonId, expiresAt: Date.now() + CACHE_MS };
            return seasonId;
        } catch {
            throw new CurrentSeasonError();
        }
    })();
    try {
        return await pending;
    } finally {
        pending = undefined;
    }
}
