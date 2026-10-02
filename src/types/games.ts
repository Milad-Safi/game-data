export type HistoricalSeasonOption = `${number}-${number}`;

export type HistoricalVenue = "home" | "away";
export type HistoricalDecision = "reg" | "ot" | "so";

export type HistoricalGameCard = {
    gameId: string;
    gameDate: string;
    searchedTeam: {
        abbrev: string;
        label: string;
        logoSrc: string;
        score: number;
    };
    opponent: {
        abbrev: string;
        label: string;
        logoSrc: string;
        score: number;
    };
    venue: HistoricalVenue;
    decision: HistoricalDecision;
    searchedTeamWon: boolean;
};

export type HistoricalGamesSearchFilters = {
    team: string;
    season: HistoricalSeasonOption;
    opponent: string | null;
};

export type HistoricalGamesSearchResponse = {
    filters: HistoricalGamesSearchFilters;
    pagination: {
        page: number;
        pageSize: number;
        totalGames: number;
        totalPages: number;
    };
    games: HistoricalGameCard[];
};

export type GameDetailPeriodKey = "ALL" | "1" | "2" | "3" | "OT";
export type GameDetailChartMode = "shots" | "goals";

export type HistoricalGamePositionFilter =
    | "skaters"
    | "forwards"
    | "defencemen"
    | "goalies";

export type HistoricalGameDetailTeam = {
    id: number | null;
    abbrev: string;
    label: string;
    logoSrc: string;
    score: number;
    sog: number;
};

export type HistoricalGameSkaterRow = {
    playerId: number;
    name: string;
    sweaterNumber: string;
    goals: number;
    assists: number;
    points: number;
    shots: number;
    hits: number;
    blocks: number;
    pim: number;
    toi: string;
    toiSeconds: number;
};

export type HistoricalGameGoalieRow = {
    playerId: number;
    name: string;
    sweaterNumber: string;
    shotsAgainst: number;
    saves: number;
    savePct: number;
    goalsAgainst: number;
    toi: string;
    toiSeconds: number;
    starter: boolean;
};

export type HistoricalGameShotEvent = {
    eventId: string;
    teamId: number | null;
    teamAbbrev: string;
    playerId: number | null;
    playerName: string;
    type: "shot-on-goal" | "missed-shot" | "blocked-shot" | "goal";
    mode: "shots" | "goals";
    period: GameDetailPeriodKey;
    periodNumber: number;
    timeInPeriod: string;
    shotType: string | null;
    strength: string | null;
    rinkX: number;
    rinkY: number;
    description: string;
};

export type HistoricalGameGoalEvent = {
    eventId: string;
    teamId: number | null;
    teamAbbrev: string;
    playerName: string;
    period: GameDetailPeriodKey;
    periodNumber: number;
    timeInPeriod: string;
    scoreAfter: string;
    strength: string | null;
    description: string;
};

export type HistoricalGameTeamStatsRow = {
    shotsOnGoal: number;
    shotAttempts: number;
    goals: number;
    hits: number;
    blockedShots: number;
    penaltyMinutes: number;
    powerPlayGoals: number;
};

export type HistoricalGameDetailResponse = {
    gameId: string;
    gameDate: string;
    startTimeUtc: string | null;
    venueName: string | null;
    decision: HistoricalDecision;
    homeTeam: HistoricalGameDetailTeam;
    awayTeam: HistoricalGameDetailTeam;
    playerStats: {
        home: {
            skaters: HistoricalGameSkaterRow[];
            forwards: HistoricalGameSkaterRow[];
            defencemen: HistoricalGameSkaterRow[];
            goalies: HistoricalGameGoalieRow[];
        };
        away: {
            skaters: HistoricalGameSkaterRow[];
            forwards: HistoricalGameSkaterRow[];
            defencemen: HistoricalGameSkaterRow[];
            goalies: HistoricalGameGoalieRow[];
        };
    };
    chartEvents: HistoricalGameShotEvent[];
    scoringEvents: HistoricalGameGoalEvent[];
    teamStats: Record<
        GameDetailPeriodKey,
        Record<string, HistoricalGameTeamStatsRow>
    >;
};