"use client";

import { useMemo, useRef, useState } from "react";

import HistoricalGamesResults from "@/components/games/GamesResults";
import { useHistoricalGamesSearch } from "@/hooks/useHistoricalGamesSearch";
import { NHL_TEAM_OPTIONS } from "@/lib/compare";
import {
    HISTORICAL_GAMES_PAGE_SIZE,
} from "@/lib/games";
import type { HistoricalSeasonOption } from "@/types/games";

type SearchFilters = {
    team: string;
    season: HistoricalSeasonOption;
    opponent: string | null;
};

export default function HistoricalGamesShell({ seasonOptions }: { seasonOptions: HistoricalSeasonOption[] }) {
    const [filters, setFilters] = useState<SearchFilters>(() => ({
        team: "",
        season: seasonOptions[0],
        opponent: null,
    }));
    const [submittedFilters, setSubmittedFilters] = useState<SearchFilters | null>(null);
    const resultsRef = useRef<HTMLElement | null>(null);

    const { data, loading, error, search } = useHistoricalGamesSearch(
        HISTORICAL_GAMES_PAGE_SIZE
    );

    const opponentOptions = useMemo(() => {
        if (!filters.team) {
            return NHL_TEAM_OPTIONS;
        }

        return NHL_TEAM_OPTIONS.filter((team) => team.value !== filters.team);
    }, [filters.team]);

    async function runSearch(nextPage = 1, nextFilters?: SearchFilters) {
        const requestFilters = nextFilters ?? filters;

        if (!requestFilters.team) {
            return;
        }

        const payload = await search({
            ...requestFilters,
            page: nextPage,
        });

        if (!payload) {
            return;
        }

        setSubmittedFilters(requestFilters);

        window.setTimeout(() => {
            resultsRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
            });
        }, 80);
    }

    function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        void runSearch(1);
    }

    function handleTeamChange(team: string) {
        setFilters((current) => {
            const nextOpponent =
                !team || current.opponent === team ? null : current.opponent;

            return {
                ...current,
                team,
                opponent: nextOpponent,
            };
        });
    }

    function handlePageChange(nextPage: number) {
        const activeFilters = submittedFilters ?? filters;
        void runSearch(nextPage, activeFilters);
    }

    return (
        <section className="historicalGamesPageShell">
            <section className="historicalGamesIntro">
                <div>
                    <p className="historicalGamesEyebrow">Games</p>
                    <h1 className="historicalGamesTitle">Search for a completed game</h1>
                </div>

                <p className="historicalGamesIntroNote">
                    Regular season only
                </p>
            </section>

            <section className="historicalGamesFilterPanel">
                <p className="historicalGamesFilterHint">
                    Choose a team and season, then narrow it with an optional opponent
                </p>

                <form
                    className="historicalGamesFilterForm"
                    onSubmit={handleSearchSubmit}
                >
                    <div className="historicalGamesFilterGrid">
                        <label className="historicalGamesField">
                            <span className="historicalGamesFieldLabel">Choose a team</span>
                            <select
                                className="historicalGamesSelect"
                                value={filters.team}
                                onChange={(event) => handleTeamChange(event.target.value)}
                            >
                                <option value="">No selection</option>
                                {NHL_TEAM_OPTIONS.map((team) => (
                                    <option key={team.value} value={team.value}>
                                        {team.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="historicalGamesField">
                            <span className="historicalGamesFieldLabel">Choose a season</span>
                            <select
                                className="historicalGamesSelect"
                                value={filters.season}
                                onChange={(event) =>
                                    setFilters((current) => ({
                                        ...current,
                                        season: event.target.value as HistoricalSeasonOption,
                                    }))
                                }
                            >
                                {seasonOptions.map((season) => (
                                    <option key={season} value={season}>
                                        {season}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <div className="historicalGamesOptionalRow">
                        <p className="historicalGamesOptionalLabel">Optional filters</p>

                        <label className="historicalGamesField historicalGamesFieldOptional">
                            <span className="historicalGamesFieldLabel">Opponent</span>
                            <select
                                className="historicalGamesSelect"
                                value={filters.opponent ?? ""}
                                onChange={(event) =>
                                    setFilters((current) => ({
                                        ...current,
                                        opponent: event.target.value || null,
                                    }))
                                }
                                disabled={!filters.team}
                            >
                                <option value="">All opponents</option>
                                {opponentOptions.map((team) => (
                                    <option key={team.value} value={team.value}>
                                        {team.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <div className="historicalGamesActionRow">
                        <button
                            type="submit"
                            className="historicalGamesSearchButton"
                            disabled={loading || !filters.team}
                        >
                            {loading ? "Loading..." : "Search"}
                        </button>
                    </div>
                </form>
            </section>

            <section
                ref={resultsRef}
                className="historicalGamesResultsRegion"
                aria-live="polite"
            >
                {data ? (
                    <HistoricalGamesResults
                        data={data}
                        loading={loading}
                        error={error}
                        onPageChange={handlePageChange}
                    />
                ) : loading ? (
                    <div
                        className="historicalGamesStateCard historicalGamesStateCardLoading"
                        role="status"
                    >
                        <div className="historicalGamesSpinner" aria-hidden="true" />
                        <h2 className="historicalGamesStateTitle">Loading games</h2>
                        <p className="historicalGamesStateText">
                            Pulling the first page of results
                        </p>
                    </div>
                ) : error ? (
                    <div className="historicalGamesStateCard historicalGamesStateCardError">
                        <h2 className="historicalGamesStateTitle">Could not load games</h2>
                        <p className="historicalGamesStateText">{error}</p>
                    </div>
                ) : (
                    <div className="historicalGamesStateCard">
                        <h2 className="historicalGamesStateTitle">Choose a team to start</h2>
                        <p className="historicalGamesStateText">
                            Search a regular season and the 12-game pages will appear here
                        </p>
                    </div>
                )}
            </section>
        </section>
    );
}