/** Weekly offline computation. The request path never downloads PBP or calls Python. */
import { parse } from 'csv-parse';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { normalizeTeam, SECTIONS, summarize, type Snapshot, type Totals, type TeamGame } from '../src/lib/nfl/summary.ts';

type Row = Record<string, string>;
const today = new Date();
const season = Number(process.argv[2] ?? (today.getUTCFullYear() - (today.getUTCMonth() < 7 ? 1 : 0)));
if (!Number.isInteger(season) || season < 2026 || season > today.getUTCFullYear()) throw Error('Invalid season');
const root = 'https://github.com/nflverse/nflverse-data/releases/download/';
const sources: string[] = [];
async function* csv(path: string, required: string[]) {
    const url = root + path;
    sources.push(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok || !res.body) throw Error(`nflverse ${res.status}: ${path}`);
    const stream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    const input = path.endsWith('.gz') ? stream.pipe(createGunzip()) : stream;
    const parser = input.pipe(parse({ columns: true, bom: true }));
    // Forward stream failures rather than leaving an iterator waiting forever.
    stream.on('error', e => parser.destroy(e));
    input.on('error', e => parser.destroy(e));
    let checked = false;
    for await (const row of parser) {
        if (!checked) { for (const c of required) if (!(c in row)) throw Error(`Missing ${c}: ${path}`); checked = true; }
        yield row as Row;
    }
    if (!checked) throw Error(`Empty source: ${path}`);
}
function num(row: Row, key: string, optional = false): number {
    const value = row[key];
    if (optional && (!value || value === 'NA')) return 0;
    if (!value || value === 'NA' || !Number.isFinite(Number(value))) throw Error(`Invalid ${key} in ${row.game_id ?? row.nflverse_game_id}`);
    return Number(value);
}
const flag = (r: Row, k: string) => num(r, k, true);
const key = (game: string, team: string) => `${game}:${normalizeTeam(team)}`;
const completed = new Map<string, Row>();
const teams = new Set<string>();
for await (const r of csv('schedules/games.csv', ['season','game_type','game_id','home_team','away_team','home_score','away_score','gameday','week'])) {
    if (Number(r.season) !== season || r.game_type !== 'REG') continue;
    teams.add(normalizeTeam(r.home_team)); teams.add(normalizeTeam(r.away_team));
    if (r.home_score && r.home_score !== 'NA' && r.away_score && r.away_score !== 'NA') {
        if (completed.has(r.game_id)) throw Error('Duplicate schedule game');
        completed.set(r.game_id, r);
    }
}
if (teams.size !== 32) throw Error(`Expected 32 schedule teams, found ${teams.size}`);
const totals = new Map<string, Totals>();
const teamRows = new Map<string, Row>();
const statFields = ['passing_yards','sack_yards_lost','rushing_yards','passing_interceptions','fumbles_lost_total','penalties','penalty_yards'];
if (completed.size) {
for await (const r of csv(`stats_team/stats_team_week_${season}.csv`, ['game_id','team','opponent_team','season_type',...statFields])) {
    if (!completed.has(r.game_id) || r.season_type !== 'REG') continue;
    const id = key(r.game_id,r.team);
    if (totals.has(id)) throw Error(`Duplicate team/game: ${id}`);
    const game = completed.get(r.game_id)!;
    const t = normalizeTeam(r.team); const home = normalizeTeam(game.home_team);
    const away = normalizeTeam(game.away_team);
    if (![home,away].includes(t) || normalizeTeam(r.opponent_team) !== (t===home ? away : home)) throw Error(`Opponent mismatch ${id}`);
    const sacks = num(r,'sack_yards_lost');
    if (sacks > 0) throw Error('Sack-yard sign changed upstream');
    const pass = num(r,'passing_yards')+sacks; const rush=num(r,'rushing_yards');
    totals.set(id,{points:num(game,t===home?'home_score':'away_score'),passYards:pass,rushYards:rush,yards:pass+rush,
        turnovers:num(r,'passing_interceptions')+num(r,'fumbles_lost_total'), penalties:num(r,'penalties'),penaltyYards:num(r,'penalty_yards'),
        firstDowns:0,thirdMade:0,thirdAttempts:0,fourthMade:0,fourthAttempts:0,redZoneMade:0,redZoneAttempts:0,
        qbPass:0,qbRush:0,wrRec:0,teRec:0,rbRush:0,rbRec:0});
    teamRows.set(id,r);
}
}
const playerKeys = new Set<string>();
const production = new Map<string,{pass:number;rush:number;rec:number}>();
if (completed.size) {
for await (const r of csv(`stats_player/stats_player_week_${season}.csv`, ['game_id','team','player_id','position','season_type','passing_yards','rushing_yards','receiving_yards'])) {
    const id=key(r.game_id,r.team), t=totals.get(id);
    if (!t || r.season_type !== 'REG') continue;
    const pass=num(r,'passing_yards'),rush=num(r,'rushing_yards'),rec=num(r,'receiving_yards');
    // nflverse includes unattributed non-offensive/team records. They do not
    // contribute positional yards; never discard an unattributed yardage row.
    if (!r.player_id && pass===0 && rush===0 && rec===0) continue;
    const pk=`${id}:${r.player_id}`;
    if (!r.player_id || playerKeys.has(pk)) throw Error(`Invalid/duplicate player ${pk}`);
    playerKeys.add(pk);
    if (!r.position && (pass || rush || rec)) throw Error(`Unclassified player ${pk}`);
    const sums=production.get(id)??{pass:0,rush:0,rec:0};sums.pass+=pass;sums.rush+=rush;sums.rec+=rec;production.set(id,sums);
    if(r.position==='QB'){t.qbPass+=pass;t.qbRush+=rush;}
    if(r.position==='WR')t.wrRec+=rec;
    if(r.position==='TE')t.teRec+=rec;
    if(['RB','FB','HB'].includes(r.position)){t.rbRush+=rush;t.rbRec+=rec;}
}
}
const seenPlays=new Set<string>();
const pbpScores=new Map<string,{home:number;away:number}>();
const drives=new Map<string,{teamKey:string;entered:boolean;touchdown:boolean}>();
const downs=['first_down_pass','first_down_rush','first_down_penalty','third_down_converted','third_down_failed','fourth_down_converted','fourth_down_failed'];
if (completed.size) {
for await(const r of csv(`pbp/play_by_play_${season}.csv.gz`,['game_id','play_id','posteam','fixed_drive','yardline_100','down','play_deleted','td_team','pass_touchdown','rush_touchdown','two_point_attempt','total_home_score','total_away_score',...downs])){
    if(!completed.has(r.game_id)||flag(r,'play_deleted')===1)continue;
    const pk=`${r.game_id}:${r.play_id}`;
    if(seenPlays.has(pk))throw Error(`Duplicate PBP key ${pk}`);
    seenPlays.add(pk);
    const score=pbpScores.get(r.game_id)??{home:0,away:0};
    score.home=Math.max(score.home,flag(r,'total_home_score'));score.away=Math.max(score.away,flag(r,'total_away_score'));pbpScores.set(r.game_id,score);
    const id=key(r.game_id,r.posteam),t=totals.get(id);
    if(!t)continue;
    t.firstDowns+=flag(r,'first_down_pass')+flag(r,'first_down_rush')+flag(r,'first_down_penalty');
    t.thirdMade+=flag(r,'third_down_converted');t.thirdAttempts+=flag(r,'third_down_converted')+flag(r,'third_down_failed');
    t.fourthMade+=flag(r,'fourth_down_converted');t.fourthAttempts+=flag(r,'fourth_down_converted')+flag(r,'fourth_down_failed');
    if(flag(r,'two_point_attempt')===1||!r.fixed_drive||r.fixed_drive==='NA')continue;
    const dk=`${id}:${r.fixed_drive}`;
    const drive=drives.get(dk)??{teamKey:id,entered:false,touchdown:false};
    // A recorded offensive down at/inside the 20 constitutes a trip, including
    // drives starting there and kneel-down possessions. PAT/2pt plays excluded.
    const line = r.yardline_100 && r.yardline_100 !== 'NA' ? Number(r.yardline_100) : Infinity;
    if(flag(r,'down')>=1&&line<=20&&line>=0)drive.entered=true;
    if(normalizeTeam(r.td_team)===normalizeTeam(r.posteam)&&(flag(r,'pass_touchdown')===1||flag(r,'rush_touchdown')===1))drive.touchdown=true;
    drives.set(dk,drive);
}
}
for(const d of drives.values())if(d.entered){const t=totals.get(d.teamKey)!;t.redZoneAttempts++;if(d.touchdown)t.redZoneMade++;}
const games:TeamGame[]=[];const excludedGames:string[]=[];
for(const [id,g] of completed){
    const home=normalizeTeam(g.home_team),away=normalizeTeam(g.away_team);
    const score=pbpScores.get(id);
    const ready=[home,away].every(team=>{
        const k=key(id,team),p=production.get(k),r=teamRows.get(k);
        return totals.has(k)&&p&&r&&p.pass===num(r,'passing_yards')&&p.rush===num(r,'rushing_yards')&&p.rec===num(r,'receiving_yards');
    });
    if(!ready||!score||score.home!==num(g,'home_score')||score.away!==num(g,'away_score')){excludedGames.push(id);continue;}
    for(const team of [home,away]){const opponent=team===home?away:home;
        games.push({id,date:g.gameday,week:num(g,'week'),team,opponent,own:totals.get(key(id,team))!,against:totals.get(key(id,opponent))!});}
}
const snapshot:Snapshot={version:1,season,updatedAt:today.toISOString(),latestGameDate:games.map(g=>g.date).sort().at(-1)??null,
    scheduledCompletedGames:completed.size,includedGames:games.length/2,excludedGames,teams:[...teams].sort(),games,sources,
    warnings:excludedGames.length?[`${excludedGames.length} completed game(s) await matching team, player and play-by-play data; all metrics use the same included games.`]:[]};
