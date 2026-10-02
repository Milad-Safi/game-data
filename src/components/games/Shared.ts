import type { CSSProperties } from "react";

import { getTeamColor } from "@/lib/teamColours";
import type {
    HistoricalGameDetailResponse,
    HistoricalGameSkaterRow,
} from "@/types/games";

export type SkaterSortKey =
    | "name"
    | "goals"
    | "assists"
    | "points"
    | "shots"
    | "toiSeconds"
    | "hits"
    | "blocks";

export type SortDirection = "asc" | "desc";

export function formatGameDate(date?: string) {
    if (!date) return "Historical game";

    const parsed = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return date;

    return new Intl.DateTimeFormat("en-CA", {
        month: "long",
        day: "numeric",
        year: "numeric",
    }).format(parsed);
}

export function formatCompactGameDate(date?: string) {
    if (!date) return "Date unavailable";

    const parsed = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return date;

    return new Intl.DateTimeFormat("en-CA", {
        month: "short",
        day: "numeric",
    }).format(parsed);
}

export function formatDecisionLabel(
    decision: HistoricalGameDetailResponse["decision"]
) {
    if (decision === "ot") return "OT";
    if (decision === "so") return "SO";
    return "Regulation";
}

export function formatVenueLabel(data: HistoricalGameDetailResponse) {
    return `${data.awayTeam.abbrev} @ ${data.homeTeam.abbrev}`;
}

export function formatNumber(value: number, decimals = 0) {
    if (!Number.isFinite(value)) return "—";
    return decimals > 0 ? value.toFixed(decimals) : String(value);
}

export function formatSavePct(value: number) {
    if (!Number.isFinite(value)) return "—";
    return value.toFixed(3);
}

export function sortLabel(
    column: string,
    activeColumn: string,
    direction: SortDirection
) {
    if (column !== activeColumn) return "";
    return direction === "desc" ? " ↓" : " ↑";
}

export function compareSkaters(
    left: HistoricalGameSkaterRow,
    right: HistoricalGameSkaterRow,
    sortKey: SkaterSortKey,
    direction: SortDirection
) {
    let base = 0;

    if (sortKey === "name") {
        base = left.name.localeCompare(right.name);
    } else {
        base = left[sortKey] - right[sortKey];
    }

    if (base === 0) {
        base =
            right.points - left.points ||
            right.goals - left.goals ||
            left.name.localeCompare(right.name);
    }

    return direction === "asc" ? base : -base;
}

export function teamSideKey(
    data: HistoricalGameDetailResponse,
    teamAbbrev: string
): "home" | "away" {
    return teamAbbrev === data.homeTeam.abbrev ? "home" : "away";
}

function withAlpha(colour: string, alpha: number) {
    const match = colour.match(
        /rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\)/i
    );

    if (!match) {
        return colour;
    }

    const [, red, green, blue] = match;
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function buildDetailThemeStyle(
    data: HistoricalGameDetailResponse
): CSSProperties {
    const awayColour = getTeamColor(data.awayTeam.abbrev);
    const homeColour = getTeamColor(data.homeTeam.abbrev);

    return {
        "--historical-away-colour": awayColour,
        "--historical-away-colour-soft": withAlpha(awayColour, 0.16),
        "--historical-away-colour-soft-strong": withAlpha(awayColour, 0.24),
        "--historical-home-colour": homeColour,
        "--historical-home-colour-soft": withAlpha(homeColour, 0.16),
        "--historical-home-colour-soft-strong": withAlpha(homeColour, 0.24),
    } as CSSProperties;
}