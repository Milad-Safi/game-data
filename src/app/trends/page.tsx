"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TeamTrend from "@/components/edge/TeamTrend";
import { useTeamTrend } from "@/hooks/useTeamTrend";
import { NHL_TEAM_OPTIONS } from "@/lib/compare";
import { getTeamLogoSrc } from "@/lib/teamAssets";

const LOADING_MESSAGES = [
    "Waking up the Render worker",
    "Crunching the last few games",
    "Still cooking the model output",
];

export default function TrendsPage() {
    const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
    const [requestKey, setRequestKey] = useState(0);
    const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

    const resultsRef = useRef<HTMLElement | null>(null);

    const { data, loading, error } = useTeamTrend(selectedTeam, requestKey);

    const selectedTeamOption = useMemo(() => {
        return NHL_TEAM_OPTIONS.find((team) => team.value === selectedTeam) ?? null;
    }, [selectedTeam]);

    const selectedTeamLabel = selectedTeamOption?.label ?? "Select a team";
    const selectedTeamLogoSrc = selectedTeamOption
        ? getTeamLogoSrc(selectedTeamOption.label, selectedTeamOption.value)
        : "";

    useEffect(() => {
        if (!loading) {
            setLoadingMessageIndex(0);
            return;
        }

        const timer = window.setInterval(() => {
            setLoadingMessageIndex((current) => {
                return (current + 1) % LOADING_MESSAGES.length;
            });
        }, 4200);

        return () => window.clearInterval(timer);
    }, [loading]);

    useEffect(() => {
        if (!selectedTeam) {
            return;
        }

        const timer = window.setTimeout(() => {
            resultsRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
            });
        }, 120);

        return () => window.clearTimeout(timer);
    }, [selectedTeam, requestKey]);

    function handleTeamSelect(teamAbbrev: string) {
        setSelectedTeam(teamAbbrev);
        setRequestKey((current) => current + 1);
        setLoadingMessageIndex(0);
    }

    function handleRetry() {
        if (!selectedTeam) {
            return;
        }

        setRequestKey((current) => current + 1);
        setLoadingMessageIndex(0);
    }

    return (
        <main className="trendsPage">
            <section className="trendsWorkspace">
                <section className="trendsSelectionCard">
                    <div className="trendsSelectionHeader">
                        <h1 className="trendsSelectionTitle" style={{ textAlign: "center" }}>Select a Team</h1>
                    </div>

                    <div className="trendsLogoGrid">
                        {NHL_TEAM_OPTIONS.map((team) => {
                            const logoSrc = getTeamLogoSrc(team.label, team.value);
                            const isSelected = selectedTeam === team.value;

                            return (
                                <button
                                    key={team.value}
                                    type="button"
                                    className={`trendsLogoButton${
                                        isSelected ? " trendsLogoButtonSelected" : ""
                                    }`}
                                    aria-pressed={isSelected}
                                    onClick={() => handleTeamSelect(team.value)}
                                >
                                    <span className="trendsLogoMark">
                                        <img
                                            src={logoSrc}
                                            alt={`${team.label} logo`}
                                            className="trendsLogoImage"
                                            loading="lazy"
                                        />
                                    </span>

                                    <span className="trendsLogoName">{team.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </section>

                <section
                    ref={resultsRef}
                    className="trendsResultsRegion"
                    aria-live="polite"
                >
                    {!selectedTeam ? (
                        <div className="trendsStateCard">
                            <h2 className="trendsStateTitle">Select a team to begin</h2>
                            <p className="trendsStateText">
                                Once you click a logo, we will load the live model
                                output and graph the belief split across all three
                                trend outcomes.
                            </p>
                        </div>
                    ) : loading ? (
                        <div className="trendsStateCard trendsStateCardLoading" role="status">
                            <div className="trendsStateTop">
                                {selectedTeamLogoSrc ? (
                                    <img
                                        src={selectedTeamLogoSrc}
                                        alt={`${selectedTeamLabel} logo`}
                                        className="trendsStateLogo"
                                    />
                                ) : null}

                                <div>
                                    <p className="trendsSectionEyebrow">Loading model</p>
                                    <h2 className="trendsStateTitle">{selectedTeamLabel}</h2>
                                </div>
                            </div>

                            <div className="trendsStateSpinnerWrap">
                                <div className="trendsStateSpinner" aria-hidden="true" />
                            </div>

                            <p className="trendsStateText">
                                {LOADING_MESSAGES[loadingMessageIndex]}
                            </p>

                            <p className="trendsStateNote">
                                Free-tier cold starts can take a few seconds
                            </p>
                        </div>
                    ) : error ? (
                        <div className="trendsStateCard trendsStateCardError">
                            <div className="trendsStateTop">
                                {selectedTeamLogoSrc ? (
                                    <img
                                        src={selectedTeamLogoSrc}
                                        alt={`${selectedTeamLabel} logo`}
                                        className="trendsStateLogo"
                                    />
                                ) : null}

                                <div>
                                    <p className="trendsSectionEyebrow">Model issue</p>
                                    <h2 className="trendsStateTitle">
                                        Could not load {selectedTeamLabel}
                                    </h2>
                                </div>
                            </div>

                            <p className="trendsStateText">{error}</p>

                            <button
                                type="button"
                                className="trendsRetryButton"
                                onClick={handleRetry}
                            >
                                Try again
                            </button>
                        </div>
                    ) : data ? (
                        <TeamTrend
                            data={data}
                            teamLabel={selectedTeamLabel}
                            teamLogoSrc={selectedTeamLogoSrc}
                        />
                    ) : (
                        <div className="trendsStateCard">
                            <h2 className="trendsStateTitle">No trend data returned</h2>
                            <p className="trendsStateText">
                                The request finished, but the API did not return a usable
                                trend payload for this team.
                            </p>
                        </div>
                    )}
                </section>
            </section>
        </main>
    );
}