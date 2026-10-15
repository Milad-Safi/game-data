"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { fetchJson } from "@/lib/fetchJson";
import { getNFLLogo, NFL_ASSETS } from "@/lib/nflAssets";
import { NFL_TEAM_OPTIONS } from "@/lib/nflTeams";
import styles from "./td-predictor.module.css";

const API_BASE = process.env.NEXT_PUBLIC_EDGE_API_BASE ?? "https://leafs-edge-api.onrender.com";
const uiTeam = (team: string) => ({ LA: "LAR", JAC: "JAX", WSH: "WAS" }[team] ?? team);
const teamName = (team: string) => NFL_TEAM_OPTIONS.find(t => t.value === uiTeam(team))?.label ?? team;
const logo = (team: string) => getNFLLogo(uiTeam(team));

type Usage = { targets: number; rz_targets: number; inside10_targets: number; inside5_targets: number;
    carries: number; rz_carries: number; inside10_carries: number; inside5_carries: number; rushing_tds: number };
type Pick = { player_id: string; name: string; team: string; position: string; headshot_url?: string | null;
    injury_statuses: string[]; reasons: string[]; concerns?: string[]; selection_basis?: string; scoring_route?: string; defensive_matchup?: string; season: Usage; expected_qb_connection: Usage;
    recent_last_two_team_games: Usage; recent_expected_qb_connection: Usage;
    scoring_evidence?: { tds: number; scoring_games: number; games: number } };
type QB = { name: string | null; player_id: string | null };
type Game = { game_id: string; week: number; gameday: string; gametime: string | null; home_team: string; away_team: string;
    scoring_environment?: { label: string; pick_limit: number; basis: string };
    status: string; reason?: string; notes?: string[]; expected_qbs?: Record<string, QB>; main_picks: Pick[]; sneaky_pick: Pick | null };
type Response = { upcoming_week: number | null; season: number; generated_at: string; verified_games: number; warnings: string[]; games: Game[] };

// Support the existing Render response while the backend deployment catches up.
// Legacy responses contain all remaining weeks and omit upcoming_week.
function upcomingWeekResponse(result: Response, now = new Date()): Response {
    if (!Array.isArray(result.games) || !Number.isInteger(result.season)) throw new Error("Invalid TD response");
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
    const part = (key: string) => parts.find(p => p.type === key)!.value;
    const easternNow = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
    const upcoming = result.games.filter(game => {
        if (!Number.isInteger(game.week) || !/^\d{4}-\d{2}-\d{2}$/.test(game.gameday)) throw new Error("Invalid TD game");
        return `${game.gameday}T${game.gametime || "00:00"}` > easternNow;
    }).sort((a, b) => a.gameday.localeCompare(b.gameday) || (a.gametime || "").localeCompare(b.gametime || "") || a.game_id.localeCompare(b.game_id));
    const week = upcoming[0]?.week ?? null;
    return { ...result, upcoming_week: week, games: upcoming.filter(game => game.week === week) };
}

function PlayerImage({ pick }: { pick: Pick }) {
    const [failed, setFailed] = useState(false);
    const headshot = pick.headshot_url && /^https:\/\//i.test(pick.headshot_url) ? pick.headshot_url : null;
    // Roster image URLs vary by source; use a native image with a team-logo fallback.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={headshot && !failed ? styles.headshot : styles.fallback} src={!failed && headshot ? headshot : logo(pick.team)}
        alt={pick.name} loading="lazy" onError={() => setFailed(true)} />;
}

