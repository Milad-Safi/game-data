"use client";


import { useEffect, useState } from "react";
import CompareState from "@/components/compare/CompareState";
import useGoalieCompare from "@/hooks/useGoalieCompare";
import useRosterHeadshots from "@/hooks/useRosterHeadshots";
import { type CompareFilter } from "@/lib/compare";
import {
    goalieGaaStrength,
    goalieSavePctStrength,
} from "@/lib/statsMath";
import { getTeamColor } from "@/lib/teamColours";

type GoalieCompareValue = {
    playerId: number;
    name: string;
    gp: number;
    wins: number;
    savePct: number | null;
    gaa: number | null;
    shutouts: number;
};

type GoalieCompareSectionProps = {
    team1: string;
    team2: string;
    filterBy: CompareFilter;
    selectedTeam1Label: string;
    selectedTeam2Label: string;
};


const GOALIE_ROWS = [
    { key: "gp", label: "Games Played" },
    { key: "wins", label: "Wins" },
    { key: "savePct", label: "SV%" },
    { key: "gaa", label: "GAA" },
    { key: "shutouts", label: "Shutouts" },
] as const;

type GoalieRowKey = (typeof GOALIE_ROWS)[number]["key"];

function getInitials(name: string) {
    const parts = name
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (parts.length === 0) return "G";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

    return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

function getGoalieRowText(
    goalie: GoalieCompareValue | null | undefined,
    key: GoalieRowKey
) {
    if (!goalie) return "—";

    if (key === "gp") return String(goalie.gp);
    if (key === "wins") return String(goalie.wins);
    if (key === "savePct") {
        return goalie.savePct != null ? goalie.savePct.toFixed(3) : "—";
    }
    if (key === "gaa") {
        return goalie.gaa != null ? goalie.gaa.toFixed(2) : "—";
    }

    return String(goalie.shutouts);
}

function getGoalieRowBarValue(
    goalie: GoalieCompareValue | null | undefined,
    key: GoalieRowKey
) {
    if (!goalie) return null;

    if (key === "gp") return goalie.gp;
    if (key === "wins") return goalie.wins;
    if (key === "savePct") return goalieSavePctStrength(goalie.savePct);
    if (key === "gaa") return goalieGaaStrength(goalie.gaa);

    return goalie.shutouts;
}

function GoalieHeadshot({
    src,
    alt,
    fallback,
}: {
    src: string | null;
    alt: string;
    fallback: string;
}) {
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        setFailed(false);
    }, [src]);

    return (
        <div className="compareGoaliePortraitShell">
            {src && !failed ? (
                <img
                    src={src}
                    alt={alt}
                    className="compareGoaliePortrait"
                    onError={() => setFailed(true)}
                />
            ) : (
                <span className="compareGoaliePortraitFallback">{fallback}</span>
            )}
        </div>
    );
}

function GoalieProfileCard({
    goalie,
    badge,
    color,
    align,
    headshot,
    fallbackName,
}: {
    goalie: GoalieCompareValue | null | undefined;
    badge: string;
    color: string;
    align: "left" | "right";
    headshot: string | null;
    fallbackName: string;
}) {
    const name = goalie?.name ?? fallbackName;
    const initials = getInitials(name);

    return (
        <div
            className={`compareGoalieProfileCard ${
                align === "right" ? "compareGoalieProfileCardRight" : ""
            }`}
            style={{ borderColor: color.replace(/,\s*[\d.]+\s*\)$/, ", 0.333333)") }}
        >
            <span className="compareGoalieProfileBadge">{badge}</span>

            <div className="compareGoalieProfileMain">
                <GoalieHeadshot
                    src={headshot}
                    alt={`${name} headshot`}
                    fallback={initials}
                />

                <div className="compareGoalieProfileText">
                    <h4 className="compareGoalieProfileName">{name}</h4>
                </div>
            </div>
        </div>
    );
}

function GoalieCompareRow({
    label,
    leftText,
    rightText,
    leftVal,
    rightVal,
    leftColor,
    rightColor,
}: {
    label: string;
    leftText: string;
    rightText: string;
    leftVal: number | null;
    rightVal: number | null;
    leftColor: string;
    rightColor: string;
}) {
    const l =
        typeof leftVal === "number" && Number.isFinite(leftVal) ? leftVal : null;
    const r =
        typeof rightVal === "number" && Number.isFinite(rightVal) ? rightVal : null;

    const lAbs = l != null ? Math.abs(l) : 0;
    const rAbs = r != null ? Math.abs(r) : 0;
    const total = lAbs + rAbs;

    const leftPct = total > 0 ? (lAbs / total) * 100 : 50;
    const rightPct = total > 0 ? (rAbs / total) * 100 : 50;
    return (
        <div className="goalieCompareRow">
            <div className="goalieCompareRowFillWrap">
                <div
                    className="goalieCompareRowFill goalieCompareRowFillLeft"
                    style={{
                        width: `${leftPct}%`,
                        background: leftColor,
                    }}
                />
                <div
                    className="goalieCompareRowFill goalieCompareRowFillRight"
                    style={{
                        width: `${rightPct}%`,
                        background: rightColor,
                    }}
                />
            </div>

            <div className="goalieCompareRowContent">
                <div className="goalieCompareRowValue goalieCompareRowValueLeft">
                    {leftText}
                </div>

                <div className="goalieCompareRowLabel">{label}</div>

                <div className="goalieCompareRowValue goalieCompareRowValueRight">
                    {rightText}
                </div>
            </div>
        </div>
    );
}

