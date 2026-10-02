/** Calendar conversion for explicit historical/as-of dates only. */
export function getSeasonStartYear(date: Date): number {
    if (!Number.isFinite(date.getTime())) throw new Error("Invalid season date");
    const year = date.getUTCFullYear();
    return date.getUTCMonth() >= 6 ? year : year - 1;
}

export function getSeasonId(startYear: number): number {
    return startYear * 10000 + startYear + 1;
}

export function getSeasonLabel(startYear: number): `${number}-${number}` {
    return `${startYear}-${startYear + 1}`;
}
