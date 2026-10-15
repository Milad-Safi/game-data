import { fetchBoxscoreWithRetry } from "@/lib/nhl/compareBackend";
import type { HistoricalDecision } from "@/types/games";

export type StoredTeamResult = {
    game_id: string | number;
    game_date: string | Date | null;
    team: string;
    opponent: string;
    is_home: boolean | null;
    goals_for: number | null;
    goals_against: number | null;
};

type OfficialBoxscore = {
    id?: number;
    season?: number;
    gameType?: number;
    gameState?: string;
    gameDate?: string;
    homeTeam?: { abbrev?: string; score?: number };
    awayTeam?: { abbrev?: string; score?: number };
    gameOutcome?: { lastPeriodType?: string };
    periodDescriptor?: { periodType?: string };
};

function validScore(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Preserve valid stored scores; recover tied/missing scores only from a verified final.
 * Identity/final-score checks mirror Python elo._official_scores without a backend call.
 * An unavailable ending type is independent of whether the winner is known.
 */
export async function resolveTeamGameResult(row: StoredTeamResult) {
    let goalsFor = validScore(row.goals_for) ? row.goals_for : null;
    let goalsAgainst = validScore(row.goals_against) ? row.goals_against : null;
    const needsRecovery = goalsFor === null || goalsAgainst === null || goalsFor === goalsAgainst;
    if (needsRecovery) goalsFor = goalsAgainst = null;
    let decision: HistoricalDecision | null = null;
    const gameId = Number(row.game_id);
    const year = Math.floor(gameId / 1_000_000);
    const day = row.game_date instanceof Date
        ? (Number.isNaN(row.game_date.getTime()) ? null : row.game_date.toISOString().slice(0, 10))
        : row.game_date?.slice(0, 10);
    const home = row.is_home ? row.team : row.opponent;
    const away = row.is_home ? row.opponent : row.team;
    try {
        if (!Number.isInteger(gameId) || !/^\d{4}02\d{4}$/.test(String(gameId))
            || typeof row.is_home !== "boolean" || !day || !home || !away || home === away) {
            return { goalsFor: null, goalsAgainst: null, won: null, decision: null };
        }
        const box = await fetchBoxscoreWithRetry<OfficialBoxscore>(gameId);
        const hs = box?.homeTeam?.score, aws = box?.awayTeam?.score;
        if (box?.id === gameId && box.gameType === 2 && box.season === year * 10000 + year + 1
            && (box.gameState === "FINAL" || box.gameState === "OFF") && box.gameDate === day
            && box.homeTeam?.abbrev === home && box.awayTeam?.abbrev === away
            && validScore(hs) && validScore(aws) && hs !== aws) {
            if (needsRecovery) {
                goalsFor = row.is_home ? hs : aws;
                goalsAgainst = row.is_home ? aws : hs;
            }
            // Conflicting official/stored scores cannot reliably classify the stored result.
            if (goalsFor === (row.is_home ? hs : aws) && goalsAgainst === (row.is_home ? aws : hs)) {
                const endings = [box.gameOutcome?.lastPeriodType, box.periodDescriptor?.periodType]
                    .map(value => value?.toUpperCase()).filter(value => value === "REG" || value === "OT" || value === "SO");
                if (new Set(endings).size === 1) decision = endings[0]!.toLowerCase() as HistoricalDecision;
            }
        }
    } catch {
        // Keep a known stored winner, but never fabricate an ending or tied-game winner.
    }
    return { goalsFor, goalsAgainst,
        won: goalsFor !== null && goalsAgainst !== null ? goalsFor > goalsAgainst : null,
        decision };
}
