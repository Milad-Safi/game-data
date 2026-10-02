import { CurrentSeasonError, getCurrentSeasonId } from "@/lib/nhl/currentSeason";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// GET /api/roster?team=TOR
// Proxies the NHL roster endpoint with no caching so headshots and roster data stay fresh
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const team = searchParams.get("team");

  // Validate required query params
  if (!team) {
    return NextResponse.json(
      { ok: false, error: "Missing team" },
      { status: 400 }
    );
  }

  // NHL roster endpoint expects team abbrev and season id in the path
  try {
    const season = searchParams.get("season") ?? String(await getCurrentSeasonId());
    const url = `https://api-web.nhle.com/v1/roster/${team}/${season}`;
    // Fetch raw JSON from NHL and pass it through without reshaping
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });

    // Use text pass-through to preserve the upstream payload exactly
    const text = await res.text();

    return new NextResponse(text, {
      status: res.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (e: any) {
    // Handle network or upstream failures with a consistent JSON error shape
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Roster fetch failed" },
      { status: e instanceof CurrentSeasonError ? 503 : 500 }
    );
  }
}
