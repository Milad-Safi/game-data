export type Totals = Record<string, number>;
export type TeamGame = { id: string; date: string; week: number; team: string; opponent: string; own: Totals; against: Totals };
export type Snapshot = { version: 1; season: number; updatedAt: string; latestGameDate: string | null; scheduledCompletedGames: number; includedGames: number; excludedGames: string[]; teams: string[]; games: TeamGame[]; sources: string[]; warnings: string[] };
export type Metric = { key: string; label: string; percent?: boolean };
export const SECTIONS: { title: string; rows: Metric[] }[] = [
    { title: "Offence", rows: [
        { key: "points", label: "Points / game" }, { key: "yards", label: "Total yards / game" },
        { key: "passYards", label: "Net passing yards / game" }, { key: "rushYards", label: "Rushing yards / game" },
        { key: "turnovers", label: "Turnovers / game" }, { key: "firstDowns", label: "First downs / game" },
        { key: "thirdPct", label: "Third-down conversion %", percent: true }, { key: "fourthPct", label: "Fourth-down conversion %", percent: true },
        { key: "redZonePct", label: "Red-zone TD %", percent: true },
        { key: "penalties", label: "Penalties / game" }, { key: "penaltyYards", label: "Penalty yards / game" },
    ] },
    { title: "Defence", rows: [
        { key: "pointsAllowed", label: "Points allowed / game" }, { key: "yardsAllowed", label: "Total yards allowed / game" },
        { key: "passYardsAllowed", label: "Net passing yards allowed / game" }, { key: "rushYardsAllowed", label: "Rushing yards allowed / game" },
        { key: "takeaways", label: "Takeaways / game" }, { key: "firstDownsAllowed", label: "First downs allowed / game" },
        { key: "thirdPctAllowed", label: "Third-down conversion % allowed", percent: true },
        { key: "fourthPctAllowed", label: "Fourth-down conversion % allowed", percent: true },
        { key: "redZonePctAllowed", label: "Red-zone TD % allowed", percent: true },
    ] },
    { title: "Production by position", rows: [
        { key: "qbPass", label: "QB passing yards / game" }, { key: "qbRush", label: "QB rushing yards / game" },
        { key: "wrRec", label: "WR receiving yards / game" }, { key: "teRec", label: "TE receiving yards / game" },
        { key: "rbRush", label: "RB rushing yards / game" }, { key: "rbRec", label: "RB receiving yards / game" },
    ] },
    { title: "Production allowed by position", rows: [
        { key: "qbPassAllowed", label: "QB passing yards allowed / game" }, { key: "qbRushAllowed", label: "QB rushing yards allowed / game" },
        { key: "wrRecAllowed", label: "WR receiving yards allowed / game" }, { key: "teRecAllowed", label: "TE receiving yards allowed / game" },
        { key: "rbRushAllowed", label: "RB rushing yards allowed / game" }, { key: "rbRecAllowed", label: "RB receiving yards allowed / game" },
    ] },
];
export const normalizeTeam = (team: string) => ({ LA: "LAR", JAC: "JAX", WSH: "WAS" }[team.toUpperCase()] ?? team.toUpperCase());
export function summarize(snapshot: Snapshot, team: string, last: number | null = null) {
    const all = snapshot.games.filter(g => g.team === team).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    const games = last === null ? all : all.slice(0, last);
    const metrics: Record<string, number | null> = {};
    const total = (side: "own" | "against", key: string) => games.reduce((sum, g) => sum + g[side][key], 0);
    for (const section of SECTIONS) for (const metric of section.rows) {
        const allowed = metric.key.endsWith("Allowed") || metric.key === "takeaways";
        const side = allowed ? "against" : "own";
        const key = metric.key === "takeaways" ? "turnovers" : metric.key.replace(/Allowed$/, "");
        const prefix = ({ thirdPct: "third", fourthPct: "fourth", redZonePct: "redZone" } as Record<string, string>)[key];
        const denominator = prefix ? total(side, `${prefix}Attempts`) : games.length;
        metrics[metric.key] = denominator ? total(side, prefix ? `${prefix}Made` : key) / denominator * (prefix ? 100 : 1) : null;
    }
    return { team, gamesPlayed: games.length, seasonGamesPlayed: all.length,
        wins: games.filter(g => g.own.points > g.against.points).length,
        losses: games.filter(g => g.own.points < g.against.points).length,
        ties: games.filter(g => g.own.points === g.against.points).length,
        lastGameDate: games[0]?.date ?? null, metrics,
        denominators: Object.fromEntries(["own", "against"].map(side => [side, Object.fromEntries(["third", "fourth", "redZone"].map(key => [key, { made: total(side as "own" | "against", `${key}Made`), attempts: total(side as "own" | "against", `${key}Attempts`) }]))])) };
}
export type TeamSummary = ReturnType<typeof summarize>;
export type RankedTeamSummary = TeamSummary & { ranks: Record<string, number | null> };

/** Competition ranks (1, 2, 2, 4), using unrounded stats from the same range. */
export function rankLeague(summaries: TeamSummary[]): Record<string, RankedTeamSummary> {
    const ranked = Object.fromEntries(summaries.map(team => [team.team, {
        ...team, ranks: Object.fromEntries(Object.keys(team.metrics).map(key => [key, null])) as Record<string, number | null>,
    }]));
    for (const { rows } of SECTIONS) for (const { key } of rows) {
        const lowerIsBetter = key.endsWith("Allowed") || ["turnovers", "penalties", "penaltyYards"].includes(key);
        const values = summaries.flatMap(team => {
            const value = team.metrics[key];
            // Ignore missing stats; normalize floating-point noise, not display precision.
            return value === null || !Number.isFinite(value) ? [] : [{ team: team.team, value: Math.round(value * 1e9) / 1e9 }];
        }).sort((a, b) => lowerIsBetter ? a.value - b.value : b.value - a.value);
        let rank = 0;
        values.forEach((entry, index) => {
            if (index === 0 || entry.value !== values[index - 1].value) rank = index + 1;
            ranked[entry.team].ranks[key] = rank;
        });
    }
    return ranked;
}
export type CompareResponse = { season: number; updatedAt: string; latestGameDate: string | null; stale: boolean; warnings: string[]; left: RankedTeamSummary; right: RankedTeamSummary };
