"use client";

import CompareState from "@/components/compare/CompareState";
import StatRow from "@/components/StatRow";
import { getMatchupGroups } from "@/lib/compare";
import { matchupSavePctStrength } from "@/lib/statsMath";
import { getTeamColor } from "@/lib/teamColours";
import type { MatchupHistoryPayload, MatchupValueLeader } from "@/types/api";

type MatchupCompareSectionProps = {
    team1: string;
    team2: string;
    selectedTeam1Label: string;
    selectedTeam2Label: string;
    matchupHistoryData: MatchupHistoryPayload | null;
    matchupHistoryLoading: boolean;
    matchupHistoryError: string | null;
};

function formatRecord(
    record: { w: number; l: number; otl: number } | null | undefined
) {
    if (!record) return "—";
    return `${record.w}-${record.l}-${record.otl}`;
}

function formatNumber(value: number | null | undefined, digits = 2) {
    if (value == null) return "—";
    return value.toFixed(digits);
}

function formatLeader(
    leader: MatchupValueLeader | null | undefined,
    kind: "count" | "sv"
) {
    if (!leader) return "—";

    if (kind === "sv") {
        return `${leader.name} (${leader.value.toFixed(3)})`;
    }

    return `${leader.name} (${leader.value})`;
}

function leaderBarValue(
    leader: MatchupValueLeader | null | undefined,
    kind: "count" | "sv"
) {
    if (!leader) return null;

    if (kind === "sv") {
        return matchupSavePctStrength(leader.value);
    }

    return leader.value;
}

export default function MatchupCompareSection({
    team1,
    team2,
    selectedTeam1Label,
    selectedTeam2Label,
    matchupHistoryData,
    matchupHistoryLoading,
    matchupHistoryError,
}: MatchupCompareSectionProps) {
    const matchupGroups = getMatchupGroups();

    const leftColor = getTeamColor(team1);
    const rightColor = getTeamColor(team2);

    const data = matchupHistoryData;
    const loading = matchupHistoryLoading;
    const error = matchupHistoryError;

    const leftRecord = data?.records?.[team1] ?? null;
    const rightRecord = data?.records?.[team2] ?? null;

    const leftSog = data?.avgShotsOnGoal?.[team1] ?? null;
    const rightSog = data?.avgShotsOnGoal?.[team2] ?? null;

    const leftGf = data?.avgGoalsFor?.[team1] ?? null;
    const rightGf = data?.avgGoalsFor?.[team2] ?? null;

    const leftGa = data?.avgGoalsAgainst?.[team1] ?? null;
    const rightGa = data?.avgGoalsAgainst?.[team2] ?? null;

    const leftLeaders = data?.leaders?.[team1] ?? null;
    const rightLeaders = data?.leaders?.[team2] ?? null;

    const groupDataMap = {
        "Top 3 in points": { left: leftLeaders?.pointsLeaders ?? [], right: rightLeaders?.pointsLeaders ?? [], kind: "count" as const },
        "Top 3 in goals": {
            left: leftLeaders?.goalsLeaders ?? [],
            right: rightLeaders?.goalsLeaders ?? [],
            kind: "count" as const,
        },
        "Top 3 in assists": {
            left: leftLeaders?.assistLeaders ?? [],
            right: rightLeaders?.assistLeaders ?? [],
            kind: "count" as const,
        },
        "Top 3 in SOG": {
            left: leftLeaders?.sogLeaders ?? [],
            right: rightLeaders?.sogLeaders ?? [],
            kind: "count" as const,
        },
        "Top 2 in shot attempts": {
            left: leftLeaders?.shotAttemptLeaders ?? [],
            right: rightLeaders?.shotAttemptLeaders ?? [],
            kind: "count" as const,
        },
        "Top 2 in blocks": {
            left: leftLeaders?.blockLeaders ?? [],
            right: rightLeaders?.blockLeaders ?? [],
            kind: "count" as const,
        },
        "Top 2 in SV%": {
            left: leftLeaders?.savePctLeaders ?? [],
            right: rightLeaders?.savePctLeaders ?? [],
            kind: "sv" as const,
        },
    };

    return (
        <div className="compareSectionBlock">
            <div className="compareSectionHeader">
                <h3 className="compareSectionTitle">Matchup summary</h3>
            </div>

            {loading && (
                <CompareState
                    title="Loading matchup data"
                    text={`Pulling real head to head results for ${selectedTeam1Label} and ${selectedTeam2Label}.`}
                />
            )}

            {!loading && error && (
                <CompareState
                    title="Matchup data unavailable"
                    text={error}
                    tone="warning"
                />
            )}

            {!loading && !error && data && data.gamesFound === 0 && (
                <CompareState
                    title="No matchup data found"
                    text="No played regular season head to head games matched this filter."
                />
            )}

            {!loading && !error && data && data.gamesFound > 0 && (
                <>
                    <div className="compareRows">
                        <StatRow
                            label="Head to head record"
                            leftVal={leftRecord?.w ?? null}
                            rightVal={rightRecord?.w ?? null}
                            leftText={formatRecord(leftRecord)}
                            rightText={formatRecord(rightRecord)}
                            leftColor={leftColor}
                            rightColor={rightColor}
                        />

                        <StatRow
                            label="Goals For / Game"
                            leftVal={leftGf}
                            rightVal={rightGf}
                            leftText={formatNumber(leftGf)}
                            rightText={formatNumber(rightGf)}
                            leftColor={leftColor}
                            rightColor={rightColor}
                        />

                        <StatRow
                            label="Goals Against / Game"
                            leftVal={leftGa}
                            rightVal={rightGa}
                            leftText={formatNumber(leftGa)}
                            rightText={formatNumber(rightGa)}
                            leftColor={leftColor}
                            rightColor={rightColor}
                        />

                        <StatRow
                            label="Shots On Goal / Game"
                            leftVal={leftSog}
                            rightVal={rightSog}
                            leftText={formatNumber(leftSog)}
                            rightText={formatNumber(rightSog)}
                            leftColor={leftColor}
                            rightColor={rightColor}
                        />
                    </div>

                    {matchupGroups.map((group) => {
                        const groupData =
                            groupDataMap[group.title as keyof typeof groupDataMap];

                        return (
                            <div key={group.title} className="compareMatchupGroup">
                                <h3 className="compareSectionTitle">
                                    {group.title}
                                </h3>

                                <div className="compareRows">
                                    {group.rows.map((row, index) => {
                                        const leftLeader =
                                            groupData?.left?.[index] ?? null;
                                        const rightLeader =
                                            groupData?.right?.[index] ?? null;
                                        const kind = groupData?.kind ?? "count";

                                        return (
                                            <StatRow
                                                key={`${group.title}-${row}-${index}`}
                                                label={row}
                                                leftVal={leaderBarValue(
                                                    leftLeader,
                                                    kind
                                                )}
                                                rightVal={leaderBarValue(
                                                    rightLeader,
                                                    kind
                                                )}
                                                leftText={formatLeader(
                                                    leftLeader,
                                                    kind
                                                )}
                                                rightText={formatLeader(
                                                    rightLeader,
                                                    kind
                                                )}
                                                leftColor={leftColor}
                                                rightColor={rightColor}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </>
            )}
        </div>
    );
}