"use client";

import { useEffect, useState } from "react";
import CompareState from "./CompareState";
import TeamHeroCard from "./TeamHeroCard";
import StatRow from "@/components/StatRow";
import { type CompareFilter } from "@/lib/compare";
import { getNFLLogo, getNFLMatchupColors } from "@/lib/nflAssets";
import { SECTIONS, type CompareResponse } from "@/lib/nfl/summary";

// Visual emphasis only; the underlying metrics and displayed numbers stay unchanged.
const BAR_SENSITIVITY = { volume: 1.20, percentage: 1.08, turnovers: 1.03 } as const;

type Props = { team1: string; team2: string; selectedTeam1Label: string; selectedTeam2Label: string; canCompare: boolean; filterBy: CompareFilter; mode: "team" | "positions" };
export default function NFLCompareResults({ team1, team2, selectedTeam1Label, selectedTeam2Label, canCompare, filterBy, mode }: Props) {
    const [attempt, setAttempt] = useState(0);
    const [result, setResult] = useState<{ key: string; data?: CompareResponse; error?: string } | null>(null);
    const requestKey = `${team1}:${team2}:${filterBy}:${attempt}`;
    useEffect(() => {
        if (!canCompare) return;
        const controller = new AbortController();
        fetch(`/api/nfl/compare?${new URLSearchParams({ team1, team2, range: filterBy })}`, { signal: controller.signal })
            .then(async response => { if (!response.ok) throw new Error("NFL stats could not be loaded."); return await response.json() as CompareResponse; })
            .then(data => setResult({ key: requestKey, data }))
            .catch(error => { if (!controller.signal.aborted) setResult({ key: requestKey, error: error.message }); });
        return () => controller.abort();
    }, [canCompare, team1, team2, filterBy, requestKey]);
    const data = result?.key === requestKey ? result.data : undefined;
    const error = result?.key === requestKey ? result.error : undefined;
    const [leftColor, rightColor] = getNFLMatchupColors(team1, team2);
    const hidden = new Set(["penalties", "penaltyYards", "firstDowns", "firstDownsAllowed", "qbPass", "qbPassAllowed"]);
    const sections = (mode === "positions" ? SECTIONS.slice(2) : SECTIONS.slice(0, 2))
        .map(section => ({ ...section, rows: section.rows.filter(row => !hidden.has(row.key)) }));
    const duplicate = Boolean(team1 && team1 === team2);
    return <section className="compareResultsPanel">
        <div className="compareResultsPanelHeader">
            <div><p className="compareResultsEyebrow">NFL · Regular season</p><h2 className="compareResultsTitle">{mode === "positions" ? "Position comparison" : "Team comparison"}</h2></div>
        </div>
        {!team1 && !team2 && <CompareState title="Select two teams" text="Compare season averages, conversion rates and production by position." />}
        {(team1 || team2) && !canCompare && !duplicate && <CompareState title="One more team needed" text="Choose the second team to compare." />}
        {duplicate && <CompareState title="Choose two different teams" text={`${selectedTeam1Label} is selected on both sides right now.`} tone="warning" />}
        {canCompare && !data && !error && <p className="compareEmptyText" role="status">Loading NFL comparison…</p>}
        {canCompare && error && <div role="alert"><CompareState title="Stats unavailable" text={error} tone="warning" /><button type="button" className="compareResultsBadge" onClick={() => setAttempt(n => n + 1)}>Retry</button></div>}
        {canCompare && data && <div className="compareBuiltView">
            <div className="compareHeroWrap">
                <TeamHeroCard teamAbbrev={team1} teamLabel={selectedTeam1Label} align="left" logoSrc={getNFLLogo(team1)} accentColor={leftColor} />
                <div className="compareHeroVsWrap"><span className="compareHeroVs">VS</span></div>
                <TeamHeroCard teamAbbrev={team2} teamLabel={selectedTeam2Label} align="right" logoSrc={getNFLLogo(team2)} accentColor={rightColor} />
            </div>
            {mode === "team" && <div className="compareRows">
                <StatRow label="Record (W–L–T)" leftVal={null} rightVal={null} leftText={`${data.left.wins}–${data.left.losses}–${data.left.ties}`} rightText={`${data.right.wins}–${data.right.losses}–${data.right.ties}`} leftColor={leftColor} rightColor={rightColor} />
            </div>}
            {sections.map(section => <div className="compareSectionBlock" key={section.title}>
                <h3>{section.title}</h3><div className="compareRows">
                    {section.rows.map(row => { const left=data.left.metrics[row.key], right=data.right.metrics[row.key];
                        const format=(v:number|null, rank:number|null) => v === null ? "—" : `${v.toFixed(1)}${row.percent ? "%" : ""}${rank != null ? ` (${rank})` : ""}`;
                        const sensitivity = row.key === "turnovers" || row.key === "takeaways"
                            ? BAR_SENSITIVITY.turnovers
                            : row.percent ? BAR_SENSITIVITY.percentage : BAR_SENSITIVITY.volume;
                        return <StatRow sensitivity={sensitivity} key={row.key} label={row.key === "passYards" ? "Passing Yards / Game" : row.key === "passYardsAllowed" ? "Passing Yards Allowed / Game" : row.label} leftVal={left} rightVal={right} leftText={format(left, data.left.ranks?.[row.key] ?? null)} rightText={format(right, data.right.ranks?.[row.key] ?? null)} leftColor={leftColor} rightColor={rightColor} />;
                    })}
                </div>
            </div>)}

        </div>}
    </section>;
}
