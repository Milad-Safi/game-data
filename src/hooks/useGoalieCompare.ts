"use client";

import { useLayoutEffect, useRef, useState } from "react";

import type { CompareFilter } from "@/lib/compare";
import { fetchCompareJson } from "@/lib/compareRequest";

type GoalieCompareValue = {
  playerId: number;
  name: string;
  gp: number;
  wins: number;
  savePct: number | null;
  gaa: number | null;
  shutouts: number;
};

type GoalieComparePayload = {
  team: string;
  filterBy: CompareFilter;
  gamesUsed: number;
  starter: GoalieCompareValue | null;
  additional: GoalieCompareValue | null;
};

export default function useGoalieCompare(
  team1: string | null,
  team2: string | null,
  filterBy: CompareFilter
) {
  const [leftData, setLeftData] = useState<GoalieComparePayload | null>(null);
  const [rightData, setRightData] = useState<GoalieComparePayload | null>(null);
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
    const seq = ++requestSeq.current;

    setLeftData(null);
    setRightData(null);
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [left, right] = await Promise.all([
          fetchCompareJson<GoalieComparePayload>(
            `/api/compare/goalies?team=${encodeURIComponent(
              team1
            )}&filterBy=${encodeURIComponent(filterBy)}`,
            { signal: controller.signal }
          ),
          fetchCompareJson<GoalieComparePayload>(
            `/api/compare/goalies?team=${encodeURIComponent(
              team2
            )}&filterBy=${encodeURIComponent(filterBy)}`,
            { signal: controller.signal }
          ),
        ]);

        if (controller.signal.aborted || requestSeq.current !== seq || !left || !right) return;

        setLeftData(left);
        setRightData(right);
      } catch (error: unknown) {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) return;
        if (controller.signal.aborted || requestSeq.current !== seq) return;

        setLeftData(null);
        setRightData(null);
        setError(error instanceof Error ? error.message : "Failed to load goalie compare data");
      } finally {
        if (!controller.signal.aborted && requestSeq.current === seq) {
          setLoading(false);
        }
      }
    })();

    return () => {
      // Invalidate this request before aborting so cleanup cannot update state.
      if (requestSeq.current === seq) requestSeq.current += 1;
      controller.abort();
    };
  }, [team1, team2, filterBy]);

  return { leftData, rightData, loading, error };
}
