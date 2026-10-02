import type { HistoricalGameDetailResponse } from "@/types/games";

import {
    formatDecisionLabel,
    formatGameDate,
    formatNumber,
    formatVenueLabel,
} from "@/components/games/Shared";

type HistoricalGameDetailHeroProps = {
    data: HistoricalGameDetailResponse;
};

export default function Hero({
    data,
}: HistoricalGameDetailHeroProps) {
    const awayGameStats = data.teamStats.ALL[data.awayTeam.abbrev];
    const homeGameStats = data.teamStats.ALL[data.homeTeam.abbrev];

    return (
        <section className="historicalGameDetailHero historicalGameDetailHeroMatchup">
            <p className="historicalGameHeroVenue">
                {data.venueName ?? formatVenueLabel(data)}
            </p>

            <div className="historicalGameHeroBoard">
                <div className="historicalGameHeroTeam historicalGameHeroTeamAway">
                    <div className="historicalGameHeroTeamInner">
                        <img
                            src={data.awayTeam.logoSrc}
                            alt={`${data.awayTeam.label} logo`}
                            className="historicalGameHeroLogo"
                        />

                        <div className="historicalGameHeroTeamCopy">
                            <p className="historicalGameHeroTeamLabel">Away</p>
                            <p className="historicalGameHeroTeamName">
                                {data.awayTeam.label}
                            </p>

                            <p className="historicalGameHeroMetaInline">
                                <span className="historicalGameHeroMetaInlineLabel">
                                    SOG:
                                </span>{" "}
                                <span className="historicalGameHeroMetaInlineValue">
                                    {formatNumber(awayGameStats.shotsOnGoal)}
                                </span>
                            </p>
                        </div>
                    </div>
                    <p className="historicalGameHeroScore historicalGameHeroTeamScore">{data.awayTeam.score}</p>
                </div>

                <div className="historicalGameHeroMiddle">
                    <p className="historicalGameHeroFinal">FINAL</p>

                    <div className="historicalGameHeroSubline">
                        <span>{data.awayTeam.abbrev}</span>
                        <span>@</span>
                        <span>{data.homeTeam.abbrev}</span>

                    </div>
                </div>

                <div className="historicalGameHeroTeam historicalGameHeroTeamHome">
                    <p className="historicalGameHeroScore historicalGameHeroTeamScore">{data.homeTeam.score}</p>
                    <div className="historicalGameHeroTeamInner historicalGameHeroTeamInnerHome">
                        <div className="historicalGameHeroTeamCopy historicalGameHeroTeamCopyHome">
                            <p className="historicalGameHeroTeamLabel">Home</p>
                            <p className="historicalGameHeroTeamName">
                                {data.homeTeam.label}
                            </p>

                            <p className="historicalGameHeroMetaInline historicalGameHeroMetaInlineHome">
                                <span className="historicalGameHeroMetaInlineLabel">
                                    SOG:
                                </span>{" "}
                                <span className="historicalGameHeroMetaInlineValue">
                                    {formatNumber(homeGameStats.shotsOnGoal)}
                                </span>
                            </p>
                        </div>

                        <img
                            src={data.homeTeam.logoSrc}
                            alt={`${data.homeTeam.label} logo`}
                            className="historicalGameHeroLogo"
                        />
                    </div>
                </div>
            </div>

            <p className="historicalGameDetailSubtitle historicalGameDetailSubtitleHero">
                {formatGameDate(data.gameDate)} · {formatDecisionLabel(data.decision)}
            </p>
        </section>
    );
}