function GoalieHeadToHead({
    leftGoalie,
    rightGoalie,
    leftLabel,
    rightLabel,
    leftColor,
    rightColor,
    leftHeadshot,
    rightHeadshot,
}: {
    leftGoalie: GoalieCompareValue | null | undefined;
    rightGoalie: GoalieCompareValue | null | undefined;
    leftLabel: string;
    rightLabel: string;
    leftColor: string;
    rightColor: string;
    leftHeadshot: string | null;
    rightHeadshot: string | null;
}) {
    return (
        <div className="compareGoalieHeadToHead">
            <div className="compareGoalieHead">
                <GoalieProfileCard
                    goalie={leftGoalie}
                    badge="Team 1"
                    color={leftColor}
                    align="left"
                    headshot={leftHeadshot}
                    fallbackName={leftLabel}
                />

                <div className="compareGoalieHeadVs">VS</div>

                <GoalieProfileCard
                    goalie={rightGoalie}
                    badge="Team 2"
                    color={rightColor}
                    align="right"
                    headshot={rightHeadshot}
                    fallbackName={rightLabel}
                />
            </div>

            <div className="compareGoalieRows">
                {GOALIE_ROWS.map((row) => (
                    <GoalieCompareRow
                        key={`${leftLabel}-${rightLabel}-${row.key}`}
                        label={row.label}
                        leftText={getGoalieRowText(leftGoalie, row.key)}
                        rightText={getGoalieRowText(rightGoalie, row.key)}
                        leftVal={getGoalieRowBarValue(leftGoalie, row.key)}
                        rightVal={getGoalieRowBarValue(rightGoalie, row.key)}
                        leftColor={leftColor}
                        rightColor={rightColor}
                    />
                ))}
            </div>
        </div>
    );
}

export default function GoalieCompareSection({
    team1,
    team2,
    filterBy,
    selectedTeam1Label,
    selectedTeam2Label,
}: GoalieCompareSectionProps) {
    const leftColor = getTeamColor(team1);
    const rightColor = getTeamColor(team2);

    const { leftData, rightData, loading, error } = useGoalieCompare(
        team1,
        team2,
        filterBy
    );

    const { headshotById: leftHeadshots } = useRosterHeadshots(team1);
    const { headshotById: rightHeadshots } = useRosterHeadshots(team2);

    const leftStarterHeadshot =
        leftData?.starter?.playerId != null
            ? leftHeadshots.get(leftData.starter.playerId) ?? null
            : null;

    const rightStarterHeadshot =
        rightData?.starter?.playerId != null
            ? rightHeadshots.get(rightData.starter.playerId) ?? null
            : null;

    const leftAdditionalHeadshot =
        leftData?.additional?.playerId != null
            ? leftHeadshots.get(leftData.additional.playerId) ?? null
            : null;

    const rightAdditionalHeadshot =
        rightData?.additional?.playerId != null
            ? rightHeadshots.get(rightData.additional.playerId) ?? null
            : null;

    return (
        <div className="compareSectionBlock">
            {loading && (
                <CompareState
                    title="Loading goalie data"
                    text={`Pulling real goalie usage for ${selectedTeam1Label} and ${selectedTeam2Label}.`}
                />
            )}

            {!loading && error && (
                <CompareState
                    title="Goalie compare unavailable"
                    text={error}
                    tone="warning"
                />
            )}

            {!loading && !error && (
                <>
                    <div className="compareGoalieSectionHeader compareSectionHeader">
                        <h3 className="compareSectionTitle">Starting goalies</h3>
                    </div>

                    <GoalieHeadToHead
                        leftGoalie={leftData?.starter}
                        rightGoalie={rightData?.starter}
                        leftLabel={leftData?.starter?.name ?? `${selectedTeam1Label} starter`}
                        rightLabel={rightData?.starter?.name ?? `${selectedTeam2Label} starter`}
                        leftColor={leftColor}
                        rightColor={rightColor}
                        leftHeadshot={leftStarterHeadshot}
                        rightHeadshot={rightStarterHeadshot}
                    />

                    <div className="compareGoalieSectionHeader compareSectionHeader compareSectionHeaderSecondary">
                        <h3 className="compareSectionTitle">Other goalies</h3>
                    </div>

                    <GoalieHeadToHead
                        leftGoalie={leftData?.additional}
                        rightGoalie={rightData?.additional}
                        leftLabel={leftData?.additional?.name ?? "Additional goalie slot"}
                        rightLabel={rightData?.additional?.name ?? "Additional goalie slot"}
                        leftColor={leftColor}
                        rightColor={rightColor}
                        leftHeadshot={leftAdditionalHeadshot}
                        rightHeadshot={rightAdditionalHeadshot}
                    />
                </>
            )}
        </div>
    );
}
