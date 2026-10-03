import { NextRequest, NextResponse } from "next/server";
import bundled from "@/data/nfl-summary.json";
import { normalizeTeam, summarize, rankLeague, type Snapshot } from "@/lib/nfl/summary";

export const runtime = "nodejs";
const SOURCE = "https://raw.githubusercontent.com/Milad-Safi/game-data/main/src/data/nfl-summary.json";
function valid(value: unknown): value is Snapshot {
    if (!value || typeof value !== "object") return false;
    const s = value as Snapshot;
    return s.version === 1 && Number.isInteger(s.season) && Number.isFinite(Date.parse(s.updatedAt)) &&
        Array.isArray(s.teams) && s.teams.length === 32 && s.teams.every(t => typeof t === "string") &&
        Array.isArray(s.warnings) && s.warnings.every(w => typeof w === "string") && Array.isArray(s.games) &&
        s.games.every(g => g && typeof g.id === "string" && typeof g.date === "string" && s.teams.includes(g.team) && s.teams.includes(g.opponent) &&
            [g.own, g.against].every(t => t && Object.keys(bundled.games[0]?.own ?? {}).every(k => typeof t[k] === "number" && Number.isFinite(t[k]))));
}
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const left = normalizeTeam(params.get("team1") ?? "");
    const right = normalizeTeam(params.get("team2") ?? "");
    const range = params.get("range") ?? "season";
    const ranges: Record<string, number | null> = { season: null, last1: 1, last2: 2, last3: 3, last4: 4, last5: 5, last10: 10 };
    if (!Object.hasOwn(ranges, range) || !left || !right || left === right || !bundled.teams.includes(left) || !bundled.teams.includes(right)) {
        return NextResponse.json({ error: "Choose two different NFL teams and a valid game range." }, { status: 400 });
    }
    let snapshot = bundled as Snapshot;
    let fallback = false;
    // A scheduled GitHub job publishes this small file. No Render call, PBP
    // parsing or database access occurs on a comparison request.
    if (process.env.NODE_ENV === "production") {
        try {
            const res = await fetch(SOURCE, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(3000) });
            if (!res.ok) throw new Error("Snapshot unavailable");
            const remote: unknown = await res.json();
            if (!valid(remote)) throw new Error("Invalid snapshot");
            if (Date.parse(remote.updatedAt) > Date.parse(snapshot.updatedAt) && remote.season >= snapshot.season) snapshot = remote;
        } catch { fallback = true; }
    }
    const league = rankLeague(snapshot.teams.map(team => summarize(snapshot, team, ranges[range])));
    const stale = Date.now() - Date.parse(snapshot.updatedAt) > 10 * 86400000;
    return NextResponse.json({ season: snapshot.season, updatedAt: snapshot.updatedAt, latestGameDate: snapshot.latestGameDate,
        stale, warnings: [...snapshot.warnings, ...(fallback ? ["Latest snapshot could not be checked; showing the saved update."] : []),
            ...(stale ? ["This update is more than 10 days old. Check the date before using these stats."] : [])],
        left: league[left], right: league[right],
    });
}
