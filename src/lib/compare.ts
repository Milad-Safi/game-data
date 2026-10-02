export type CompareMode =
    | "team"
    | "matchup"
    | "skaters"
    | "forwards"
    | "defenders"
    | "goalies";

export type CompareFilter =
    | "season"
    | "last1"
    | "last2"
    | "last3"
    | "last4"
    | "last5"
    | "last10";

export type CompareOption<T extends string> = {
    value: T;
    label: string;
};

export type TeamOption = {
    value: string;
    label: string;
};

export type MatchupGroup = {
    title: string;
    rows: string[];
};

export const NHL_TEAM_OPTIONS: TeamOption[] = [
    { value: "ANA", label: "Anaheim Ducks" },
    { value: "BOS", label: "Boston Bruins" },
    { value: "BUF", label: "Buffalo Sabres" },
    { value: "CAR", label: "Carolina Hurricanes" },
    { value: "CBJ", label: "Columbus Blue Jackets" },
    { value: "CGY", label: "Calgary Flames" },
    { value: "CHI", label: "Chicago Blackhawks" },
    { value: "COL", label: "Colorado Avalanche" },
    { value: "DAL", label: "Dallas Stars" },
    { value: "DET", label: "Detroit Red Wings" },
    { value: "EDM", label: "Edmonton Oilers" },
    { value: "FLA", label: "Florida Panthers" },
    { value: "LAK", label: "Los Angeles Kings" },
    { value: "MIN", label: "Minnesota Wild" },
    { value: "MTL", label: "Montréal Canadiens" },
    { value: "NJD", label: "New Jersey Devils" },
    { value: "NSH", label: "Nashville Predators" },
    { value: "NYI", label: "New York Islanders" },
    { value: "NYR", label: "New York Rangers" },
    { value: "OTT", label: "Ottawa Senators" },
    { value: "PHI", label: "Philadelphia Flyers" },
    { value: "PIT", label: "Pittsburgh Penguins" },
    { value: "SEA", label: "Seattle Kraken" },
    { value: "SJS", label: "San Jose Sharks" },
    { value: "STL", label: "St. Louis Blues" },
    { value: "TBL", label: "Tampa Bay Lightning" },
    { value: "TOR", label: "Toronto Maple Leafs" },
    { value: "UTA", label: "Utah Mammoth" },
    { value: "VAN", label: "Vancouver Canucks" },
    { value: "VGK", label: "Vegas Golden Knights" },
    { value: "WPG", label: "Winnipeg Jets" },
    { value: "WSH", label: "Washington Capitals" },
];

export const COMPARE_BY_OPTIONS: CompareOption<CompareMode>[] = [
    { value: "team", label: "Team" },
    { value: "matchup", label: "Matchup" },
    { value: "skaters", label: "Skaters" },
    { value: "forwards", label: "Forwards" },
    { value: "defenders", label: "Defenders" },
    { value: "goalies", label: "Goalies" },
];

export const FILTER_BY_OPTIONS: CompareOption<CompareFilter>[] = [
    { value: "season", label: "Entire season" },
    { value: "last1", label: "Last 1 game" },
    { value: "last2", label: "Last 2 games" },
    { value: "last3", label: "Last 3 games" },
    { value: "last4", label: "Last 4 games" },
    { value: "last5", label: "Last 5 games" },
    { value: "last10", label: "Last 10 games" },
];

export const compareModeLabelMap: Record<CompareMode, string> = {
    team: "Team",
    matchup: "Matchup",
    skaters: "Skaters",
    forwards: "Forwards",
    defenders: "Defenders",
    goalies: "Goalies",
};

export const filterLabelMap: Record<CompareFilter, string> = {
    season: "Entire season",
    last1: "Last 1 game",
    last2: "Last 2 games",
    last3: "Last 3 games",
    last4: "Last 4 games",
    last5: "Last 5 games",
    last10: "Last 10 games",
};

const matchupGroups: MatchupGroup[] = [
    {
        title: "Top 3 in goals",
        rows: ["Leader 1", "Leader 2", "Leader 3"],
    },
    {
        title: "Top 3 in assists",
        rows: ["Leader 1", "Leader 2", "Leader 3"],
    },
    {
        title: "Top 3 in SOG",
        rows: ["Leader 1", "Leader 2", "Leader 3"],
    },
    {
        title: "Top 2 in shot attempts",
        rows: ["Leader 1", "Leader 2"],
    },
    {
        title: "Top 2 in blocks",
        rows: ["Leader 1", "Leader 2"],
    },
    {
        title: "Top 2 in SV%",
        rows: ["Leader 1", "Leader 2"],
    },
];

export function getMatchupGroups(): MatchupGroup[] {
    return matchupGroups;
}