const glossaryItems = [
    // NFL position abbreviations used in comparison.
    { term: "QB", description: "Quarterback. NFL positional rows combine all players at that position per team game." },
    { term: "WR", description: "Wide receiver." },
    { term: "TE", description: "Tight end." },
    { term: "RB / FB", description: "Running back / fullback. NFL comparison includes fullbacks in RB totals." },
    { term: "TD", description: "Touchdown. Red-zone TD % counts offensive touchdowns per possession with a recorded down inside the opponent’s 20, including kneel-down possessions; this can differ from official box-score totals." },
    // Site terms and stat labels
    {
        term: "5v3 PP%",
        description:
            "Power-play percentage when a team has a two-skater advantage, meaning five skaters versus three",
    },
    {
        term: "5v3 PPO",
        description:
            "The number of five-on-three power-play opportunities a team has received",
    },
    {
        term: "5v4 PP%",
        description:
            "Power-play percentage when a team has a one-skater advantage, meaning five skaters versus four",
    },
    {
        term: "5v4 PPO",
        description:
            "The number of five-on-four power-play opportunities a team has received",
    },
    {
        term: "A",
        description:
            "Assists, or the passes credited before a goal is scored",
    },
    {
        term: "B",
        description:
            "Blocks, meaning shots blocked by a skater in the boxscore",
    },
    {
        term: "Blocked shots",
        description:
            "Shots stopped by defenders before they reach the net",
    },
    {
        term: "Boxscore",
        description:
            "The game summary table showing player and team stats from a single game",
    },
    {
        term: "Confidence",
        description:
            "The strength of the model’s belief in its current trend call",
    },
    {
        term: "Defencemen",
        description:
            "Blue-line skaters, separated from forwards in the game detail filters",
    },
    {
        term: "Forwards",
        description:
            "Attack-focused skaters, separated from defencemen and goalies in the game detail view",
    },
    {
        term: "G",
        description:
            "Goals scored by a player in the boxscore",
    },
    {
        term: "GA",
        description:
            "Goals against, usually shown for a goalie as the number of goals allowed",
    },
    {
        term: "GA / G",
        description:
            "Goals against per game, or how many goals a team allows on average each game",
    },
    {
        term: "GAA",
        description:
            "Goals against average for a goalie, which estimates how many goals they allow per full game",
    },
    {
        term: "GF / G",
        description:
            "Goals for per game, or how many goals a team scores on average each game",
    },
    {
        term: "Goal Differential",
        description:
            "Goals scored minus goals allowed over the selected sample",
    },
    {
        term: "Goalies",
        description:
            "Players listed in net, shown separately from skaters in compare and game detail views",
    },
    {
        term: "H",
        description:
            "Hits credited to a skater in the boxscore",
    },
    {
        term: "Head-to-Head",
        description:
            "Direct results and comparisons between two specific teams",
    },
    {
        term: "Hits",
        description:
            "Body checks credited to a player or team",
    },
    {
        term: "Improvement / Stagnation / Regression",
        description:
            "The three possible trend outcomes used by the model, meaning up, flat, or down",
    },
    {
        term: "Last 5",
        description:
            "A rolling sample built from a team’s five most recent games",
    },
    {
        term: "League Average",
        description:
            "The average value across all NHL teams for the selected metric",
    },
    {
        term: "OT",
        description:
            "Overtime, used for overtime periods, results, or streak labels",
    },
    {
        term: "OTL",
        description:
            "Overtime or shootout losses in a team record line",
    },
    {
        term: "P",
        description:
            "Points for a skater, calculated as goals plus assists",
    },
    {
        term: "P1 / P2 / P3",
        description:
            "Period 1, Period 2, and Period 3 filters on the game detail page",
    },
    {
        term: "PIM",
        description:
            "Penalty minutes taken by a player or team",
    },
    {
        term: "PK",
        description:
            "Penalty kill, which is when a team is defending while shorthanded",
    },
    {
        term: "PK%",
        description:
            "Penalty-kill percentage, or how often a team prevents a power-play goal while shorthanded",
    },
    {
        term: "PK Net%",
        description:
            "An NHL special-teams penalty-kill metric from the stats feed that reflects overall shorthanded effectiveness beyond the basic kill rate",
    },
    {
        term: "PK Opps",
        description:
            "Penalty-kill opportunities, meaning the number of times a team has been shorthanded",
    },
    {
        term: "PP",
        description:
            "Power play, which is when a team has a man advantage because the opponent took a penalty",
    },
    {
        term: "PP%",
        description:
            "Power-play percentage, or how often a team scores on its power-play chances",
    },
    {
        term: "PP Goals",
        description:
            "Goals scored while on the power play",
    },
    {
        term: "PPGA / G",
        description:
            "Power-play goals against per game, or how many goals a team allows while shorthanded on average each game",
    },
    {
        term: "PPO",
        description:
            "Power-play opportunities, meaning the number of man-advantage chances a team has received",
    },
    {
        term: "PTS",
        description:
            "Standings points earned by a team in the NHL standings",
    },
    {
        term: "PTS%",
        description:
            "Points percentage, or the share of available standings points a team has earned",
    },
    {
        term: "Record",
        description:
            "A team’s win-loss-overtime loss line over the selected sample",
    },
    {
        term: "S",
        description:
            "Shots on goal by a skater in the boxscore",
    },
    {
        term: "SA",
        description:
            "Shots against, usually shown for a goalie as the number of shots they faced",
    },
    {
        term: "SA / G",
        description:
            "Shots against per game, or how many shots on goal a team allows on average each game",
    },
    {
        term: "Scatter Plot",
        description:
            "A chart that places every team using one metric on the X axis and another on the Y axis",
    },
    {
        term: "SF / G",
        description:
            "Shots for per game, or how many shots on goal a team generates on average each game",
    },
    {
        term: "Shot Attempts",
        description:
            "All attempts directed toward the net, including shots on goal, missed shots, and blocked shots",
    },
    {
        term: "Shot Differential",
        description:
            "Shots on goal for minus shots on goal against over the selected sample",
    },
    {
        term: "Shot Share",
        description:
            "The percentage of total shots on goal that belong to one team in a matchup or selected sample",
    },
    {
        term: "Shutouts",
        description:
            "Games in which a goalie allows zero goals",
    },
    {
        term: "Skaters",
        description:
            "All non-goalie players grouped together in the game detail and compare views",
    },
    {
        term: "SO",
        description:
            "Shootout, used when a game is decided after overtime",
    },
    {
        term: "SOG",
        description:
            "Shots on goal",
    },
    {
        term: "SOG Heat Map",
        description:
            "A zone map showing where a team’s shots on goal are coming from in the offensive zone",
    },
    {
        term: "Starter",
        description:
            "The goalie identified as the starting netminder for that game or compare card",
    },
    {
        term: "Streak",
        description:
            "A team’s current run of wins or losses, such as W3 or L2",
    },
    {
        term: "SV",
        description:
            "Saves made by a goalie",
    },
    {
        term: "SV%",
        description:
            "Save percentage, or the share of shots on goal stopped by a goalie",
    },
    {
        term: "TOI",
        description:
            "Time on ice",
    },
    {
        term: "W / L / OTL",
        description:
            "Wins, losses, and overtime or shootout losses in a team record",
    },
];

export default function GlossaryPage() {
    return (
        <main className="glossaryPage">
            <section className="glossarySection">
                <div className="glossaryHeader">
                    <p className="glossaryEyebrow">Glossary</p>

                    <h1 className="glossaryTitle">Site stat definitions</h1>

                    <p className="glossaryIntro">
                        A complete reference for the stat labels, abbreviations,
                        tracking terms, and model language used across this site.
                    </p>
                </div>

                <div className="glossaryList">
                    {glossaryItems.map((item) => (
                        <div key={item.term} className="glossaryItem">
                            <span className="glossaryTerm">{item.term}:</span>{" "}
                            <span className="glossaryDescription">
                                {item.description}
                            </span>
                        </div>
                    ))}
                </div>
            </section>
        </main>
    );
}
