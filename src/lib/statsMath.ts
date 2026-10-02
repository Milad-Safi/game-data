// Shared helpers for compare weighting

export const TEAM_COMPARE_WEIGHTING = {
  points: {
    winPoints: 2,
    otLossPoints: 1,
  },
  streak: {
    k: 0.45,
    otLossFactor: 0.5,
  },
} as const;

export const MATCHUP_COMPARE_WEIGHTING = {
  savePct: {
    baseline: 0.9,
    k: 60,
  },
} as const;

export const GOALIE_COMPARE_WEIGHTING = {
  savePct: {
    baseline: 0.9,
    k: 60,
  },
  gaa: {
    baseline: 3,
    k: 1.9,
  },
} as const;

export function toPct100(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return null;
  return v <= 1 ? v * 100 : v;
}

export function higherBetterStrength(
  v: number | null | undefined,
  baseline: number,
  k: number
) {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.exp(k * (v - baseline));
}

export function lowerBetterStrength(
  v: number | null | undefined,
  baseline: number,
  k: number
) {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.exp(k * (baseline - v));
}

export function pairwiseHigherBetterStrength(
  value: number | null | undefined,
  otherValue: number | null | undefined,
  k: number,
  fallbackBaseline = 0
) {
  if (value == null || !Number.isFinite(value)) return null;

  const baseline =
    otherValue != null && Number.isFinite(otherValue)
      ? (value + otherValue) / 2
      : fallbackBaseline;

  return Math.exp(k * (value - baseline));
}

export function pointsFromWinsOtl(
  wins: number | null | undefined,
  otLosses: number | null | undefined
) {
  if (wins == null || !Number.isFinite(wins)) return null;

  const otl =
    otLosses != null && Number.isFinite(otLosses) ? otLosses : 0;

  return (
    wins * TEAM_COMPARE_WEIGHTING.points.winPoints +
    otl * TEAM_COMPARE_WEIGHTING.points.otLossPoints
  );
}

export function streakDisplayValue(
  streakCode: string | null | undefined,
  streakCount: number | null | undefined
) {
  if (!streakCode || streakCount == null || !Number.isFinite(streakCount)) {
    return null;
  }

  const code = streakCode.toUpperCase();
  const count = streakCount;

  if (code === "W") return count;
  if (code === "OT") {
    return -count * TEAM_COMPARE_WEIGHTING.streak.otLossFactor;
  }
  if (code === "L") return -count;

  return null;
}

export function teamStreakStrength(
  streakCode: string | null | undefined,
  streakCount: number | null | undefined,
  otherStreakCode: string | null | undefined,
  otherStreakCount: number | null | undefined
) {
  const value = streakDisplayValue(streakCode, streakCount);
  const otherValue = streakDisplayValue(otherStreakCode, otherStreakCount);

  return pairwiseHigherBetterStrength(
    value,
    otherValue,
    TEAM_COMPARE_WEIGHTING.streak.k,
    0
  );
}

export function matchupSavePctStrength(v: number | null | undefined) {
  return higherBetterStrength(
    v,
    MATCHUP_COMPARE_WEIGHTING.savePct.baseline,
    MATCHUP_COMPARE_WEIGHTING.savePct.k
  );
}

export function goalieSavePctStrength(v: number | null | undefined) {
  return higherBetterStrength(
    v,
    GOALIE_COMPARE_WEIGHTING.savePct.baseline,
    GOALIE_COMPARE_WEIGHTING.savePct.k
  );
}

export function goalieGaaStrength(v: number | null | undefined) {
  return lowerBetterStrength(
    v,
    GOALIE_COMPARE_WEIGHTING.gaa.baseline,
    GOALIE_COMPARE_WEIGHTING.gaa.k
  );
}