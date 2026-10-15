"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { fetchJson } from "@/lib/fetchJson";
import { type CompareFilter, type CompareMode } from "@/lib/compare";

type PositionGroup = "all" | "forwards" | "defenders";

type LeaderValue = {
  playerId: number;
  name: string;
  value: number;
};

type SkaterComparePayload = {
  team: string;
  filterBy: CompareFilter;
  positionGroup: PositionGroup;
  gamesUsed: number;
  shotsAllowed: { games: number; forwards: number | null; defenders: number | null };
  leaders: {
    goals: LeaderValue | null;
    assists: LeaderValue | null;
    points: LeaderValue | null;
    sog: LeaderValue | null;
    blocks: LeaderValue | null;
    hits: LeaderValue | null;
  };
};

// Share requests across quick position switches without aborting another view's work.
// Cache only successful responses briefly; failed requests can be retried immediately.
const responses = new Map<string, { data: SkaterComparePayload; expires: number }>();
const pending = new Map<string, Promise<SkaterComparePayload>>();
function loadSkaters(url: string): Promise<SkaterComparePayload> {
  const now = Date.now();
  for (const [key, entry] of responses) if (entry.expires <= now) responses.delete(key);
  const saved = responses.get(url);
  if (saved) return Promise.resolve(saved.data);
  const existing = pending.get(url);
  if (existing) return existing;
  const request = fetchJson<SkaterComparePayload>(url, { cache: "no-store" })
    .then(data => {
      if (responses.size >= 128) responses.delete(responses.keys().next().value!);
      responses.set(url, { data, expires: Date.now() + 60_000 });
      return data;
    }).finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
}

function getPositionGroup(compareBy: CompareMode): PositionGroup {
  if (compareBy === "forwards") return "forwards";
  if (compareBy === "defenders") return "defenders";
  return "all";
}

export default function useSkaterCompare(
  team1: string | null,
  team2: string | null,
  compareBy: CompareMode,
  filterBy: CompareFilter
) {
  const [leftData, setLeftData] = useState<SkaterComparePayload | null>(null);
  const [rightData, setRightData] = useState<SkaterComparePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestSeq = useRef(0);

  useLayoutEffect(() => {
    if (!team1 || !team2) {
      setLeftData(null);
      setRightData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const positionGroup = getPositionGroup(compareBy);
    const seq = ++requestSeq.current;

    setLeftData(null);
    setRightData(null);
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [left, right] = await Promise.all([
          loadSkaters(
            `/api/compare/skaters?team=${encodeURIComponent(
              team1
            )}&filterBy=${encodeURIComponent(
              filterBy
            )}&positionGroup=${encodeURIComponent(positionGroup)}`
          ),
          loadSkaters(
            `/api/compare/skaters?team=${encodeURIComponent(
              team2
            )}&filterBy=${encodeURIComponent(
              filterBy
            )}&positionGroup=${encodeURIComponent(positionGroup)}`
          ),
        ]);

        if (requestSeq.current !== seq || !left || !right) return;

        setLeftData(left);
        setRightData(right);
      } catch (error: any) {
        if (error?.name === "AbortError") return;
        if (requestSeq.current !== seq) return;

        setLeftData(null);
        setRightData(null);
        setError(error?.message ?? "Failed to load skater compare data");
      } finally {
        if (requestSeq.current === seq) {
          setLoading(false);
        }
      }
    })();

    return () => {
      if (requestSeq.current === seq) requestSeq.current += 1;
      // Let shared work finish, but never apply it to an obsolete selection.
    };
  }, [team1, team2, compareBy, filterBy]);

  return { leftData, rightData, loading, error };
}