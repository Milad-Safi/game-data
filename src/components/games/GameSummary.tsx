import type { HistoricalGameDetailResponse } from "@/types/games";
import CompactStatRow from "@/components/CompactStatRow";
import { getTeamColor } from "@/lib/teamColours";

export default function GameSummary({ data }: { data: HistoricalGameDetailResponse }) {
    const sides = (["away", "home"] as const).map(side => {
        const team = side === "home" ? data.homeTeam : data.awayTeam;
        const players = data.playerStats[side];
        const sumShots = (rows: typeof players.skaters) => rows.reduce((sum, p) => sum + p.shots, 0);
        const leaders = (key: "shots" | "points") => {
            const max = Math.max(0, ...players.skaters.map(p => p[key]));
            return max ? players.skaters.filter(p => p[key] === max).map(p => `${p.name} (${max})`) : ["None"];
        };
        const pp = data.powerPlays?.[side] ?? null;
        const [goals, opportunities] = pp?.split("/").map(Number) ?? [];
        return { team, forwardShots: sumShots(players.forwards), defensemanShots: sumShots(players.defencemen),
            scorers: players.skaters.filter(p => p.goals > 0).map(p => `${p.name} (${p.goals})`),
            shots: leaders("shots"), points: leaders("points"), pp: pp ?? "—",
            ppPct: pp == null ? null : opportunities > 0 ? goals / opportunities * 100 : 0 };
    });
    const [away, home] = sides;
    const colors = { leftColor: getTeamColor(away.team.abbrev), rightColor: getTeamColor(home.team.abbrev) };
    const names = (values: string[]) => (values.length ? values : ["None"]).map(name => <span className="gameSummaryPlayer" key={name}>{name}</span>);
    return <section className="gameSummary" aria-labelledby="game-summary-heading">
        <h2 id="game-summary-heading">Game summary</h2>
        <div className="gameSummaryTeams">
            <div><img src={away.team.logoSrc} alt="" /><strong>{away.team.abbrev}</strong></div>
            <span>FINAL</span>
            <div><strong>{home.team.abbrev}</strong><img src={home.team.logoSrc} alt="" /></div>
        </div>
        <CompactStatRow {...colors} label="Shots on goal" left={away.team.sog} right={home.team.sog} leftValue={away.team.sog} rightValue={home.team.sog} />
        <CompactStatRow {...colors} label="SOG by forwards" left={away.forwardShots} right={home.forwardShots} leftValue={away.forwardShots} rightValue={home.forwardShots} />
        <CompactStatRow {...colors} label="SOG by defensemen" left={away.defensemanShots} right={home.defensemanShots} leftValue={away.defensemanShots} rightValue={home.defensemanShots} />
        <CompactStatRow {...colors} label="Power play" left={away.pp} right={home.pp} leftValue={away.ppPct} rightValue={home.ppPct} />
        <CompactStatRow {...colors} label="Goal scorers" left={names(away.scorers)} right={names(home.scorers)} />
        <CompactStatRow {...colors} label="SOG leaders" left={names(away.shots)} right={names(home.shots)} />
        <CompactStatRow {...colors} label="Points leaders" left={names(away.points)} right={names(home.points)} />
    </section>;
}
