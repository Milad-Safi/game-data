// api.ts
// Shared data type descriptions

// Used in components so they know what fields exist
// Used in hooks when data is fetched

// Home/Away record splits
export type RecordSplit = { w: number; l: number };

// Current season summary for a team
export type TeamSummary = {
  teamAbbrev: string;
  teamFullName: string | null;
  gamesPlayed: number | null;

  goalsForPerGame: number | null;
  goalsAgainstPerGame: number | null;

  powerPlayPct: number | null;
  penaltyKillPct: number | null;

  shotsForPerGame: number | null;
  shotsAgainstPerGame: number | null;

  wins: number | null;
  losses: number | null;
  otLosses: number | null;
  points: number | null;

  leagueSequence: number | null;
  streakCode: string | null;
  streakCount: number | null;

  homeRecord: RecordSplit;
  awayRecord: RecordSplit;
};

// Helper type for ranks, stores ranks and team abbreviation
type RanksForMetric = Record<string, number | null>;

// Rank payload for the matchup comparison
export type TeamRanks = {
  seasonId: number;
  teamsCount: number;
  teamA: string;
  teamB: string;
  ranks: {
    goalsForPerGame: RanksForMetric;
    goalsAgainstPerGame: RanksForMetric;
    powerPlayPct: RanksForMetric;
    penaltyKillPct: RanksForMetric;
    shotsForPerGame: RanksForMetric;
    shotsAgainstPerGame: RanksForMetric;
  };
};

export type TeamSplit = {
  team: string;
  games: number;
  window: number | null;
  venue?: "home" | "away" | null;
  record: { w: number; l: number; otl: number };

  goalsFor: number;
  goalsAgainst: number;

  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  shotsForPerGame: number;
  shotsAgainstPerGame: number;
  powerPlay: { goals: number; opps: number; pct: number | null };
  penaltyKill: { oppPPGoals: number; oppPPOpps: number; pct: number | null };
  gameIds: number[];
  skippedPPGames?: number[];
};

// Machine learning trend endpoint response, next n games
export type TeamTrendResponse = {
  team: string;
  as_of: string;
  n_requested: number;
  n_used: number;
  range: {
    newest: string;
    oldest: string;
  } | null;
  trend: "UP" | "FLAT" | "DOWN" | null;
  confidence: number | null;
  probs: {
    DOWN: number;
    FLAT: number;
    UP: number;
  } | null;
  note?: string;
  model_info?: { n?: number; k?: number; eps?: number; trained_at?: string };
};

export type HistoryLeader = {
  playerId: number;
  name: string;
  goals: number;
  points: number;
  sog: number;
};

export type MatchupRecord = {
  w: number;
  l: number;
  otl: number;
};

export type MatchupSeasonGames = {
  season: number;
  gameIds: number[];
};

export type MatchupValueLeader = {
  playerId: number;
  name: string;
  value: number;
};

export type MatchupHistoryPayload = {
  team: string;
  opp: string;
  filterBy: string;
  seasons: number[];
  perSeason: MatchupSeasonGames[];
  perSeasonPlayed: MatchupSeasonGames[];
  gamesFound: number;
  lastPlayedDate: string | null;

  records: Record<string, MatchupRecord>;
  avgGoalsFor: Record<string, number | null>;
  avgGoalsAgainst: Record<string, number | null>;
  avgShotsOnGoal: Record<string, number | null>;

  leaders: Record<
    string,
    {
      topGoals: HistoryLeader | null;
      topPoints: HistoryLeader | null;
      topSog: HistoryLeader | null;
      goalsLeaders: MatchupValueLeader[];
      assistLeaders: MatchupValueLeader[];
      sogLeaders: MatchupValueLeader[];
      shotAttemptLeaders: MatchupValueLeader[];
      blockLeaders: MatchupValueLeader[];
      savePctLeaders: MatchupValueLeader[];
    }
  >;
};

export type SimulatedTeam = {
    team: string;
    conference: string;
    division: string;
    current_points: number;
    mean_projected_final_points: number;
    median_projected_final_points: number;
    p10_projected_final_points: number;
    p90_projected_final_points: number;
    make_playoffs_probability: number;
    miss_playoffs_probability: number;
    division_winner_probability: number;
    top_3_division_probability: number;
    wildcard_probability: number;
    current_effective_elo: number;
    current_turnover_adjustment?: number;
    roster_score?: number;
};

export type SeasonSimulationResponse = {
    teams: SimulatedTeam[];
    metadata: {
        season_id: number;
        simulations: number;
        remaining_games: number;
        standings_snapshot_time_utc?: string | null;
        standings_fetched_at?: string;
    };
};
