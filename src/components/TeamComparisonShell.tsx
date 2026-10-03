"use client";

import { useMemo, useState } from "react";
import CompareControls from "@/components/CompareControls";
import NFLCompareResults from "@/components/compare/NFLCompareResults";
import { NFL_TEAM_OPTIONS } from "@/lib/nflTeams";
import CompareResultsPanel from "@/components/CompareResultsPanel";
import {
    COMPARE_BY_OPTIONS,
    FILTER_BY_OPTIONS,
    NHL_TEAM_OPTIONS,
    type CompareFilter,
    type CompareMode,
} from "@/lib/compare";

export default function TeamComparisonShell({ sport = "NHL" }: { sport?: "NHL" | "NFL" }) {
    const teamOptions = sport === "NFL" ? NFL_TEAM_OPTIONS : NHL_TEAM_OPTIONS;
    const [team1, setTeam1] = useState("");
    const [team2, setTeam2] = useState("");
    const [compareBy, setCompareBy] = useState<CompareMode>("team");
    const [nflCompareBy, setNFLCompareBy] = useState<"team" | "positions">("team");
    const [filterBy, setFilterBy] = useState<CompareFilter>("season");

    const selectedTeam1Label = useMemo(() => {
        return teamOptions.find((team) => team.value === team1)?.label ?? "";
    }, [team1, teamOptions]);

    const selectedTeam2Label = useMemo(() => {
        return teamOptions.find((team) => team.value === team2)?.label ?? "";
    }, [team2, teamOptions]);

    const canCompare = Boolean(team1 && team2 && team1 !== team2);

    function handleSwapTeams() {
        setTeam1(team2);
        setTeam2(team1);
    }

    function handleResetSelections() {
        setTeam1("");
        setTeam2("");
        setCompareBy("team");
        setNFLCompareBy("team");
        setFilterBy("season");
    }

    return (
        <section className="compareWorkspace">
            <div className="compareWorkspaceInner">
                <div className="compareShellCard">
                    <div className="compareShellTop">
                        <div className="compareShellHeader">
                            <h1 className="compareShellTitle">
                                Select teams to compare
                            </h1>
                        </div>

                        <CompareControls<CompareMode | "positions">
                            team1={team1}
                            team2={team2}
                            compareBy={sport === "NFL" ? nflCompareBy : compareBy}
                            filterBy={filterBy}
                            teamOptions={teamOptions}
                            compareOptions={sport === "NFL" ? [{ value: "team", label: "Team" }, { value: "positions", label: "Position" }] : COMPARE_BY_OPTIONS}
                            filterOptions={FILTER_BY_OPTIONS}
                            onTeam1Change={setTeam1}
                            onTeam2Change={setTeam2}
                            onCompareByChange={(value) => {
                                if (sport === "NFL" && (value === "team" || value === "positions")) setNFLCompareBy(value);
                                else if (value !== "positions") setCompareBy(value);
                            }}
                            onFilterByChange={setFilterBy}
                            onSwapTeams={handleSwapTeams}
                            onResetSelections={handleResetSelections}
                        />
                    </div>

                    <div className="compareShellDivider" />

                    <div className="compareShellBottom">
                        {sport === "NFL" ? <NFLCompareResults
                            team1={team1} team2={team2} filterBy={filterBy} canCompare={canCompare} mode={nflCompareBy}
                            selectedTeam1Label={selectedTeam1Label} selectedTeam2Label={selectedTeam2Label}
                        /> : <CompareResultsPanel
                            team1={team1}
                            team2={team2}
                            compareBy={compareBy}
                            filterBy={filterBy}
                            canCompare={canCompare}
                            selectedTeam1Label={selectedTeam1Label}
                            selectedTeam2Label={selectedTeam2Label}
                        />}
                    </div>
                </div>
            </div>
        </section>
    );
}