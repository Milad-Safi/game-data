import Link from "next/link";

import type { HistoricalGameCard as HistoricalGameCardType } from "@/types/games";

function formatGameDate(date: string) {
    if (!date) {
        return "Date unavailable";
    }

    const directMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (directMatch) {
        const year = Number(directMatch[1]);
        const monthIndex = Number(directMatch[2]) - 1;
        const day = Number(directMatch[3]);
        const safeDate = new Date(Date.UTC(year, monthIndex, day, 12, 0, 0));

        if (!Number.isNaN(safeDate.getTime())) {
            return new Intl.DateTimeFormat("en-CA", {
                month: "short",
                day: "numeric",
                year: "numeric",
            }).format(safeDate);
        }
    }

    const parsed = new Date(date);

    if (!Number.isNaN(parsed.getTime())) {
        return new Intl.DateTimeFormat("en-CA", {
            month: "short",
            day: "numeric",
            year: "numeric",
        }).format(parsed);
    }

    return date;
}

function getDecisionLabel(decision: HistoricalGameCardType["decision"]) {
    if (decision === "ot") return "OT";
    if (decision === "so") return "SO";
    return decision === "reg" ? "REG" : "Unknown";
}

type HistoricalGameCardProps = {
    game: HistoricalGameCardType;
};

export default function HistoricalGameCard({
    game,
}: HistoricalGameCardProps) {
    const searchedTeamPaneClass = game.searchedTeamWon
        ? " historicalGameTeamPaneWinner"
        : "";
    const opponentPaneClass = game.searchedTeamWon === false
        ? " historicalGameTeamPaneWinner"
        : "";
    const resultClass = game.searchedTeamWon
        ? " historicalGameCardWin"
        : game.searchedTeamWon === false ? " historicalGameCardLoss" : "";
    const matchupText = `${game.searchedTeam.abbrev} ${
        game.venue === "away" ? "@" : "vs"
    } ${game.opponent.abbrev}`;
    const scorelineClass = game.searchedTeamWon
        ? " historicalGameScorelineWin"
        : "";

    return (
        <Link
            href={{
                pathname: `/games/${game.gameId}`,
                query: {
                    date: game.gameDate,
                    team: game.searchedTeam.abbrev,
                    teamLabel: game.searchedTeam.label,
                    teamScore: game.searchedTeam.score == null ? undefined : String(game.searchedTeam.score),
                    opponent: game.opponent.abbrev,
                    opponentLabel: game.opponent.label,
                    opponentScore: game.opponent.score == null ? undefined : String(game.opponent.score),
                    venue: game.venue,
                    decision: game.decision,
                    winner: game.searchedTeamWon === null ? undefined : game.searchedTeamWon ? "team" : "opponent",
                },
            }}
            className={`historicalGameCard${resultClass}`}
        >
            <div className="historicalGameCardTop">
                <p className="historicalGameDate">{formatGameDate(game.gameDate)}</p>

                <div className="historicalGameMetaRow">
                    <span className="historicalGameDecisionBadge">
                        {getDecisionLabel(game.decision)}
                    </span>
                </div>
            </div>

            <div className="historicalGameScoreRow">
                <div className={`historicalGameTeamPane${searchedTeamPaneClass}`}>
                    <span className="historicalGameLogoWrap">
                        <img
                            src={game.searchedTeam.logoSrc}
                            alt={`${game.searchedTeam.label} logo`}
                            className="historicalGameLogo"
                            loading="lazy"
                        />
                    </span>

                    <div className="historicalGameTeamText">
                        <p className="historicalGameTeamAbbrev">
                            {game.searchedTeam.abbrev}
                        </p>
                        <p className="historicalGameTeamName">
                            {game.searchedTeam.label}
                        </p>
                    </div>
                </div>

                <div className="historicalGameScorePanel">
                    <div className={`historicalGameScoreline${scorelineClass}`}>
                        <span className="historicalGameScoreValue">
                            {game.searchedTeam.score ?? "—"}
                        </span>

                        <span className="historicalGameScoreDash">-</span>

                        <span className="historicalGameScoreValue">
                            {game.opponent.score ?? "—"}
                        </span>
                    </div>

                    <p
                        className={`historicalGameMatchupNote${
                            game.searchedTeamWon
                                ? " historicalGameMatchupNoteWin"
                                : game.searchedTeamWon === false ? " historicalGameMatchupNoteLoss" : ""
                        }`}
                    >
                        {matchupText}
                    </p>
                </div>

                <div
                    className={`historicalGameTeamPane historicalGameTeamPaneRight${opponentPaneClass}`}
                >
                    <div className="historicalGameTeamText historicalGameTeamTextRight">
                        <p className="historicalGameTeamAbbrev">
                            {game.opponent.abbrev}
                        </p>
                        <p className="historicalGameTeamName">
                            {game.opponent.label}
                        </p>
                    </div>

                    <span className="historicalGameLogoWrap">
                        <img
                            src={game.opponent.logoSrc}
                            alt={`${game.opponent.label} logo`}
                            className="historicalGameLogo"
                            loading="lazy"
                        />
                    </span>
                </div>
            </div>
        </Link>
    );
}
