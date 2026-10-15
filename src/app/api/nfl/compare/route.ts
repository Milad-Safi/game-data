import { NextRequest, NextResponse } from "next/server";
import bundled from "@/data/nfl-summary.json";
import { normalizeTeam, summarize, rankLeague, SECTIONS, type Snapshot } from "@/lib/nfl/summary";

export const runtime = "nodejs";
const SOURCE = "https://raw.githubusercontent.com/Milad-Safi/game-data/main/src/data/nfl-summary.json";
// Explicit metric schema works even when the bundled season has zero games.
const TOTAL_KEYS = [...new Set(SECTIONS.flatMap(s => s.rows).filter(r => !r.percent)
    .map(r => r.key === "takeaways" ? "turnovers" : r.key.replace(/Allowed$/, ""))) ,
    "thirdMade", "thirdAttempts", "fourthMade", "fourthAttempts", "redZoneMade", "redZoneAttempts"];
function valid(value: unknown): value is Snapshot {
    if (!value || typeof value !== "object") return false;
    const s = value as Snapshot;
    if (!(s.version === 1 && Number.isInteger(s.season) && Number.isFinite(Date.parse(s.updatedAt)) &&
        Array.isArray(s.teams) && s.teams.length === 32 && new Set(s.teams).size === 32 &&
        s.teams.every(t => bundled.teams.includes(t)) &&
        Array.isArray(s.warnings) && s.warnings.every(w => typeof w === "string") && Array.isArray(s.games))) return false;
    const seen = new Map<string, Snapshot["games"][number]>();
    for (const g of s.games) {
        if (!g || typeof g.id !== "string" || !g.id.startsWith(`${s.season}_`) ||
            !Number.isFinite(Date.parse(g.date)) || !Number.isInteger(g.week) || g.week < 1 ||
            !s.teams.includes(g.team) || !s.teams.includes(g.opponent) || g.team === g.opponent ||
            ![g.own, g.against].every(t => t && TOTAL_KEYS.every(k => typeof t[k] === "number" && Number.isFinite(t[k]))) ||
            seen.has(`${g.id}:${g.team}`)) return false;
        seen.set(`${g.id}:${g.team}`, g);
    }
    return s.games.every(g => {
        const other = seen.get(`${g.id}:${g.opponent}`);
        return other && other.opponent === g.team && other.date === g.date && other.week === g.week &&
            TOTAL_KEYS.every(k => g.own[k] === other.against[k] && g.against[k] === other.own[k]);
    });
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
    let snapshot: Snapshot | null = valid(bundled) ? bundled : null;
    let fallback = false;
    // Use the published snapshot in development too; never silently pin localhost
    // to the file from its last checkout. This remains a small JSON-only request.
    try {
        const res = await fetch(SOURCE, { next: { revalidate: 300 }, signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error("Snapshot unavailable");
        const remote: unknown = await res.json();
        if (!valid(remote)) throw new Error("Invalid snapshot");
        if (!snapshot || (remote.season >= snapshot.season && Date.parse(remote.updatedAt) >= Date.parse(snapshot.updatedAt))) snapshot = remote;
    } catch { fallback = true; }
    const now = new Date();
    const currentSeason = now.getUTCFullYear() - (now.getUTCMonth() < 7 ? 1 : 0);
    if (!snapshot || snapshot.season !== currentSeason) {
        return NextResponse.json({ error: "Current-season NFL stats are awaiting a verified update." }, { status: 503 });
    }
    const league = rankLeague(snapshot.teams.map(team => summarize(snapshot, team, ranges[range])));
    const stale = Date.now() - Date.parse(snapshot.updatedAt) > 3 * 86400000;
    return NextResponse.json({ season: snapshot.season, updatedAt: snapshot.updatedAt, latestGameDate: snapshot.latestGameDate,
        stale, warnings: [...snapshot.warnings, ...(fallback ? ["Latest snapshot could not be checked; showing the saved update."] : []),
            ...(stale ? ["The verified NFL snapshot is over three days old; newer games may be missing."] : [])],
        left: league[left], right: league[right],
    });
}
