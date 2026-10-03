"use client";

import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchJson } from "@/lib/fetchJson";
import type { SeasonSimulationResponse, SimulatedTeam } from "@/types/api";

const API_BASE = process.env.NEXT_PUBLIC_EDGE_API_BASE ?? "https://leafs-edge-api.onrender.com";
const FILTERS = ["All", "East", "West", "Atlantic", "Metropolitan", "Central", "Pacific"] as const;
const SORTS = [
    ["make_playoffs_probability", "Playoffs %"],
    ["mean_projected_final_points", "Projected PTS"],
    ["division_winner_probability", "Division %"],
    ["top_3_division_probability", "Top 3 %"],
    ["wildcard_probability", "Wild Card %"],
] as const;
type SortKey = (typeof SORTS)[number][0];
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const range = (team: SimulatedTeam) => `${team.p10_projected_final_points.toLocaleString("en", { maximumFractionDigits: 1 })}–${team.p90_projected_final_points.toLocaleString("en", { maximumFractionDigits: 1 })}`;

const mobileQuery = "(max-width: 760px)";
function subscribeToViewport(listener: () => void) {
    const query = window.matchMedia(mobileQuery);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
}

function TeamDetails({ team }: { team: SimulatedTeam }) {
    const details: [string, string][] = [
        ["Current points", String(team.current_points)],
        ["Mean projected points", team.mean_projected_final_points.toFixed(1)],
        ["Median projected points", team.median_projected_final_points.toFixed(1)],
        ["P10–P90", range(team)],
        ["Make playoffs", percent(team.make_playoffs_probability)],
        ["Miss playoffs", percent(team.miss_playoffs_probability)],
        ["Division winner", percent(team.division_winner_probability)],
        ["Top 3 in division", percent(team.top_3_division_probability)],
        ["Wild card", percent(team.wildcard_probability)],
        ["Current effective Elo", team.current_effective_elo.toFixed(1)],
    ];
    if (team.roster_score != null) details.push(["Manual roster score", team.roster_score.toFixed(1)]);
    if (team.current_turnover_adjustment != null) details.push(["Current turnover adjustment", `${team.current_turnover_adjustment.toFixed(1)} Elo`]);
    return <div className="simulatorDetails" id={`simulator-details-${team.team}`}>
        <p>{team.team} · {team.conference} Conference · {team.division} Division</p>
        <dl>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </div>;
}

