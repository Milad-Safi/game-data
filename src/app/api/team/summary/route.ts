import { CurrentSeasonError, getCurrentSeasonId } from "@/lib/nhl/currentSeason";
import { NextResponse } from "next/server";

type TeamSummary = {
  teamAbbrev: string;
  seasonId: number;
  gameTypeId: number;
  teamId: number | null;
  teamFullName: string | null;
  gamesPlayed: number | null;
  goalsForPerGame: number | null;
  goalsAgainstPerGame: number | null;
  powerPlayPct: number | null;
  penaltyKillPct: number | null;
  shotsForPerGame: number | null;
  shotsAgainstPerGame: number | null;
  wins: number | null;
  losses: number | null;
  otLosses: number | null;
  points: number | null;
  leagueSequence: number | null;
  streakCode: string | null;
  streakCount: number | null;
};

type StandingsRow = {
  seasonId?: number;
  teamAbbrev?: { default?: string } | string;
  teamName?: { default?: string } | string;
  wins?: unknown;
  losses?: unknown;
  otLosses?: unknown;
  points?: unknown;
  leagueSequence?: unknown;
  streakCode?: unknown;
  streakCount?: unknown;
};

function toNumber(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function round2(n: number | null): number | null {
  if (n == null) return null;
  return Math.round(n * 100) / 100;
}

function pctFromDecimal01(n: number | null): number | null {
  if (n == null) return null;
  return round2(n * 100);
}



function standingsAbbrev(row: StandingsRow | null | undefined) {
  return String(
    (typeof row?.teamAbbrev === "string"
      ? row.teamAbbrev
      : row?.teamAbbrev?.default) ?? ""
  )
    .trim()
    .toUpperCase();
}

function standingsTeamName(row: StandingsRow | null | undefined) {
  const raw =
    typeof row?.teamName === "string" ? row.teamName : row?.teamName?.default;

  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

async function getTeamIdsByAbbrev(teamAbbrev: string): Promise<number[]> {
  const res = await fetch("https://api.nhle.com/stats/rest/en/team", {
    next: { revalidate: 60 * 60 },
    headers: { "User-Agent": "game-data" },
  });
  if (!res.ok) return [];

  const json = await res.json();
  const rows: any[] = Array.isArray(json?.data) ? json.data : [];

  // Rebrands can retain a tricode but receive a new ID (UTA: 59 -> 68).
  // Keep every matching identity; the requested season selects the valid row.
  return [...new Set(rows.filter((t) =>
    [t?.triCode, t?.abbrev, t?.abbreviation].some(value =>
      String(value ?? "").toUpperCase() === teamAbbrev)
  ).map(t => toNumber(t?.id ?? t?.teamId)).filter((id): id is number => id != null))];
}

async function getCurrentStandingsRow(
  teamAbbrev: string,
  seasonId: number
): Promise<StandingsRow | null> {
  try {
  const res = await fetch("https://api-web.nhle.com/v1/standings/now", {
    cache: "no-store",
    headers: { "User-Agent": "game-data" },
  });

  if (!res.ok) return null;

  const json = await res.json();
  const rows: StandingsRow[] = Array.isArray(json?.standings) ? json.standings : [];

  return (
    rows.find((row) => standingsAbbrev(row) === teamAbbrev && row.seasonId === seasonId) ?? null
  );
  } catch {
    // Current standings are optional enrichment for an explicit historical season.
    return null;
  }
}

// GET /api/team/summary?team=TOR
export async function GET(req: Request) {
  const url = new URL(req.url);
  const teamAbbrev = (url.searchParams.get("team") || "").trim().toUpperCase();
  const seasonOverride = toNumber(url.searchParams.get("season"));
  const gameTypeId = 2;

  if (!teamAbbrev) {
    return NextResponse.json({ error: "Missing query param ?team=TOR" }, { status: 400 });
  }

  try {
    const seasonId = seasonOverride ?? (await getCurrentSeasonId());
    const teamIds = await getTeamIdsByAbbrev(teamAbbrev);
    if (!teamIds.length) {
      return NextResponse.json({ error: `Unknown team abbrev: ${teamAbbrev}` }, { status: 404 });
    }

    const teamFilter = teamIds.map(id => `teamId=${id}`).join(" or ");
    const cayenneExp = `seasonId=${seasonId} and gameTypeId=${gameTypeId} and (${teamFilter})`;
    const endpoint =
      "https://api.nhle.com/stats/rest/en/team/summary" +
      `?cayenneExp=${encodeURIComponent(cayenneExp)}`;

    const [summaryRes, standingsRow] = await Promise.all([
      fetch(endpoint, {
        cache: "no-store",
        headers: { "User-Agent": "game-data" },
      }),
      getCurrentStandingsRow(teamAbbrev, seasonId),
    ]);

    if (!summaryRes.ok) {
      return NextResponse.json(
        { error: `team/summary fetch failed: ${summaryRes.status}`, endpoint },
        { status: 502 }
      );
    }

    const json = await summaryRes.json();
    const row = Array.isArray(json?.data) ? json.data[0] : null;

    if (!row) {
      return NextResponse.json(
        { error: "No team summary row returned", teamAbbrev, teamIds, seasonId },
        { status: 502 }
      );
    }

    const payload: TeamSummary = {
      teamAbbrev,
      seasonId,
      gameTypeId,

      teamId: toNumber(row?.teamId),
      teamFullName:
        (typeof row?.teamFullName === "string" && row.teamFullName.trim()) ||
        standingsTeamName(standingsRow),

      gamesPlayed: toNumber(row?.gamesPlayed),

      goalsForPerGame: round2(toNumber(row?.goalsForPerGame)),
      goalsAgainstPerGame: round2(toNumber(row?.goalsAgainstPerGame)),

      powerPlayPct: pctFromDecimal01(toNumber(row?.powerPlayPct)),
      penaltyKillPct: pctFromDecimal01(toNumber(row?.penaltyKillPct)),

      shotsForPerGame: round2(toNumber(row?.shotsForPerGame)),
      shotsAgainstPerGame: round2(toNumber(row?.shotsAgainstPerGame)),

      wins: toNumber(row?.wins) ?? toNumber(standingsRow?.wins),
      losses: toNumber(row?.losses) ?? toNumber(standingsRow?.losses),
      otLosses: toNumber(row?.otLosses) ?? toNumber(standingsRow?.otLosses),
      points: toNumber(row?.points) ?? toNumber(standingsRow?.points),

      leagueSequence: toNumber(standingsRow?.leagueSequence),
      streakCode:
        typeof standingsRow?.streakCode === "string"
          ? standingsRow.streakCode.toUpperCase()
          : null,
      streakCount: toNumber(standingsRow?.streakCount),
    };

    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Server error", detail: String(err?.message ?? err) },
      { status: err instanceof CurrentSeasonError ? 503 : 500 }
    );
  }
}
