"use client";


// React hook for loading and mapping roster player headshots

import * as React from "react";
import { fetchJson } from "@/lib/fetchJson";

type RosterPlayer = {
  id?: number;
  headshot?: string;
};

// Extract all player-like objects from the roster API response
function collectRosterPlayers(rosterJson: any): RosterPlayer[] {
  if (!rosterJson || typeof rosterJson !== "object") return [];
  const out: RosterPlayer[] = [];

  for (const v of Object.values(rosterJson)) {
    if (Array.isArray(v)) {
      for (const p of v) {
        if (p && typeof p === "object") out.push(p as RosterPlayer);
      }
    }
  }
  return out;
}

// Hook that fetches roster data and builds a playerId to headshot map
export default function useRosterHeadshots(team: string, season?: string) {
  const [headshotById, setHeadshotById] = React.useState<Map<number, string>>(
    () => new Map()
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      // Reset state if required params are missing
      if (!team) {
        setHeadshotById(new Map());
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Fetch roster from internal API 
        const json = await fetchJson<any>(
          `/api/team/roster?team=${encodeURIComponent(team)}${season ? `&season=${encodeURIComponent(season)}` : ""}`,
          { cache: "no-store" }
        );

        // Collect players and build an ID to headshot lookup map
        const players = collectRosterPlayers(json);
        const m = new Map<number, string>();

        for (const p of players) {
          if (
            typeof p?.id === "number" &&
            typeof p?.headshot === "string" &&
            p.headshot
          ) {
            m.set(p.id, p.headshot);
          }
        }

        if (!cancelled) setHeadshotById(m);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Roster fetch failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [team, season]);

  return { headshotById, loading, error };
}
