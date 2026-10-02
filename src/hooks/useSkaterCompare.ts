"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { fetchCompareJson } from "@/lib/compareRequest";
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
  leaders: {
    goals: LeaderValue | null;
    assists: LeaderValue | null;
    points: LeaderValue | null;
    sog: LeaderValue | null;
    blocks: LeaderValue | null;
    hits: LeaderValue | null;
  };
};

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

    const controller = new AbortController();
    const positionGroup = getPositionGroup(compareBy);
    const seq = ++requestSeq.current;

    setLeftData(null);
    setRightData(null);
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [left, right] = await Promise.all([
          fetchCompareJson<SkaterComparePayload>(
            `/api/compare/skaters?team=${encodeURIComponent(
              team1
            )}&filterBy=${encodeURIComponent(
              filterBy
            )}&positionGroup=${encodeURIComponent(positionGroup)}`,
            {
              signal: controller.signal,
              cache: "no-store",
            }
          ),
          fetchCompareJson<SkaterComparePayload>(
            `/api/compare/skaters?team=${encodeURIComponent(
              team2
            )}&filterBy=${encodeURIComponent(
              filterBy
            )}&positionGroup=${encodeURIComponent(positionGroup)}`,
            {
              signal: controller.signal,
              cache: "no-store",
            }
          ),
        ]);

        if (controller.signal.aborted || requestSeq.current !== seq || !left || !right) return;

        setLeftData(left);
        setRightData(right);
      } catch (error: any) {
        if (error?.name === "AbortError") return;
        if (controller.signal.aborted || requestSeq.current !== seq) return;

        setLeftData(null);
        setRightData(null);
        setError(error?.message ?? "Failed to load skater compare data");
      } finally {
        if (!controller.signal.aborted && requestSeq.current === seq) {
          setLoading(false);
        }
      }
    })();

    return () => {
      if (requestSeq.current === seq) requestSeq.current += 1;
      controller.abort();
    };
  }, [team1, team2, compareBy, filterBy]);

  return { leftData, rightData, loading, error };
}