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

async function getTeamIdByAbbrev(teamAbbrev: string): Promise<number | null> {
  const res = await fetch("https://api.nhle.com/stats/rest/en/team", {
    next: { revalidate: 60 * 60 },
    headers: { "User-Agent": "game-data" },
  });
  if (!res.ok) return null;

  const json = await res.json();
  const rows: any[] = Array.isArray(json?.data) ? json.data : [];

  const found =
    rows.find((t) => String(t?.triCode || "").toUpperCase() === teamAbbrev) ||
    rows.find((t) => String(t?.abbrev || "").toUpperCase() === teamAbbrev) ||
    rows.find((t) => String(t?.abbreviation || "").toUpperCase() === teamAbbrev);

  return toNumber(found?.id ?? found?.teamId) ?? null;
}

async function getCurrentStandingsRow(
  teamAbbrev: string,
  seasonId: number
): Promise<StandingsRow | null> {
  try {
  const res = await fetch("https://api-web.nhle.com/v1/standings/now", {
    next: { revalidate: 60 },
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
    const teamId = await getTeamIdByAbbrev(teamAbbrev);
    if (!teamId) {
      return NextResponse.json({ error: `Unknown team abbrev: ${teamAbbrev}` }, { status: 404 });
    }

    const cayenneExp = `seasonId=${seasonId} and gameTypeId=${gameTypeId} and teamId=${teamId}`;
    const endpoint =
      "https://api.nhle.com/stats/rest/en/team/summary" +
      `?cayenneExp=${encodeURIComponent(cayenneExp)}`;

    const [summaryRes, standingsRow] = await Promise.all([
      fetch(endpoint, {
        next: { revalidate: 60 },
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
        { error: "No team summary row returned", teamAbbrev, teamId, seasonId },
        { status: 502 }
      );
    }

    const payload: TeamSummary = {
      teamAbbrev,
      seasonId,
      gameTypeId,

      teamId: toNumber(row?.teamId ?? teamId),
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
