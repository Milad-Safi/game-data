import { CurrentSeasonError, getCurrentSeasonId } from "@/lib/nhl/currentSeason";
import { getSeasonStartYear } from "@/lib/nhl/season";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const revalidate = 60;

type TeamAbbrev = string;

function normalizeTeam(input: string): TeamAbbrev {
  return input.trim().toUpperCase();
}

function num(n: unknown, fallback = 0): number {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function pct100(goals: number, opps: number): number | null {
  if (!opps || opps <= 0) return null;
  return +((goals / opps) * 100).toFixed(1);
}

function isISODate(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function todayISO_UTC(): string {
  return new Date().toISOString().slice(0, 10);
}

const ALLOWED_WINDOWS = new Set([1, 2, 3, 4, 5, 10]);

type BoxscoreOutcome = {
  gameOutcome?: { lastPeriodType?: string };
  periodDescriptor?: { periodType?: string };
};

function isOtlFromBoxscore(box: BoxscoreOutcome): boolean {
  const last = (box?.gameOutcome?.lastPeriodType ?? "").toUpperCase();
  if (last === "OT" || last === "SO") return true;

  const pd = (box?.periodDescriptor?.periodType ?? "").toUpperCase();
  if (pd === "OT" || pd === "SO") return true;

  return false;
}

async function fetchBoxscoreOutcome(gameId: number): Promise<BoxscoreOutcome | null> {
  if (!Number.isFinite(gameId)) return null;

  const url = `https://api-web.nhle.com/v1/gamecenter/${gameId}/boxscore`;
  const r = await fetch(url, { next: { revalidate } });
  if (!r.ok) return null;

  return (await r.json()) as BoxscoreOutcome;
}

function parseWindow(raw: string | null): number | null {
  if (raw == null || raw === "") return null;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || !ALLOWED_WINDOWS.has(parsed)) return null;
  return parsed;
}

// GET /api/team/split?team=TOR&window=5&as_of=YYYY-MM-DD
// Returns split aggregates plus record split with OTL detection
export async function GET(req: Request) {
  const url = new URL(req.url);
  const team = normalizeTeam(url.searchParams.get("team") || "");
  const asOfParam = url.searchParams.get("as_of");
  const asOf = isISODate(asOfParam) ? asOfParam : todayISO_UTC();
  const window = parseWindow(url.searchParams.get("window"));

  if (!team) {
    return NextResponse.json({ error: "Missing ?team=TOR" }, { status: 400 });
  }

  if (window == null) {
    return NextResponse.json(
      { error: "Provide ?window=1|2|3|4|5|10" },
      { status: 400 }
    );
  }

  try {
    const seasonYear = isISODate(asOfParam)
      ? getSeasonStartYear(new Date(`${asOf}T12:00:00Z`))
      : Math.floor(await getCurrentSeasonId() / 10000);
    const params: Array<string | number> = [team, seasonYear, asOf, window];
    const sql = `
      SELECT
        tg.game_id,
        tg.game_date,
        tg.goals_for,
        tg.goals_against,
        tg.shots_for,
        tg.shots_against,
        COALESCE(tg.pp_goals,0) AS pp_goals,
        COALESCE(tg.pp_opps,0) AS pp_opps,
        COALESCE(tg.pk_goals_against,0) AS pk_goals_against,
        COALESCE(tg.pk_opps,0) AS pk_opps,
        tg.win
      FROM team_games tg
      WHERE tg.team = $1
        AND LEFT(tg.game_id::text, 4)::int = $2
        AND tg.game_date <= $3
        AND SUBSTRING(tg.game_id::text, 5, 2) = '02'
      ORDER BY tg.game_date DESC, tg.game_id DESC
      LIMIT $4
    `;

    const r = await query<{
      game_id: string | number;
      game_date: string;
      goals_for: number;
      goals_against: number;
      shots_for: number;
      shots_against: number;
      pp_goals: number | null;
      pp_opps: number | null;
      pk_goals_against: number | null;
      pk_opps: number | null;
      win: boolean | null;
    }>(sql, params);

    const rows = r.rows ?? [];

    if (rows.length === 0) {
      return NextResponse.json({
        team,
        games: 0,
        window,
        record: { w: 0, l: 0, otl: 0 },
        goalsFor: 0,
        goalsAgainst: 0,
        goalsForPerGame: 0,
        goalsAgainstPerGame: 0,
        shotsForPerGame: 0,
        shotsAgainstPerGame: 0,
        powerPlay: { goals: 0, opps: 0, pct: null },
        penaltyKill: { oppPPGoals: 0, oppPPOpps: 0, pct: null },
        gameIds: [],
        skippedPPGames: [],
        note: "Computed from Supabase team_games (no backend).",
      });
    }

    let games = 0;
    let w = 0;
    let l = 0;
    let otl = 0;

    let gf = 0;
    let ga = 0;
    let sf = 0;
    let sa = 0;

    let ppGoals = 0;
    let ppOpps = 0;

    let pkGA = 0;
    let pkOpps = 0;

    const gameIds = rows
      .map((x) => Number(x.game_id))
      .filter((n) => Number.isFinite(n));

    const lossIdxs: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const won = !!rows[i].win;
      if (!won) lossIdxs.push(i);
    }

    const lossIsOtl = new Map<number, boolean>();
    await Promise.all(
      lossIdxs.map(async (i) => {
        const gid = Number(rows[i].game_id);
        if (!Number.isFinite(gid)) return;

        const box = await fetchBoxscoreOutcome(gid);
        if (!box) return;

        if (isOtlFromBoxscore(box)) lossIsOtl.set(i, true);
      })
    );

    for (let i = 0; i < rows.length; i++) {
      const g = rows[i];
      games++;

      gf += num(g.goals_for);
      ga += num(g.goals_against);
      sf += num(g.shots_for);
      sa += num(g.shots_against);

      const won = !!g.win;
      if (won) {
        w++;
      } else {
        if (lossIsOtl.get(i)) otl++;
        else l++;
      }

      ppGoals += num(g.pp_goals);
      ppOpps += num(g.pp_opps);

      pkGA += num(g.pk_goals_against);
      pkOpps += num(g.pk_opps);
    }

    const ppPct = pct100(ppGoals, ppOpps);
    const pkPct = pkOpps > 0 ? +(100 - (pkGA / pkOpps) * 100).toFixed(1) : null;

    return NextResponse.json({
      team,
      games,
      window,
      record: { w, l, otl },
      goalsFor: gf,
      goalsAgainst: ga,
      goalsForPerGame: +(gf / games).toFixed(2),
      goalsAgainstPerGame: +(ga / games).toFixed(2),
      shotsForPerGame: +(sf / games).toFixed(2),
      shotsAgainstPerGame: +(sa / games).toFixed(2),
      powerPlay: { goals: ppGoals, opps: ppOpps, pct: ppPct },
      penaltyKill: { oppPPGoals: pkGA, oppPPOpps: pkOpps, pct: pkPct },
      gameIds,
      skippedPPGames: [],
      note: "Computed from Supabase team_games (no backend).",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "DB split error", detail: String(err?.message ?? err) },
      { status: err instanceof CurrentSeasonError ? 503 : 500 }
    );
  }
}