function PickCard({ pick, sneaky = false }: { pick: Pick; sneaky?: boolean }) {
    const connection = pick.expected_qb_connection;
    const rushing = pick.position === "QB" || pick.position === "RB";
    return <article className={`${styles.pick} ${sneaky ? styles.sneaky : ""}`} style={{ "--team-color": NFL_ASSETS[uiTeam(pick.team)]?.colors[0] ?? "#658bb8" } as CSSProperties}>
        <div className={styles.pickLabel}>{sneaky ? `Sneaky pick${pick.selection_basis === "sneaky_fallback" ? " · Matchup lean" : ""}` : pick.selection_basis === "role_fallback" ? "Role-based pick" : "Main pick"}</div>
        <div className={styles.player}>
            <div className={styles.portrait}><PlayerImage pick={pick} /></div>
            <div><p className={styles.playerMeta}>{uiTeam(pick.team)} <span>·</span> {pick.position}</p><h3>{pick.name}</h3>
                {pick.injury_statuses.includes("Questionable") && <span className={styles.questionable}>Questionable</span>}</div>
        </div>
        <dl className={styles.stats}>
            {pick.scoring_evidence && <div><dd>{pick.scoring_evidence.tds}</dd><dt>{pick.scoring_route?.endsWith("rushing") ? "Rushing" : "Receiving"} TDs this season</dt></div>}
            <div><dd>{connection.inside10_targets}</dd><dt>Targets inside the 10</dt></div>
            <div><dd>{rushing ? pick.season.inside10_carries : 0}</dd><dt>Carries inside the 10</dt></div>
        </dl>
        {pick.scoring_route && <p className={styles.route}>{pick.scoring_route.endsWith("rushing") ? "Rushing TD" : "Receiving TD"} <span>· {pick.defensive_matchup} matchup</span></p>}
        <details className={styles.reasonDetails}><summary>Why this pick <span aria-hidden>+</span></summary>
            <ul>{pick.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
            {!!pick.concerns?.length && <div className={styles.concerns}><strong>Matchup concern</strong><ul>{pick.concerns.map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
        </details>
    </article>;
}

function GameCard({ game }: { game: Game }) {
    const [open, setOpen] = useState(false);
    const date = new Date(`${game.gameday}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const time = game.gametime ? new Date(`2000-01-01T${game.gametime}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) + " ET" : "Time TBD";
    const count = game.main_picks.length + Number(Boolean(game.sneaky_pick));
    return <article className={`${styles.game} ${open ? styles.open : ""}`}>
        <button className={styles.matchup} aria-expanded={open} aria-controls={`picks-${game.game_id}`} onClick={() => setOpen(!open)}>
            <span className={styles.kickoff}><span>{date}</span><span>{time}</span></span>
            <span className={styles.teams}>
                {[game.away_team, game.home_team].map((team, index) => <span className={styles.teamWrap} key={team}>
                    {index === 1 && <span className={styles.at}>@</span>}
                    <span className={styles.team}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={logo(team)} alt="" width={48} height={48} />
                        <span><strong>{uiTeam(team)}</strong><span className={styles.fullName}>{teamName(team)}</span></span>
                    </span>
                </span>)}
            </span>
            <span className={styles.expand}><span>{open ? "Close picks" : count ? `${count} TD picks` : "View status"}</span><span className={styles.chevron} aria-hidden>{open ? "−" : "+"}</span></span>
        </button>
        {open && <div className={styles.expanded} id={`picks-${game.game_id}`}>
            <div className={styles.qbs}><span>Expected QBs</span>{[game.away_team, game.home_team].map(team => <span key={team}>{uiTeam(team)} <strong>{game.expected_qbs?.[team]?.name ?? "Not available"}</strong></span>)}</div>
            {game.scoring_environment && <p className={styles.environment}>{game.scoring_environment.label.charAt(0).toUpperCase() + game.scoring_environment.label.slice(1)} matchup · {count} {count === 1 ? "pick" : "picks"}</p>}
            <div className={styles.picks}>
                {game.main_picks.map(pick => <PickCard key={pick.player_id} pick={pick} />)}
                {game.sneaky_pick ? <PickCard pick={game.sneaky_pick} sneaky /> : <div className={styles.noPick}><strong>No sneaky pick yet</strong><p>No eligible lower-volume alternative.</p></div>}
            </div>
            {game.reason && <p className={styles.notice}>{game.reason}</p>}
            {!!game.notes?.length && <details className={styles.gameNotes}><summary>Availability & data notes</summary><ul>{game.notes.map(note => <li key={note}>{note}</li>)}</ul></details>}
        </div>}
    </article>;
}

export default function TDPredictor() {
    const [data, setData] = useState<Response | null>(null);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [team, setTeam] = useState("");
    const request = useRef<Promise<Response> | null>(null);
    useEffect(() => {
        let active = true;
        // Reuse through Strict Mode replay; filters and expansions never fetch again.
        request.current ??= fetchJson<Response>(`${API_BASE.replace(/\/$/, "")}/v1/nfl/td-predictor/games`, { cache: "no-store" }).then(result => upcomingWeekResponse(result));
        request.current.then(result => { if (active) setData(result); }).catch(() => { if (active) setError(true); });
        return () => { active = false; };
    }, [attempt]);
    const games = data?.games.filter(g => !team || uiTeam(g.home_team) === team || uiTeam(g.away_team) === team) ?? [];
    return <main className={styles.page}>
        <header className={styles.heading}><p className={styles.eyebrow}>NFL · MATCHUP PICKS</p><h1>TD Predictor</h1>
            <p>Using scoring opportunities and defensive matchups to predict touchdown scorers for the upcoming week.</p>
        </header>
        {!data && !error && <div className={styles.loading} role="status"><span className={styles.loadingDot} />Loading touchdown picks…<p>The data service can take a moment to wake up.</p></div>}
        {error && <div className={styles.loading} role="alert"><h2>Picks couldn’t be loaded</h2><p>Couldn’t retrieve picks from the data service. Please retry.</p><button onClick={() => { request.current = null; setError(false); setAttempt(a => a + 1); }}>Retry</button></div>}
        {data && <>
            <div className={styles.toolbar}><div className={styles.filters}>
                {data.upcoming_week && <span className={styles.week}>Week {data.upcoming_week}</span>}
                <label>Team<select value={team} onChange={e => setTeam(e.target.value)}><option value="">All teams</option>{NFL_TEAM_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
            </div><p>{data.season} season <span>·</span> {games.length} {games.length === 1 ? "game" : "games"}</p></div>
            <p className={styles.helper}>Select a matchup for picks. Inside-10 stats use the snap location; receiving stats use the expected QB.</p>
            <div className={styles.games}>{games.map(game => <GameCard key={game.game_id} game={game} />)}</div>
            {!games.length && <div className={styles.loading}><h2>No upcoming games{team ? " for this team" : ""}</h2><p>{data.games.length ? "Try another team. Completed games and bye weeks won’t have picks." : "Picks will appear when upcoming regular-season games are available."}</p></div>}
            <footer className={styles.footnote}>Based on {data.verified_games} completed regular-season games. Calculated {new Date(data.generated_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.</footer>
        </>}
    </main>;
}
