"use client";

import { useMemo, useState } from "react";
import CompareControls from "@/components/CompareControls";
import CompareResultsPanel from "@/components/CompareResultsPanel";
import {
    COMPARE_BY_OPTIONS,
    FILTER_BY_OPTIONS,
    NHL_TEAM_OPTIONS,
    type CompareFilter,
    type CompareMode,
} from "@/lib/compare";

export default function TeamComparisonShell() {
    const [team1, setTeam1] = useState("");
    const [team2, setTeam2] = useState("");
    const [compareBy, setCompareBy] = useState<CompareMode>("team");
    const [filterBy, setFilterBy] = useState<CompareFilter>("season");

    const selectedTeam1Label = useMemo(() => {
        return NHL_TEAM_OPTIONS.find((team) => team.value === team1)?.label ?? "";
    }, [team1]);

    const selectedTeam2Label = useMemo(() => {
        return NHL_TEAM_OPTIONS.find((team) => team.value === team2)?.label ?? "";
    }, [team2]);

    const canCompare = Boolean(team1 && team2 && team1 !== team2);

    function handleSwapTeams() {
        setTeam1(team2);
        setTeam2(team1);
    }

    function handleResetSelections() {
        setTeam1("");
        setTeam2("");
        setCompareBy("team");
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

                        <CompareControls
                            team1={team1}
                            team2={team2}
                            compareBy={compareBy}
                            filterBy={filterBy}
                            teamOptions={NHL_TEAM_OPTIONS}
                            compareOptions={COMPARE_BY_OPTIONS}
                            filterOptions={FILTER_BY_OPTIONS}
                            onTeam1Change={setTeam1}
                            onTeam2Change={setTeam2}
                            onCompareByChange={setCompareBy}
                            onFilterByChange={setFilterBy}
                            onSwapTeams={handleSwapTeams}
                            onResetSelections={handleResetSelections}
                        />
                    </div>

                    <div className="compareShellDivider" />

                    <div className="compareShellBottom">
                        <CompareResultsPanel
                            team1={team1}
                            team2={team2}
                            compareBy={compareBy}
                            filterBy={filterBy}
                            canCompare={canCompare}
                            selectedTeam1Label={selectedTeam1Label}
                            selectedTeam2Label={selectedTeam2Label}
                        />
                    </div>
                </div>
            </div>
        </section>
    );
}