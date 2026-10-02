"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import HistoricalGameDetailBoxscorePanel from "@/components/games/BoxscorePanel";
import HistoricalGameDetailHero from "@/components/games/Hero";
import HistoricalGameDetailShotMapPanel from "@/components/games/ShotMapPanel";
import {
    buildDetailThemeStyle,
    compareSkaters,
    teamSideKey,
    type SkaterSortKey,
    type SortDirection,
} from "@/components/games/Shared";
import { fetchJson } from "@/lib/fetchJson";
import type {
    GameDetailChartMode,
    HistoricalGameDetailResponse,
    HistoricalGameShotEvent,
} from "@/types/games";

type HistoricalGameDetailClientProps = {
    gameId: string;
    focusTeamAbbrev?: string | null;
};

function chartEventMatchesMode(
    event: HistoricalGameShotEvent,
    chartMode: GameDetailChartMode
) {
    if (chartMode === "goals") {
        return event.type === "goal";
    }

    return (
        event.type === "shot-on-goal" ||
        event.type === "missed-shot" ||
        event.type === "blocked-shot" ||
        event.type === "goal"
    );
}

export default function HistoricalGameDetailClient({
    gameId,
    focusTeamAbbrev,
}: HistoricalGameDetailClientProps) {
    const [data, setData] = useState<HistoricalGameDetailResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [chartTeam, setChartTeam] = useState<string>(
        focusTeamAbbrev?.toUpperCase() ?? ""
    );
    const [chartMode, setChartMode] = useState<GameDetailChartMode>("shots");
    const [selectedPlayer, setSelectedPlayer] = useState<string>("ALL");

    const [boxscoreTeam, setBoxscoreTeam] = useState<string>(
        focusTeamAbbrev?.toUpperCase() ?? ""
    );

    const [skaterSortKey, setSkaterSortKey] = useState<SkaterSortKey>("points");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            setError(null);

            try {
                const payload = await fetchJson<HistoricalGameDetailResponse>(
                    `/api/games/${gameId}/detail`,
                    { cache: "no-store" }
                );

                if (cancelled) return;

                setData(payload);

                const defaultTeam =
                    focusTeamAbbrev?.toUpperCase() === payload.homeTeam.abbrev ||
                    focusTeamAbbrev?.toUpperCase() === payload.awayTeam.abbrev
                        ? focusTeamAbbrev?.toUpperCase() ?? payload.homeTeam.abbrev
                        : payload.homeTeam.abbrev;

                setChartTeam(defaultTeam);
                setBoxscoreTeam(defaultTeam);
            } catch (err) {
                if (cancelled) return;

                setError(
                    err instanceof Error ? err.message : "Could not load game detail"
                );
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        void load();

        return () => {
            cancelled = true;
        };
    }, [focusTeamAbbrev, gameId]);

    const teamOptions = useMemo(() => {
        if (!data) return [];

        return [
            { value: data.awayTeam.abbrev, label: data.awayTeam.label },
            { value: data.homeTeam.abbrev, label: data.homeTeam.label },
        ];
    }, [data]);

    const chartPlayers = useMemo(() => {
        if (!data) return [];

        const side = teamSideKey(data, chartTeam);
        const rows = data.playerStats[side].skaters;

        return rows.map((player) => ({
            value: String(player.playerId),
            label: player.name,
        }));
    }, [chartTeam, data]);

    const filteredChartEvents = useMemo(() => {
        if (!data) return [];

        return data.chartEvents.filter((event) => {
            if (event.teamAbbrev !== chartTeam) return false;
            if (!chartEventMatchesMode(event, chartMode)) return false;

            if (
                selectedPlayer !== "ALL" &&
                String(event.playerId ?? "") !== selectedPlayer
            ) {
                return false;
            }

            return true;
        });
    }, [chartMode, chartTeam, data, selectedPlayer]);

    const activeSkaterRows = useMemo(() => {
        if (!data) return [];

        const side = teamSideKey(data, boxscoreTeam);
        return data.playerStats[side].skaters;
    }, [boxscoreTeam, data]);

    const goalieRows = useMemo(() => {
        if (!data) return [];

        const side = teamSideKey(data, boxscoreTeam);

        return [...data.playerStats[side].goalies].sort((left, right) => {
            return (
                Number(right.starter) - Number(left.starter) ||
                right.toiSeconds - left.toiSeconds ||
                right.saves - left.saves ||
                left.name.localeCompare(right.name)
            );
        });
    }, [boxscoreTeam, data]);

    const sortedSkaterRows = useMemo(() => {
        return [...activeSkaterRows].sort((left, right) =>
            compareSkaters(left, right, skaterSortKey, sortDirection)
        );
    }, [activeSkaterRows, skaterSortKey, sortDirection]);

    const detailThemeStyle = useMemo(() => {
        if (!data) return undefined;
        return buildDetailThemeStyle(data);
    }, [data]);

    function handleSkaterSort(nextKey: SkaterSortKey) {
        if (nextKey === skaterSortKey) {
            setSortDirection((current) =>
                current === "desc" ? "asc" : "desc"
            );
            return;
        }

        setSkaterSortKey(nextKey);
        setSortDirection(nextKey === "name" ? "asc" : "desc");
    }

    function handleChartTeamChange(team: string) {
        setChartTeam(team);
        setSelectedPlayer("ALL");
    }

    if (loading) {
        return (
            <main className="historicalGameDetailPage">
                <section className="historicalGameDetailShell">
                    <Link href="/games" className="historicalGameDetailBackLink">
                        ← Back to Games
                    </Link>

                    <div
                        className="historicalGamesStateCard historicalGamesStateCardLoading historicalGameDetailLoadingCard"
                        role="status"
                    >
                        <div className="historicalGamesSpinner" aria-hidden="true" />
                        <h1 className="historicalGamesStateTitle">
                            Loading game detail
                        </h1>
                        <p className="historicalGamesStateText">
                            Pulling the box score and play-by-play for this game
                        </p>
                    </div>
                </section>
            </main>
        );
    }

    if (error || !data) {
        return (
            <main className="historicalGameDetailPage">
                <section className="historicalGameDetailShell">
                    <Link href="/games" className="historicalGameDetailBackLink">
                        ← Back to Games
                    </Link>

                    <div className="historicalGamesStateCard historicalGamesStateCardError historicalGameDetailLoadingCard">
                        <h1 className="historicalGamesStateTitle">
                            Could not load game detail
                        </h1>
                        <p className="historicalGamesStateText">
                            {error ?? "Unknown error"}
                        </p>
                    </div>
                </section>
            </main>
        );
    }

    return (
        <main className="historicalGameDetailPage">
            <section
                className="historicalGameDetailShell historicalGameDetailShellExpanded"
                style={detailThemeStyle}
            >
                <Link href="/games" className="historicalGameDetailBackLink">
                    ← Back to Games
                </Link>

                <HistoricalGameDetailHero data={data} />

                <section className="historicalGameDetailTopGrid">
                    <HistoricalGameDetailShotMapPanel
                        data={data}
                        chartTeam={chartTeam}
                        chartMode={chartMode}
                        selectedPlayer={selectedPlayer}
                        teamOptions={teamOptions}
                        chartPlayers={chartPlayers}
                        filteredChartEvents={filteredChartEvents}
                        onChartModeChange={setChartMode}
                        onChartTeamChange={handleChartTeamChange}
                        onSelectedPlayerChange={setSelectedPlayer}
                    />

                    <HistoricalGameDetailBoxscorePanel
                        data={data}
                        teamOptions={teamOptions}
                        boxscoreTeam={boxscoreTeam}
                        sortedSkaterRows={sortedSkaterRows}
                        goalieRows={goalieRows}
                        skaterSortKey={skaterSortKey}
                        sortDirection={sortDirection}
                        onBoxscoreTeamChange={setBoxscoreTeam}
                        onSkaterSort={handleSkaterSort}
                    />
                </section>
            </section>
        </main>
    );
}