if(completed.size && !games.length)throw Error('No completed game could be validated; keeping previous snapshot');
for(const team of snapshot.teams){const s=summarize(snapshot,team);for(const section of SECTIONS)for(const m of section.rows){const v=s.metrics[m.key];if(v!==null&&(!Number.isFinite(v)||(m.percent&&(v<0||v>100))))throw Error(`Invalid ${team} ${m.key}`);}}
const path=new URL('../src/data/nfl-summary.json',import.meta.url);
try { const prev=JSON.parse(await readFile(path,'utf8')) as Snapshot;
    if(prev.season>season)throw Error('Refusing to replace a newer season');
    if(prev.season===season && prev.games.some(g=>!games.some(n=>n.id===g.id&&n.team===g.team)))throw Error('Refresh would remove previously verified games; keeping snapshot');
} catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
await mkdir(new URL('../src/data/',import.meta.url),{recursive:true});
await writeFile(new URL('../src/data/nfl-summary.json.tmp',import.meta.url),JSON.stringify(snapshot,null,2)+'\n');
await rename(new URL('../src/data/nfl-summary.json.tmp',import.meta.url),path);
console.log(JSON.stringify({season,includedGames:snapshot.includedGames,excludedGames,teams:teams.size,latestGameDate:snapshot.latestGameDate}));
