"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { TeamRanks, TeamSplit, TeamSummary } from "@/types/api";
import { fetchCompareJson } from "@/lib/compareRequest";
import type { CompareFilter } from "@/lib/compare";

type MatchupData = {
  leftSummary: TeamSummary | null;
  rightSummary: TeamSummary | null;
  loadingSummary: boolean;

  leftSplit: TeamSplit | null;
  rightSplit: TeamSplit | null;
  loadingSplit: boolean;

  teamRanks: TeamRanks | null;
};

function getSplitQueryFromFilter(filterBy: CompareFilter): string | null {
  if (filterBy === "last1") return "window=1";
  if (filterBy === "last2") return "window=2";
  if (filterBy === "last3") return "window=3";
  if (filterBy === "last4") return "window=4";
  if (filterBy === "last5") return "window=5";
  if (filterBy === "last10") return "window=10";
  return null;
}

export default function useMatchupData({
  leftTeamAbbrev,
  rightTeamAbbrev,
  filterBy,
  enabled,
}: {
  leftTeamAbbrev: string;
  rightTeamAbbrev: string | null;
  filterBy: CompareFilter;
  enabled: boolean;
}): MatchupData {
  const [leftSummary, setLeftSummary] = useState<TeamSummary | null>(null);
  const [rightSummary, setRightSummary] = useState<TeamSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const [leftSplit, setLeftSplit] = useState<TeamSplit | null>(null);
  const [rightSplit, setRightSplit] = useState<TeamSplit | null>(null);
  const [loadingSplit, setLoadingSplit] = useState(false);

  const [teamRanks, setTeamRanks] = useState<TeamRanks | null>(null);

  const requestSeq = useRef(0);

  useLayoutEffect(() => {
    if (!enabled || !rightTeamAbbrev) {
      setLeftSummary(null);
      setRightSummary(null);
      setLeftSplit(null);
      setRightSplit(null);
      setTeamRanks(null);
      setLoadingSummary(false);
      setLoadingSplit(false);
      return;
    }

    const seq = ++requestSeq.current;
    const ctrl = new AbortController();
    const splitQuery = getSplitQueryFromFilter(filterBy);
    const needsSeasonSummary = filterBy === "season";
    const needsSplit = splitQuery != null;

    setLeftSummary(null);
    setRightSummary(null);
    setLeftSplit(null);
    setRightSplit(null);
    setTeamRanks(null);
    setLoadingSummary(needsSeasonSummary);
    setLoadingSplit(needsSplit);

    async function run() {
      if (needsSeasonSummary) {
        try {
          const [left, right] = await Promise.all([
            fetchCompareJson<TeamSummary>(`/api/team/summary?team=${leftTeamAbbrev}`, {
              signal: ctrl.signal,
            }),
            fetchCompareJson<TeamSummary>(`/api/team/summary?team=${rightTeamAbbrev}`, {
              signal: ctrl.signal,
            }),
          ]);

          if (ctrl.signal.aborted || requestSeq.current !== seq) return;
          setLeftSummary(left?.teamAbbrev ? left : null);
          setRightSummary(right?.teamAbbrev ? right : null);
        } catch {
          if (ctrl.signal.aborted || requestSeq.current !== seq) return;
          setLeftSummary(null);
          setRightSummary(null);
        } finally {
          if (!ctrl.signal.aborted && requestSeq.current === seq) {
            setLoadingSummary(false);
          }
        }
      }

      if (ctrl.signal.aborted || requestSeq.current !== seq) return;

      if (needsSplit && splitQuery) {
        try {
          const [left, right] = await Promise.all([
            fetchCompareJson<TeamSplit>(
              `/api/team/split?team=${leftTeamAbbrev}&${splitQuery}`,
              { signal: ctrl.signal }
            ),
            fetchCompareJson<TeamSplit>(
              `/api/team/split?team=${rightTeamAbbrev}&${splitQuery}`,
              { signal: ctrl.signal }
            ),
          ]);

          if (ctrl.signal.aborted || requestSeq.current !== seq) return;
          setLeftSplit(left?.team ? left : null);
          setRightSplit(right?.team ? right : null);
        } catch {
          if (ctrl.signal.aborted || requestSeq.current !== seq) return;
          setLeftSplit(null);
          setRightSplit(null);
        } finally {
          if (!ctrl.signal.aborted && requestSeq.current === seq) {
            setLoadingSplit(false);
          }
        }
      }

      if (ctrl.signal.aborted || requestSeq.current !== seq) return;

      try {
        const j = await fetchCompareJson<TeamRanks>(
          `/api/team/ranks?teamA=${leftTeamAbbrev}&teamB=${rightTeamAbbrev}`,
          { signal: ctrl.signal }
        );

        if (ctrl.signal.aborted || requestSeq.current !== seq) return;
        setTeamRanks(j?.ranks ? j : null);
      } catch {
        if (ctrl.signal.aborted || requestSeq.current !== seq) return;
        setTeamRanks(null);
      }
    }

    run();

    return () => {
      if (requestSeq.current === seq) requestSeq.current += 1;
      ctrl.abort();
    };
  }, [leftTeamAbbrev, rightTeamAbbrev, filterBy, enabled]);

  return {
    leftSummary,
    rightSummary,
    loadingSummary,
    leftSplit,
    rightSplit,
    loadingSplit,
    teamRanks,
  };
}