export default function SeasonSimulator() {
    const mobile = useSyncExternalStore(subscribeToViewport,
        () => window.matchMedia(mobileQuery).matches, () => false);
    const [data, setData] = useState<SeasonSimulationResponse | null>(null);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
    const [sort, setSort] = useState<SortKey>("make_playoffs_probability");
    const [ascending, setAscending] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);
    const request = useRef<Promise<SeasonSimulationResponse> | null>(null);

    useEffect(() => {
        let active = true;
        // Retain the promise through Strict Mode's effect replay: one request per mount.
        // Cleanup ignores late results without aborting and reissuing a cold-start request.
        request.current ??= fetchJson<SeasonSimulationResponse>(
            `${API_BASE.replace(/\/$/, "")}/v1/simulator/playoffs?simulations=10000&seed=2026`,
            { cache: "no-store" },
        ).then((result) => {
            if (!Array.isArray(result.teams) || result.teams.length !== 32 || !result.metadata) {
                throw new Error("Invalid simulation response");
            }
            return result;
        });
        request.current.then((result) => { if (active) setData(result); })
            .catch(() => { if (active) setError(true); });
        return () => { active = false; };
    }, [attempt]);

    function retry() {
        request.current = null;
        setError(false);
        setAttempt((value) => value + 1);
    }
    function changeSort(key: SortKey) {
        setAscending(key === sort ? !ascending : false);
        setSort(key);
    }
    const teams = (data?.teams ?? []).filter((team) => filter === "All"
        || (filter === "East" && team.conference === "Eastern")
        || (filter === "West" && team.conference === "Western")
        || team.division === filter)
        .sort((a, b) => (ascending ? a[sort] - b[sort] : b[sort] - a[sort]) || a.team.localeCompare(b.team));
    const timestamp = data?.metadata.standings_snapshot_time_utc ?? data?.metadata.standings_fetched_at;
    const updated = timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp) : null;
    const season = String(data?.metadata.season_id ?? "");
    function heading(key: SortKey, label: string, className = "") {
        return <th scope="col" className={className} aria-sort={sort === key ? (ascending ? "ascending" : "descending") : "none"}>
            <button onClick={() => changeSort(key)}>{label}<span aria-hidden="true">{sort === key ? (ascending ? " ↑" : " ↓") : " ↕"}</span></button>
        </th>;
    }

    return <main className="simulatorPage">
        <header className="simulatorHeading">
            <h1>Season Simulator</h1>
            <p>10,000 simulations of the remaining NHL regular season using current standings, schedule, team strength and home ice.</p>
            {data && <ul className="simulatorMetadata">
                <li>{season.slice(0, 4)}–{season.slice(6)} season</li>
                <li>{data.metadata.simulations.toLocaleString("en")} simulations</li>
                <li>{data.metadata.remaining_games.toLocaleString("en")} remaining games</li>
                {updated && <li>Last updated <time dateTime={updated.toISOString()}>{updated.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</time></li>}
            </ul>}
        </header>
        {!data && !error && <p className="simulatorState" role="status">Loading season simulations…</p>}
        {error && <div className="simulatorState" role="alert"><p>Season simulations could not be loaded. Please try again.</p><button onClick={retry}>Retry</button></div>}
        {data && <>
            <div className="simulatorToolbar">
                <div className="simulatorFilters" role="group" aria-label="Filter teams">
                    {FILTERS.map((value) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}
                </div>
                <div className="simulatorSort">
                    <label htmlFor="simulator-sort">Sort by</label>
                    <select id="simulator-sort" value={sort} onChange={(event) => { setSort(event.target.value as SortKey); setAscending(false); }}>
                        {SORTS.map(([key, label]) => <option value={key} key={key}>{label}</option>)}
                    </select>
                    <button aria-label={`Sort ${ascending ? "descending" : "ascending"}`} onClick={() => setAscending(!ascending)}>{ascending ? "↑" : "↓"}</button>
                </div>
            </div>
            <p className="simulatorTableNote">{teams.length} teams · Select a team for details. Division % is the chance of winning its division.</p>
            <table className="simulatorTable">
                <caption className="simulatorSrOnly">Projected NHL standings, {filter}. Percentages represent simulated qualification frequency.</caption>
                <thead><tr>
                    <th scope="col">Team</th><th scope="col" className="simulatorSecondary">Current PTS</th>
                    {heading("mean_projected_final_points", "Projected PTS")}
                    <th scope="col" className="simulatorSecondary">P10–P90</th>
                    {heading("make_playoffs_probability", "Playoffs %")}
                    {heading("division_winner_probability", "Division %", "simulatorSecondary")}
                    {heading("top_3_division_probability", "Top 3 %", "simulatorSecondary")}
                    {heading("wildcard_probability", "Wild Card %", "simulatorSecondary")}
                </tr></thead>
                <tbody>{teams.map((team) => {
                    const open = expanded === team.team;
                    const toggle = () => setExpanded(open ? null : team.team);
                    return <Fragment key={team.team}>
                        <tr className={`simulatorTeamRow${open ? " simulatorTeamRowOpen" : ""}`} onClick={toggle}>
                            <th scope="row"><button aria-label={`${team.team} details`} aria-expanded={open} aria-controls={open ? `simulator-details-${team.team}` : undefined} onClick={(event) => { event.stopPropagation(); toggle(); }}><span aria-hidden="true">{open ? "−" : "+"}</span> {team.team}</button></th>
                            <td className="simulatorSecondary">{team.current_points}</td>
                            <td>{team.mean_projected_final_points.toFixed(1)}</td>
                            <td className="simulatorSecondary">{range(team)}</td>
                            <td><span className="simulatorProbability">{percent(team.make_playoffs_probability)}<span className="simulatorBar" aria-hidden="true"><span style={{ width: percent(team.make_playoffs_probability) }} /></span></span></td>
                            <td className="simulatorSecondary">{percent(team.division_winner_probability)}</td>
                            <td className="simulatorSecondary">{percent(team.top_3_division_probability)}</td>
                            <td className="simulatorSecondary">{percent(team.wildcard_probability)}</td>
                        </tr>
                        {open && <tr><td colSpan={mobile ? 3 : 8} className="simulatorDetailCell"><TeamDetails team={team} /></td></tr>}
                    </Fragment>;
                })}</tbody>
            </table>
        </>}
        <details className="simulatorMethodology">
            <summary>Methodology</summary>
            <p>The simulator runs <strong>10,000 Monte Carlo simulations</strong> to estimate NHL regular-season point totals and playoff probabilities.</p>
            <p>Each team starts with an <strong>Elo rating calibrated from manually assessed 2026–27 roster strength</strong>. Ratings update as regular-season results arrive, while temporary roster-turnover adjustments decay over the first 20 games.</p>
            <p>Matchup probabilities combine current Elo, home-ice advantage, and remaining turnover adjustments. Official NHL standings and schedules define the starting state. Regulation, overtime, and shootout outcomes are sampled using verified historical rates from 2023–24 through 2025–26, independently of matchup strength and the winner. Underlying Elo remains fixed within each simulation.</p>
            <p>Playoff qualification follows the NHL’s division and wild-card format. Standings are ranked by points, regulation wins, regulation plus overtime wins (ROW), and total wins, with seeded random resolution for remaining exact ties. Top 3 includes division winners. Wild cards exclude division qualifiers.</p>
            <p><strong>P10–P90</strong> represents the middle 80% of simulated point totals. Projections depend on the model’s assumptions and manual roster assessments. In-progress games are treated as unplayed; a fixed random seed of <strong>2026</strong> makes results reproducible.</p>
        </details>
    </main>;
}
