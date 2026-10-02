import type { HistoricalSeasonOption } from "@/types/games";
import { getSeasonLabel } from "@/lib/nhl/season";

// First season supported by the historical archive, not the current season.
export const FIRST_HISTORICAL_SEASON_YEAR = 2023;
export const HISTORICAL_GAMES_PAGE_SIZE = 12;

export function getHistoricalSeasonOptions(current: number): HistoricalSeasonOption[] {
    return Array.from(
        { length: Math.max(0, current - FIRST_HISTORICAL_SEASON_YEAR + 1) },
        (_, index) => getSeasonLabel(current - index),
    );
}

export function isHistoricalSeasonOption(
    value: string | null | undefined,
    current: number,
): value is HistoricalSeasonOption {
    return getHistoricalSeasonOptions(current).some((season) => season === value);
}
