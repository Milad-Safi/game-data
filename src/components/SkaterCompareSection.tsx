"use client";

import CompareState from "@/components/compare/CompareState";
import StatRow from "@/components/StatRow";
import useSkaterCompare from "@/hooks/useSkaterCompare";
import { type CompareFilter, type CompareMode } from "@/lib/compare";
import { getTeamColor } from "@/lib/teamColours";

type LeaderValue = {
    playerId: number;
    name: string;
    value: number;
};

type SkaterCompareSectionProps = {
    team1: string;
    team2: string;
    compareBy: CompareMode;
    filterBy: CompareFilter;
};

function formatLeader(leader: LeaderValue | null | undefined) {
    if (!leader) return "—";

    const value = Number.isInteger(leader.value)
        ? leader.value.toString()
        : leader.value.toFixed(1);

    return `${leader.name} (${value})`;
}

export default function SkaterCompareSection({
    team1,
    team2,
    compareBy,
    filterBy,
}: SkaterCompareSectionProps) {
    const leftColor = getTeamColor(team1);
    const rightColor = getTeamColor(team2);

    const { leftData, rightData, loading, error } = useSkaterCompare(
        team1,
        team2,
        compareBy,
        filterBy
    );

    const rows =
        filterBy === "season"
            ? [
                  {
                      label: "Goals Leader",
                      left: leftData?.leaders.goals ?? null,
                      right: rightData?.leaders.goals ?? null,
                  },
                  {
                      label: "Assists Leader",
                      left: leftData?.leaders.assists ?? null,
                      right: rightData?.leaders.assists ?? null,
                  },
                  {
                      label: "Points Leader",
                      left: leftData?.leaders.points ?? null,
                      right: rightData?.leaders.points ?? null,
                  },
                  {
                      label: "SOG Leader",
                      left: leftData?.leaders.sog ?? null,
                      right: rightData?.leaders.sog ?? null,
                  },
              ]
            : [
                  {
                      label: "Leader in Goals",
                      left: leftData?.leaders.goals ?? null,
                      right: rightData?.leaders.goals ?? null,
                  },
                  {
                      label: "Leader in Assists",
                      left: leftData?.leaders.assists ?? null,
                      right: rightData?.leaders.assists ?? null,
                  },
                  {
                      label: "Leader in Points",
                      left: leftData?.leaders.points ?? null,
                      right: rightData?.leaders.points ?? null,
                  },
                  {
                      label: "Leader in SOG",
                      left: leftData?.leaders.sog ?? null,
                      right: rightData?.leaders.sog ?? null,
                  },
                  {
                      label: "Leader in Blocks",
                      left: leftData?.leaders.blocks ?? null,
                      right: rightData?.leaders.blocks ?? null,
                  },
                  {
                      label: "Leader in Hits",
                      left: leftData?.leaders.hits ?? null,
                      right: rightData?.leaders.hits ?? null,
                  },
              ];

    return (
        <div className="compareSectionBlock">
            {loading && (
                <CompareState
                    title="Loading skater leaders"
                    text={`Pulling real ${compareBy} leader data for both teams.`}
                />
            )}

            {!loading && error && (
                <CompareState
                    title="Skater compare unavailable"
                    text={error}
                    tone="warning"
                />
            )}

            {!loading && !error && (
                <div className="compareRows">
                    {(["forwards", "defenders"] as const).filter(group => compareBy === "skaters" || compareBy === group).map(group => {
                        const left = leftData?.shotsAllowed?.[group] ?? null;
                        const right = rightData?.shotsAllowed?.[group] ?? null;
                        return <StatRow key={group} label={`SOG allowed to ${group === "forwards" ? "forwards" : "defensemen"} / game`}
                            leftVal={right} rightVal={left} leftText={left == null ? "—" : left.toFixed(1)} rightText={right == null ? "—" : right.toFixed(1)}
                            leftColor={leftColor} rightColor={rightColor} />;
                    })}
                    {rows.map((row) => (
                        <StatRow
                            key={row.label}
                            label={row.label}
                            leftVal={row.left?.value ?? null}
                            rightVal={row.right?.value ?? null}
                            leftText={formatLeader(row.left)}
                            rightText={formatLeader(row.right)}
                            leftColor={leftColor}
                            rightColor={rightColor}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}