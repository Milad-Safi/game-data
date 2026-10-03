"""Current-season TD candidates. Explainable opportunity rules, not probabilities."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
import os
from threading import RLock
from zoneinfo import ZoneInfo

import polars as pl
from fastapi import HTTPException

from . import nfl_data as data
from .cache import cached

LOCK = RLock()
CATEGORIES = ('RB_rushing', 'QB_rushing', 'WR_receiving', 'TE_receiving', 'RB_receiving', 'other')
FIELDS = ('targets', 'completions', 'receiving_tds', 'rz_targets', 'inside10_targets',
          'inside5_targets', 'carries', 'rz_carries', 'inside10_carries', 'inside5_carries',
          'rushing_tds', 'scrambles', 'non_scramble_carries')
UNAVAILABLE = {'RES', 'IR', 'PUP', 'NFI', 'CUT', 'RET', 'SUS', 'EXE', 'INA', 'DEV'}
RULES = {
    'targets': 'Identifiable receiver on a pass attempt, including incompletions; sacks, spikes, conversions, deleted/no-plays excluded. Shares use identifiable targets only.',
    'zones': 'Pregame play yardline_100 <= 20 / 10 / 5. Inside-5 counts always shown, but one isolated target is not sufficient for a sneaky receiving role.',
    'recent': 'Last two verified completed team games; no previous-season data.',
    'qb': 'Eligible scheduled QB, otherwise latest depth-chart QB order, otherwise recent current-season passing volume. Selected QB is treated as the starter.',
    'eligibility': 'Active roster required; Out/Doubtful and unavailable roster statuses excluded. Questionable and limited practice remain eligible. Most recent team injury-report week is used, not stale individual reports.',
    'main': 'Recent opportunity required. Order by expected-QB targets plus carries inside 5, then inside 10, then red zone, then recent opportunity, opponent positional TD allowance versus league, season opportunity. No weighted composite score.',
    'sneaky': 'Outside team top two in total targets+carries AND at most 20% of team opportunities; recent role required; at least two expected-QB red-zone targets or two red-zone carries including an inside-10 carry. Rank qualifying players by red-zone opportunity concentration, then inside-10 opportunities. Never reuse a main pick.',
    'matchup': 'Opponent category TDs allowed per verified game minus current league category TDs per team-game; descriptive small-sample context and late ordering criterion, not a fitted effect.',
    'future': 'Every upcoming game uses today\'s roster, expected QB and current-season evidence; later-week injury reports do not yet exist. Refresh before game day.',
}


def norm(team):
    return {'LAR': 'LA', 'JAC': 'JAX', 'WSH': 'WAS'}.get(team, team)


def position(value):
    return 'RB' if value in ('FB', 'HB') else value


def empty():
    return {k: 0 for k in FIELDS}


def pct(n, d):
    return round(100 * n / d, 2) if d else None


def regular(df, season):
    if 'season' in df.columns:
        df = df.filter(pl.col('season') == season)
    for col in ('season_type', 'game_type'):
        if col in df.columns:
            df = df.filter(pl.col(col) == 'REG')
    return df


def keyed(rows, keys):
    result = {}
    for r in rows:
        key = tuple(r.get(k) for k in keys)
        if key in result and r != result[key]:
            raise HTTPException(503, f'Ambiguous nflverse records for {keys}: {key}')
        result[key] = r
    return result


def build():
    season = data.current_season()
    now = datetime.now(timezone.utc)
    schedule = regular(data.load('schedule', season), season)
    games = list(keyed(schedule.to_dicts(), ['game_id']).values())
    completed = [g for g in games if g['home_score'] is not None and g['away_score'] is not None]
    upcoming = []
    warnings = []
    for g in games:
        if g['home_score'] is not None or g['away_score'] is not None:
            continue
        # Schedule times are Eastern. Do not recommend picks for games already underway.
        if g.get('gameday'):
            kickoff = datetime.fromisoformat(f"{g['gameday']}T{g.get('gametime') or '00:00'}").replace(tzinfo=ZoneInfo('America/New_York'))
            if kickoff <= now:
                continue
        upcoming.append(g)
    upcoming.sort(key=lambda g: (str(g['gameday']), str(g.get('gametime') or ''), g['game_id']))
    state = dict(season=season, generated_at=now.isoformat(), games=upcoming, warnings=warnings,
                 rules=RULES, verified_games=0, excluded_completed_games=[], ignored_unassigned_targets=0,
                 missing_positions=0, unknown_td_positions=0, source_snapshots={})
    if not completed or not upcoming:
        state['empty_reason'] = 'No completed current-season regular-season evidence.' if not completed else 'No upcoming regular-season games.'
        return state

    # Required sources fail explicitly rather than quietly skipping availability checks.
    roster = data.load('rosters', season).filter(pl.col('season') == season)
    weekly = regular(data.load('weekly_rosters', season), season)
    depth = data.load('depth_charts', season)
    injury = regular(data.load('injuries', season), season)
    pbp = regular(data.load('pbp', season), season).select(
        'game_id', 'play_id', 'week', 'posteam', 'defteam', 'yardline_100',
        'total_home_score', 'total_away_score', 'play_deleted', 'play_type',
        'two_point_attempt', 'pass_attempt', 'rush_attempt', 'sack', 'qb_spike',
        'qb_kneel', 'qb_scramble', 'complete_pass', 'pass_touchdown', 'rush_touchdown',
        'td_player_id', 'td_team', 'passer_player_id', 'passer_player_name',
        'receiver_player_id', 'receiver_player_name', 'rusher_player_id', 'rusher_player_name')
    pbp = pbp.filter(pl.col('game_id').is_in([g['game_id'] for g in completed]))
    if pbp.select('game_id', 'play_id').is_duplicated().any():
        raise HTTPException(503, 'Duplicate PBP game/play keys; TD aggregation withheld.')
    scores = {r['game_id']: r for r in pbp.group_by('game_id').agg(
        pl.col('total_home_score').max(), pl.col('total_away_score').max()).to_dicts()}
    verified = [g for g in completed if g['game_id'] in scores and
                scores[g['game_id']]['total_home_score'] == g['home_score'] and
                scores[g['game_id']]['total_away_score'] == g['away_score']]
    ids = {g['game_id'] for g in verified}
    state['excluded_completed_games'] = [g['game_id'] for g in completed if g['game_id'] not in ids]
    state['verified_games'] = len(ids)
    if state['excluded_completed_games']:
        warnings.append('Incomplete/mismatched PBP games excluded from all opportunities and TD denominators.')
    if not ids:
        state['empty_reason'] = 'No completed games have verified PBP scoreboards.'
        return state

    # Weekly rosters classify historical plays; current roster controls upcoming eligibility.
    history = keyed(weekly.select('week', 'team', 'gsis_id', 'position').unique().to_dicts(), ['week', 'team', 'gsis_id'])
    roster = roster.filter(pl.col('gsis_id').is_not_null())
    if 'week' in roster.columns:
        roster = roster.filter(pl.col('week').fill_null(0) == pl.col('week').fill_null(0).max().over(['team', 'gsis_id']))
    current = keyed(roster.select('team', 'gsis_id', 'position', 'full_name', 'status', 'status_description_abbr').unique().to_dicts(), ['team', 'gsis_id'])
    depth = depth.filter(pl.col('dt') == pl.col('dt').max().over('team'))
    depth_rows = depth.to_dicts()
    state['source_snapshots']['depth_by_team'] = {r['team']: r['dt'] for r in depth_rows}
    for team, stamp in state['source_snapshots']['depth_by_team'].items():
        if (now - datetime.fromisoformat(str(stamp).replace('Z', '+00:00'))).days > 7:
            warnings.append(f'{team}: depth chart snapshot is over seven days old.')
    injury_weeks = {r['team']: r['week'] for r in injury.group_by('team').agg(pl.col('week').max()).to_dicts()}
    latest_injuries = injury.filter(pl.col('week') == pl.col('week').max().over('team'))
    injury_map = defaultdict(list)
    for r in latest_injuries.to_dicts():
        injury_map[(r['team'], r['gsis_id'])].append(r)
    state['source_snapshots']['injury_week_by_team'] = injury_weeks
    warnings.append('Availability reflects latest loaded nflverse reports, not a live inactive list; later games use today\'s availability. Missing report entries do not prove health.')

    team_games = defaultdict(list)
    for g in sorted(verified, key=lambda x: (str(x['gameday']), x['game_id'])):
        for team in (g['home_team'], g['away_team']):
            team_games[team].append(g['game_id'])
    stats, recent, pairs, recent_pairs = (defaultdict(empty) for _ in range(4))
    offense, defense = defaultdict(Counter), defaultdict(Counter)
    names, positions = {}, {}
    unknown = Counter()
    passer_volume = defaultdict(Counter)
    for r in pbp.filter(pl.col('game_id').is_in(list(ids))).iter_rows(named=True):
        if r.get('play_deleted') == 1 or r.get('play_type') == 'no_play' or r.get('two_point_attempt') == 1:
            continue
        team, opponent = r.get('posteam'), r.get('defteam')
        if not team or not opponent:
            continue
        is_recent = r['game_id'] in team_games[team][-2:]
        yard = r.get('yardline_100')
        zones = {'rz': yard is not None and 0 < yard <= 20,
                 'inside10': yard is not None and 0 < yard <= 10,
                 'inside5': yard is not None and 0 < yard <= 5}
        receiver, passer, rusher = (r.get(k + '_player_id') for k in ('receiver', 'passer', 'rusher'))
        for role, pid in [('receiver', receiver), ('passer', passer), ('rusher', rusher)]:
            if pid:
                names[(team, pid)] = r.get(role + '_player_name') or pid
                match = history.get((r['week'], team, pid), current.get((team, pid), {}))
                positions[(team, pid)] = position(match.get('position'))
        target = r.get('pass_attempt') == 1 and r.get('sack') != 1 and r.get('qb_spike') != 1
        if target and not receiver:
            state['ignored_unassigned_targets'] += 1
        if target and receiver:
            buckets = [stats[(team, receiver)]]
            if is_recent:
                buckets.append(recent[(team, receiver)])
            if passer:
                buckets.append(pairs[(team, passer, receiver)])
                if is_recent:
                    passer_volume[team][passer] += 1
                if is_recent:
                    buckets.append(recent_pairs[(team, passer, receiver)])
            for b in buckets:
                b['targets'] += 1
                b['completions'] += int(r.get('complete_pass') == 1)
                b['receiving_tds'] += int(r.get('pass_touchdown') == 1 and r.get('td_player_id') == receiver and r.get('td_team') == team)
                for z, inside in zones.items():
                    b[z + '_targets'] += int(inside)
        if r.get('rush_attempt') == 1 and r.get('qb_kneel') != 1 and rusher:
            for b in [stats[(team, rusher)]] + ([recent[(team, rusher)]] if is_recent else []):
                b['carries'] += 1
                b['rushing_tds'] += int(r.get('rush_touchdown') == 1 and r.get('td_player_id') == rusher and r.get('td_team') == team)
                b['scrambles'] += int(r.get('qb_scramble') == 1)
                b['non_scramble_carries'] += int(r.get('qb_scramble') != 1)
                for z, inside in zones.items():
                    b[z + '_carries'] += int(inside)
        if (r.get('pass_touchdown') == 1 or r.get('rush_touchdown') == 1) and r.get('td_team') == team:
            scorer = r.get('td_player_id')
            match = history.get((r['week'], team, scorer), current.get((team, scorer), {}))
            pos = position(match.get('position'))
            category = f"{pos}_{'receiving' if r.get('pass_touchdown') == 1 else 'rushing'}"
            if category not in CATEGORIES:
                category = 'other'
            if not pos:
                unknown['td_position'] += 1
            offense[team][category] += 1
            defense[opponent][category] += 1
    state['missing_positions'] = sum(1 for k in stats if not positions.get(k))
    state['unknown_td_positions'] = unknown['td_position']
    if state['missing_positions'] or state['unknown_td_positions']:
        warnings.append('Some player/TD positions could not be resolved; unknown TD categories remain other.')
    state.update(current=current, depth=depth_rows, injuries=injury_map, injury_weeks=injury_weeks,
                 team_games=team_games, stats=stats, recent=recent, pairs=pairs, recent_pairs=recent_pairs,
                 offense=offense, defense=defense, names=names, positions=positions, passer_volume=passer_volume)
    return state


def snapshot():
    with LOCK:
        return cached(f'nfl:td:v1:{data.current_season()}', 900, build)


def eligibility(s, team, pid):
    row = s['current'].get((team, pid))
    reports = s['injuries'].get((team, pid), [])
    statuses = sorted({r['report_status'] for r in reports if r.get('report_status')})
    reason = None
    if not row:
        reason = 'Not on current team roster.'
    elif row['status'] in UNAVAILABLE:
        reason = f"Unavailable roster status: {row['status']}."
    elif row['status'] != 'ACT':
        reason = f"Active roster status unverified: {row['status']}."
    elif any(v.lower() in ('out', 'doubtful') for v in statuses):
        reason = 'Injury report: ' + ', '.join(statuses)
    return {'eligible': reason is None, 'exclusion_reason': reason, 'roster_status': row.get('status') if row else None,
            'injury_statuses': statuses, 'injury_report_week': s['injury_weeks'].get(team),
            'practice_statuses': sorted({r['practice_status'] for r in reports if r.get('practice_status')})}


def expected_qb(s, g, team):
    side = 'home' if team == g['home_team'] else 'away'
    choices = []
    if g.get(side + '_qb_id'):
        choices.append((g[side + '_qb_id'], 'schedule'))
    for r in sorted((r for r in s['depth'] if r['team'] == team and r['pos_abb'] == 'QB' and r['gsis_id']),
                    key=lambda r: (r.get('pos_rank') or 999, r['gsis_id'])):
        choices.append((r['gsis_id'], 'depth_chart'))
    for pid, _ in s['passer_volume'][team].most_common():
        choices.append((pid, 'current_season_passing'))
    skipped = []
    seen = set()
    for pid, source in choices:
        if pid in seen:
            continue
        seen.add(pid)
        available = eligibility(s, team, pid)
        if available['eligible'] and position(s['current'][(team, pid)]['position']) == 'QB':
            return {'player_id': pid, 'name': s['current'][(team, pid)]['full_name'], 'source': source,
                    **available, 'skipped_unavailable': skipped}
        skipped.append({'player_id': pid, **available})
    return {'player_id': None, 'name': None, 'source': None, 'skipped_unavailable': skipped}


def team_candidates(s, g, team, opponent):
    qb = expected_qb(s, g, team)
    stats, pairs = s['stats'], s['pairs']
    team_total = sum(v['targets'] + v['carries'] for (t, _), v in stats.items() if t == team)
    opportunity_order = sorted([(pid, v['targets'] + v['carries']) for (t, pid), v in stats.items() if t == team], key=lambda x: (-x[1], x[0]))
    obvious = {pid for pid, _ in opportunity_order[:2]}
    totals = {z: sum(v[z + '_carries'] for (t, _), v in stats.items() if t == team) for z in ('inside10', 'inside5')}
    qb_rz = sum(v['rz_targets'] for (t, p, _), v in pairs.items() if t == team and p == qb['player_id'])
    league_gp = sum(len(v) for v in s['team_games'].values())
    opp_gp = len(s['team_games'][opponent])
    context = {}
    for cat in CATEGORIES:
        league_rate = sum(v[cat] for v in s['defense'].values()) / league_gp if league_gp else None
        opp_rate = s['defense'][opponent][cat] / opp_gp if opp_gp else None
        context[cat] = {'opponent_tds_allowed': s['defense'][opponent][cat], 'opponent_verified_games': opp_gp,
                        'opponent_per_game': opp_rate, 'league_per_team_game': league_rate,
                        'difference_per_game': opp_rate - league_rate if opp_rate is not None and league_rate is not None else None}
    candidates, excluded = [], []
    for (t, pid), v in list(stats.items()):
        if t != team:
            continue
        roster = s['current'].get((team, pid), {})
        pos = position(roster.get('position') or s['positions'].get((team, pid)))
        if pos not in ('QB', 'RB', 'WR', 'TE'):
            continue
        avail = eligibility(s, team, pid)
        if pos == 'QB' and pid != qb['player_id']:
            avail.update(eligible=False, exclusion_reason='Not the selected expected QB.')
        identity = {'team': team, 'player_id': pid, 'name': roster.get('full_name') or s['names'].get((team, pid), pid), 'position': pos}
        if not avail['eligible']:
            excluded.append({**identity, **avail})
            continue
        connection = pairs.get((team, qb['player_id'], pid), empty())
        recent_connection = s['recent_pairs'].get((team, qb['player_id'], pid), empty())
        recent = s['recent'].get((team, pid), empty())
        rush = pos in ('QB', 'RB')
        zones = {z: connection[z + '_targets'] + (v[z + '_carries'] if rush else 0) for z in ('rz', 'inside10', 'inside5')}
        recent_opps = recent_connection['targets'] + (recent['carries'] if rush else 0)
        opps = connection['targets'] + (v['carries'] if rush else 0)
        share = pct(v['targets'] + v['carries'], team_total)
        cats = ([f'{pos}_rushing'] if rush else []) + ([f'{pos}_receiving'] if pos != 'QB' else [])
        cats = [c for c in cats if c in context]
        matchup = max((context[c]['difference_per_game'] or 0 for c in cats), default=0)
        main = recent_opps > 0 and (zones['rz'] > 0 or opps >= 5)
        sneaky = main and pid not in obvious and (share or 0) <= 20 and (
            connection['rz_targets'] >= 2 or (rush and v['rz_carries'] >= 2 and v['inside10_carries'] >= 1))
        reasons = []
        if connection['targets']:
            reasons.append(f"{connection['targets']} identifiable targets from {qb['name']}, including {connection['rz_targets']} red-zone and {connection['inside10_targets']} inside-10 targets.")
        if rush and v['carries']:
            reasons.append(f"{v['carries']} non-kneel carries; {v['inside10_carries']} inside the 10 and {v['inside5_carries']} inside the 5.")
        reasons.append(f'{recent_opps} relevant opportunities in the last two verified team games.')
        if sneaky:
            reasons.append(f'Outside team top two in total opportunity, with {share:.1f}% of team targets/carries and a repeated red-zone role.')
        for cat in cats:
            reasons.append(f"{team} has scored {s['offense'][team][cat]} {cat.replace('_', ' ')} TDs in {len(s['team_games'][team])} verified games.")
            c = context[cat]
            if c['opponent_per_game'] is not None:
                reasons.append(f"{opponent} allows {c['opponent_per_game']:.2f} {cat.replace('_', ' ')} TD/game versus league {c['league_per_team_game']:.2f}, over {opp_gp} verified games.")
        candidates.append({**identity, **avail, 'season': v, 'recent_last_two_team_games': recent,
                           'expected_qb_connection': {**connection, 'red_zone_target_share_pct': pct(connection['rz_targets'], qb_rz)},
                           'recent_expected_qb_connection': recent_connection,
                           'team_inside10_carry_share_pct': pct(v['inside10_carries'], totals['inside10']),
                           'team_inside5_carry_share_pct': pct(v['inside5_carries'], totals['inside5']),
                           'team_opportunity_share_pct': share, 'matchup_context': {c: context[c] for c in cats},
                           'main_eligible': main, 'sneaky_eligible': sneaky, 'reasons': reasons,
                           '_main_order': (zones['inside5'], zones['inside10'], zones['rz'], recent_opps, matchup, opps),
                           '_sneaky_order': (zones['rz'] / opps if opps else 0, zones['inside10'], recent_opps)})
    candidates.sort(key=lambda c: tuple(-v for v in c['_main_order']) + (c['player_id'],))
    return {'team': team, 'opponent': opponent, 'expected_qb': qb, 'eligible_candidates': candidates,
            'excluded_candidates': excluded, 'offensive_td_distribution': {c: s['offense'][team][c] for c in CATEGORIES},
            'opponent_td_allowance': context, 'verified_team_games': len(s['team_games'][team]),
            'identifiable_expected_qb_red_zone_targets': qb_rz}


def clean_candidate(c):
    return {k: v for k, v in c.items() if not k.startswith('_')}


def game_result(s, g, detail=False):
    result = {k: g[k] for k in ('game_id', 'week', 'gameday', 'gametime', 'home_team', 'away_team')}
    if s.get('empty_reason'):
        return {**result, 'status': 'insufficient_data', 'reason': s['empty_reason'], 'main_picks': [], 'sneaky_pick': None, 'teams': []}
    teams = [team_candidates(s, g, t, o) for t, o in [(g['home_team'], g['away_team']), (g['away_team'], g['home_team'])]]
    candidates = [c for t in teams for c in t['eligible_candidates']]
    main = sorted((c for c in candidates if c['main_eligible']), key=lambda c: tuple(-v for v in c['_main_order']) + (c['player_id'],))[:2]
    main_ids = {c['player_id'] for c in main}
    sneaky = sorted((c for c in candidates if c['sneaky_eligible'] and c['player_id'] not in main_ids), key=lambda c: tuple(-v for v in c['_sneaky_order']) + (c['player_id'],))
    selected = sneaky[0] if sneaky else None
    notes = []
    if not main:
        notes.append('No eligible player has sufficient current-season/recent opportunity.')
    if not selected:
        notes.append('No distinct lower-volume candidate meets the repeated red-zone role requirements; no forced sneaky pick.')
    for t in teams:
        if not t['expected_qb']['player_id']:
            notes.append(f"{t['team']}: no eligible expected QB; receiving candidates have no QB-specific evidence.")
        if (s['injury_weeks'].get(t['team']) or 0) < g['week']:
            notes.append(f"{t['team']}: game-week injury report not yet available; using latest team report.")
        if detail:
            t['eligible_candidates'] = [clean_candidate(c) for c in t['eligible_candidates']]
    return {**result, 'status': 'ready' if main and selected else 'partial', 'notes': notes,
            'expected_qbs': {t['team']: t['expected_qb'] for t in teams},
            'main_picks': [clean_candidate(c) for c in main], 'sneaky_pick': clean_candidate(selected) if selected else None,
            **({'teams': teams} if detail else {})}


def predict(*, week=None, team=None, game_id=None):
    s = snapshot()
    games = s['games']
    if week is not None:
        games = [g for g in games if g['week'] == week]
    if team:
        team = norm(team.upper())
        active = {g[k] for g in s['games'] for k in ('home_team', 'away_team')}
        if active and team not in active:
            raise HTTPException(422, 'Use an active nflverse team abbreviation.')
        games = [g for g in games if team in (g['home_team'], g['away_team'])]
    if game_id:
        games = [g for g in games if g['game_id'] == game_id]
        if not games:
            raise HTTPException(404, 'Game is not an upcoming current-season regular-season game.')
    metadata = {k: s[k] for k in ('season', 'generated_at', 'verified_games', 'excluded_completed_games',
                                'ignored_unassigned_targets', 'missing_positions', 'unknown_td_positions', 'source_snapshots', 'warnings', 'rules')}
    metadata.update(cache_ttl_seconds=900, source_cache_ttl_seconds=int(os.environ['NFLREADPY_CACHE_DURATION']),
                    provider='nflverse', total_upcoming_games=len(s['games']), returned_games=len(games))
    return {**metadata, 'games': [game_result(s, g, detail=bool(game_id)) for g in games]}
