import { getCurrentSeasonId } from "@/lib/nhl/currentSeason";
import { NextResponse } from "next/server";

type RanksForMetric = Record<string, number | null>;

export type TeamRanks = {
  seasonId: number;
  teamsCount: number;
  teamA: string;
  teamB: string;
  ranks: {
    goalsForPerGame: RanksForMetric;
    goalsAgainstPerGame: RanksForMetric;
    powerPlayPct: RanksForMetric;
    penaltyKillPct: RanksForMetric;
    shotsForPerGame: RanksForMetric;
    shotsAgainstPerGame: RanksForMetric;
  };
};

// Best-effort number parsing for stats REST fields
function toNumber(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}



// Fetch team metadata so numeric teamId values can be mapped to triCode
async function getTeamMeta() {
  const res = await fetch("https://api.nhle.com/stats/rest/en/team", {
    next: { revalidate: 60 * 60 },
    headers: { "User-Agent": "game-data" },
  });
  if (!res.ok) return [];

  const json = await res.json();
  const rows: any[] = Array.isArray(json?.data) ? json.data : [];

  // normalize to: { id, triCode }
  return rows
    .map((t) => {
      const id = toNumber(t?.id ?? t?.teamId);
      const triCode = String(t?.triCode || t?.abbrev || t?.abbreviation || "").toUpperCase();
      return id != null && triCode ? { id, triCode } : null;
    })
    .filter(Boolean) as { id: number; triCode: string }[];
}

type TeamSummaryRow = {
  teamId: number;
  goalsForPerGame: number | null;
  goalsAgainstPerGame: number | null;
  powerPlayPct: number | null;   // 0-1 decimal in this feed
  penaltyKillPct: number | null; // 0-1 decimal in this feed
  shotsForPerGame: number | null;
  shotsAgainstPerGame: number | null;
};

// Pull league-wide team summary rows for a season and game type
async function getLeagueTeamSummary(seasonId: number, gameTypeId: number): Promise<TeamSummaryRow[]> {
  const url =
    "https://api.nhle.com/stats/rest/en/team/summary" +
    `?cayenneExp=${encodeURIComponent(`seasonId=${seasonId} and gameTypeId=${gameTypeId}`)}`;

  const res = await fetch(url, {
    next: { revalidate: 60 * 60 },
    headers: { "User-Agent": "game-data" },
  });

  if (!res.ok) return [];
  const json = await res.json();
  const rows: any[] = Array.isArray(json?.data) ? json.data : [];

  return rows
    .map((r) => ({
      teamId: toNumber(r?.teamId) ?? -1,
      goalsForPerGame: toNumber(r?.goalsForPerGame),
      goalsAgainstPerGame: toNumber(r?.goalsAgainstPerGame),
      powerPlayPct: toNumber(r?.powerPlayPct),
      penaltyKillPct: toNumber(r?.penaltyKillPct),
      shotsForPerGame: toNumber(r?.shotsForPerGame),
      shotsAgainstPerGame: toNumber(r?.shotsAgainstPerGame),
    }))
    .filter((r) => r.teamId !== -1);
}

// Convert stats REST percentages from 0..1 into 0..100 for consistent ranking display
function pct01ToPct100(v: number | null) {
  if (v == null) return null;
  // This feed is 0-1 (ex: 0.224489) => 22.4489
  return v <= 1 ? v * 100 : v;
}

// Produce a simple 1..N rank map for every triCode in the input set
function computeRanks(
  rows: { triCode: string; value: number | null }[],
  higherBetter: boolean
): Record<string, number | null> {
  const valid = rows.filter((r) => r.value != null) as { triCode: string; value: number }[];

  valid.sort((a, b) => {
    if (higherBetter) return b.value - a.value;
    return a.value - b.value;
  });

  const out: Record<string, number | null> = {};
  rows.forEach((r) => (out[r.triCode] = null));

  // simple 1..N rank (no tie compression)
  valid.forEach((r, i) => {
    out[r.triCode] = i + 1;
  });

  return out;
}

// GET /api/team/ranks?teamA=TOR&teamB=MTL&gameTypeId=2
// Returns league rank maps so the UI can display where each team sits for each stat
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // Default teams allow the route to be hit directly during dev
  const teamA = String(searchParams.get("teamA") || "TOR").toUpperCase();
  const teamB = String(searchParams.get("teamB") || "MTL").toUpperCase();
  let seasonId: number;
  try {
    seasonId = toNumber(searchParams.get("seasonId")) ?? await getCurrentSeasonId();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Current NHL season unavailable" }, { status: 503 });
  }
  const gameTypeId = toNumber(searchParams.get("gameTypeId")) ?? 2;

  // Fetch meta and league summary data needed to build triCode keyed rows
  const meta = await getTeamMeta();
  const league = await getLeagueTeamSummary(seasonId, gameTypeId);

  // Map numeric teamId values to triCode abbreviations
  const idToTri = new Map(meta.map((m) => [m.id, m.triCode]));
  const leagueByTri = league
    .map((r) => {
      const tri = idToTri.get(r.teamId);
      return tri ? { triCode: tri, row: r } : null;
    })
    .filter(Boolean) as { triCode: string; row: TeamSummaryRow }[];

  const teamsCount = leagueByTri.length;

  // Compute per-metric ranks for every team in the league set
  const payload: TeamRanks = {
    seasonId,
    teamsCount,
    teamA,
    teamB,
    ranks: {
      goalsForPerGame: computeRanks(
        leagueByTri.map((x) => ({ triCode: x.triCode, value: x.row.goalsForPerGame })),
        true
      ),
      goalsAgainstPerGame: computeRanks(
        leagueByTri.map((x) => ({ triCode: x.triCode, value: x.row.goalsAgainstPerGame })),
        false
      ),
      powerPlayPct: computeRanks(
        leagueByTri.map((x) => ({ triCode: x.triCode, value: pct01ToPct100(x.row.powerPlayPct) })),
        true
      ),
      penaltyKillPct: computeRanks(
        leagueByTri.map((x) => ({ triCode: x.triCode, value: pct01ToPct100(x.row.penaltyKillPct) })),
        true
      ),
      shotsForPerGame: computeRanks(
        leagueByTri.map((x) => ({ triCode: x.triCode, value: x.row.shotsForPerGame })),
        true
      ),
      shotsAgainstPerGame: computeRanks(
        leagueByTri.map((x) => ({ triCode: x.triCode, value: x.row.shotsAgainstPerGame })),
        false
      ),
    },
  };

  return NextResponse.json(payload);
}
