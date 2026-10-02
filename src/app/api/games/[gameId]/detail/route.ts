import { NextResponse } from "next/server";

import { NHL_TEAM_OPTIONS } from "@/lib/compare";
import { getTeamLogoSrc } from "@/lib/teamAssets";
import type {
    GameDetailPeriodKey,
    HistoricalDecision,
    HistoricalGameDetailResponse,
    HistoricalGameDetailTeam,
    HistoricalGameGoalEvent,
    HistoricalGameGoalieRow,
    HistoricalGameShotEvent,
    HistoricalGameSkaterRow,
    HistoricalGameTeamStatsRow,
} from "@/types/games";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const REVALIDATE_SECONDS = 60 * 60 * 24;
const RETRY_COUNT = 4;
const RETRY_BASE_MS = 800;
const OFFENSIVE_ZONE_BLUE_LINE_X = 25;
const OFFENSIVE_ZONE_GOAL_LINE_X = 89;

const TEAM_LABEL_BY_ABBREV = new Map(
    NHL_TEAM_OPTIONS.map((team) => [team.value, team.label])
);

type ApiName = {
    default?: string;
};

type ApiTeam = {
    id?: number;
    abbrev?: string;
    score?: number;
    sog?: number;
    name?: ApiName;
    commonName?: ApiName;
    placeName?: ApiName;
    darkLogo?: string;
    logo?: string;
};

type ApiSkater = {
    playerId?: number;
    name?: ApiName | string;
    sweaterNumber?: string | number;
    position?: string;
    positionCode?: string;
    goals?: number;
    assists?: number;
    points?: number;
    shots?: number;
    sog?: number;
    hits?: number;
    pim?: number;
    toi?: string;
    blockedShots?: number;
    blocks?: number;
};

type ApiGoalie = {
    playerId?: number;
    name?: ApiName | string;
    sweaterNumber?: string | number;
    toi?: string;
    starter?: boolean;
    saves?: number;
    saveShotsAgainst?: number;
    shotsAgainst?: number;
    goalsAgainst?: number;
    evenStrengthShotsAgainst?: number;
    powerPlayShotsAgainst?: number;
    shorthandedShotsAgainst?: number;
    evenStrengthSaves?: number;
    powerPlaySaves?: number;
    shorthandedSaves?: number;
    savePctg?: number;
    savePercentage?: number;
};

type ApiTeamPlayerGroup = {
    forwards?: ApiSkater[];
    defense?: ApiSkater[];
    defence?: ApiSkater[];
    defensemen?: ApiSkater[];
    goalies?: ApiGoalie[];
};

type ApiBoxscore = {
    gameDate?: string;
    startTimeUTC?: string;
    venue?: ApiName;
    homeTeam?: ApiTeam;
    awayTeam?: ApiTeam;
    periodDescriptor?: {
        periodType?: string;
    };
    gameOutcome?: {
        lastPeriodType?: string;
    };
    playerByGameStats?: {
        homeTeam?: ApiTeamPlayerGroup;
        awayTeam?: ApiTeamPlayerGroup;
    };
};

type ApiPlay = {
    eventId?: number | string;
    typeDescKey?: string;
    timeInPeriod?: string;
    periodDescriptor?: {
        number?: number;
        periodType?: string;
    };
    details?: {
        eventOwnerTeamId?: number;
        shootingPlayerId?: number;
        scoringPlayerId?: number;
        blockingPlayerId?: number;
        hittingPlayerId?: number;
        playerId?: number;
        xCoord?: number;
        yCoord?: number;
        shotType?: string;
        reason?: string;
        homeScore?: number;
        awayScore?: number;
        duration?: number;
        situationCode?: string;
    };
};

type ApiPlayByPlay = {
    plays?: ApiPlay[];
};


type ShotEventType = "shot-on-goal" | "missed-shot" | "blocked-shot" | "goal";

type TeamStatsMap = Record<
    GameDetailPeriodKey,
    Record<string, HistoricalGameTeamStatsRow>
>;

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number) {
    return status === 429 || status >= 500;
}

function retryDelayMs(response: Response, attempt: number) {
    const retryAfter = Number(response.headers.get("retry-after"));

    if (Number.isFinite(retryAfter) && retryAfter > 0) {
        return retryAfter * 1000;
    }

    return RETRY_BASE_MS * attempt;
}

async function fetchJsonWithRetry<T>(url: string): Promise<T> {
    for (let attempt = 1; attempt <= RETRY_COUNT; attempt += 1) {
        const response = await fetch(url, {
            next: { revalidate: REVALIDATE_SECONDS },
            headers: { "User-Agent": "game-data" },
        });

        if (response.ok) {
            return (await response.json()) as T;
        }

        if (!isRetryableStatus(response.status) || attempt === RETRY_COUNT) {
            throw new Error(`Fetch ${response.status} ${response.statusText}: ${url}`);
        }

        await sleep(retryDelayMs(response, attempt));
    }

    throw new Error(`Failed to fetch ${url}`);
}

function asNumber(value: unknown, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function asNullableNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function asString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function nameOf(value: ApiName | string | undefined) {
    if (typeof value === "string") {
        return value.trim();
    }

    return value?.default?.trim() ?? "";
}

function teamLabel(team: ApiTeam | undefined, abbrev: string) {
    const mappedLabel = TEAM_LABEL_BY_ABBREV.get(abbrev);
    if (mappedLabel) return mappedLabel;

    const explicitName = nameOf(team?.name);
    if (explicitName) return explicitName;

    const placeName = nameOf(team?.placeName);
    const commonName = nameOf(team?.commonName);

    if (placeName && commonName) {
        return `${placeName} ${commonName}`.trim();
    }

    return placeName || commonName || abbrev;
}

function formatDecision(box: ApiBoxscore): HistoricalDecision {
    const lastPeriodType = asString(box.gameOutcome?.lastPeriodType).toUpperCase();
    const periodType = asString(box.periodDescriptor?.periodType).toUpperCase();

    if (lastPeriodType === "SO" || periodType === "SO") return "so";
    if (lastPeriodType === "OT" || periodType === "OT") return "ot";
    return "reg";
}

function toTeamPayload(team: ApiTeam | undefined): HistoricalGameDetailTeam {
    const abbrev = asString(team?.abbrev).toUpperCase();
    const label = teamLabel(team, abbrev || "TEAM");

    return {
        id: asNullableNumber(team?.id),
        abbrev,
        label,
        logoSrc: getTeamLogoSrc(label, abbrev || "TEAM"),
        score: asNumber(team?.score),
        sog: asNumber(team?.sog),
    };
}

function toiToSeconds(toi: string) {
    const trimmed = toi.trim();
    if (!trimmed) return 0;

    const parts = trimmed.split(":").map((value) => Number(value));
    if (parts.some((value) => !Number.isFinite(value))) return 0;

    if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }

    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return 0;
}

function buildSkaterRows(skaters: ApiSkater[] | undefined) {
    const deduped = new Map<number, HistoricalGameSkaterRow>();

    for (const player of skaters ?? []) {
        const playerId = asNumber(player.playerId);
        if (!playerId) continue;

        const toi = asString(player.toi);

        deduped.set(playerId, {
            playerId,
            name: nameOf(player.name) || `Player ${playerId}`,
            sweaterNumber: String(player.sweaterNumber ?? ""),
            goals: asNumber(player.goals),
            assists: asNumber(player.assists),
            points: asNumber(
                player.points,
                asNumber(player.goals) + asNumber(player.assists)
            ),
            shots: asNumber(player.shots, asNumber(player.sog)),
            hits: asNumber(player.hits),
            blocks: asNumber(player.blockedShots, asNumber(player.blocks)),
            pim: asNumber(player.pim),
            toi,
            toiSeconds: toiToSeconds(toi),
        });
    }

    return [...deduped.values()].sort((left, right) => {
        if (right.points !== left.points) return right.points - left.points;
        if (right.goals !== left.goals) return right.goals - left.goals;
        return left.name.localeCompare(right.name);
    });
}

function buildGoalieRows(goalies: ApiGoalie[] | undefined) {
    const rows: HistoricalGameGoalieRow[] = [];

    for (const goalie of goalies ?? []) {
        const playerId = asNumber(goalie.playerId);
        if (!playerId) continue;

        const toi = asString(goalie.toi);
        const explicitShotsAgainst = asNullableNumber(goalie.shotsAgainst);
        const computedShotsAgainst =
            asNumber(goalie.evenStrengthShotsAgainst) +
            asNumber(goalie.powerPlayShotsAgainst) +
            asNumber(goalie.shorthandedShotsAgainst);
        const shotsAgainst =
            explicitShotsAgainst ??
            asNullableNumber(goalie.saveShotsAgainst) ??
            computedShotsAgainst;

        const explicitSaves = asNullableNumber(goalie.saves);
        const computedSaves =
            asNumber(goalie.evenStrengthSaves) +
            asNumber(goalie.powerPlaySaves) +
            asNumber(goalie.shorthandedSaves);
        const saves =
            explicitSaves ??
            (shotsAgainst != null
                ? Math.max(0, shotsAgainst - asNumber(goalie.goalsAgainst))
                : computedSaves);

        const goalsAgainst =
            asNullableNumber(goalie.goalsAgainst) ??
            Math.max(0, (shotsAgainst ?? 0) - (saves ?? 0));

        const rawSavePct =
            asNullableNumber(goalie.savePctg) ??
            asNullableNumber(goalie.savePercentage) ??
            (shotsAgainst && shotsAgainst > 0
                ? (saves ?? 0) / shotsAgainst
                : 0);

        const savePct = rawSavePct > 1 ? rawSavePct / 100 : rawSavePct;

        rows.push({
            playerId,
            name: nameOf(goalie.name) || `Goalie ${playerId}`,
            sweaterNumber: String(goalie.sweaterNumber ?? ""),
            shotsAgainst: shotsAgainst ?? 0,
            saves: saves ?? 0,
            savePct: Number(savePct.toFixed(3)),
            goalsAgainst,
            toi,
            toiSeconds: toiToSeconds(toi),
            starter: Boolean(goalie.starter),
        });
    }

    return rows.sort((left, right) => {
        if (Number(right.starter) !== Number(left.starter)) {
            return Number(right.starter) - Number(left.starter);
        }

        if (right.toiSeconds !== left.toiSeconds) {
            return right.toiSeconds - left.toiSeconds;
        }

        return left.name.localeCompare(right.name);
    });
}

function normaliseDate(dateValue: string) {
    if (!dateValue) return "";

    const directMatch = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (directMatch) {
        return `${directMatch[1]}-${directMatch[2]}-${directMatch[3]}`;
    }

    const parsed = new Date(dateValue);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
    }

    return dateValue;
}

function buildPlayerLookups(
    homeSkaters: HistoricalGameSkaterRow[],
    awaySkaters: HistoricalGameSkaterRow[],
    homeGoalies: HistoricalGameGoalieRow[],
    awayGoalies: HistoricalGameGoalieRow[],
    homeTeam: HistoricalGameDetailTeam,
    awayTeam: HistoricalGameDetailTeam
) {
    const playerNameById = new Map<number, string>();
    const playerTeamById = new Map<number, number | null>();

    for (const row of homeSkaters) {
        playerNameById.set(row.playerId, row.name);
        playerTeamById.set(row.playerId, homeTeam.id);
    }

    for (const row of awaySkaters) {
        playerNameById.set(row.playerId, row.name);
        playerTeamById.set(row.playerId, awayTeam.id);
    }

    for (const row of homeGoalies) {
        playerNameById.set(row.playerId, row.name);
        playerTeamById.set(row.playerId, homeTeam.id);
    }

    for (const row of awayGoalies) {
        playerNameById.set(row.playerId, row.name);
        playerTeamById.set(row.playerId, awayTeam.id);
    }

    return {
        playerNameById,
        playerTeamById,
    };
}

function emptyStatsRow(): HistoricalGameTeamStatsRow {
    return {
        shotsOnGoal: 0,
        shotAttempts: 0,
        goals: 0,
        hits: 0,
        blockedShots: 0,
        penaltyMinutes: 0,
        powerPlayGoals: 0,
    };
}

function createTeamStats(
    homeTeam: HistoricalGameDetailTeam,
    awayTeam: HistoricalGameDetailTeam
): TeamStatsMap {
    const periods: GameDetailPeriodKey[] = ["ALL", "1", "2", "3", "OT"];
    const stats = {} as TeamStatsMap;

    for (const period of periods) {
        stats[period] = {
            [homeTeam.abbrev]: emptyStatsRow(),
            [awayTeam.abbrev]: emptyStatsRow(),
        };
    }

    return stats;
}

function periodKeyOf(play: ApiPlay): GameDetailPeriodKey {
    const periodType = asString(play.periodDescriptor?.periodType).toUpperCase();
    const periodNumber = asNumber(play.periodDescriptor?.number);

    if (periodType === "OT" || periodType === "SO" || periodNumber > 3) {
        return "OT";
    }

    if (periodNumber === 1 || periodNumber === 2 || periodNumber === 3) {
        return String(periodNumber) as GameDetailPeriodKey;
    }

    return "ALL";
}

function strengthFromSituationCode(
    situationCode: string,
    isHomeTeamEvent: boolean
) {
    if (!situationCode || situationCode.length < 4) return null;

    const awaySkaters = Number(situationCode[1]);
    const homeSkaters = Number(situationCode[2]);

    if (!Number.isFinite(awaySkaters) || !Number.isFinite(homeSkaters)) {
        return null;
    }

    const teamSkaters = isHomeTeamEvent ? homeSkaters : awaySkaters;
    const opponentSkaters = isHomeTeamEvent ? awaySkaters : homeSkaters;

    if (teamSkaters > opponentSkaters) return "Power play";
    if (teamSkaters < opponentSkaters) return "Shorthanded";
    return "Even strength";
}

function isPowerPlayForTeam(
    situationCode: string,
    isHomeTeamEvent: boolean
) {
    if (!situationCode || situationCode.length < 4) return false;

    const awaySkaters = Number(situationCode[1]);
    const homeSkaters = Number(situationCode[2]);

    if (!Number.isFinite(awaySkaters) || !Number.isFinite(homeSkaters)) {
        return false;
    }

    return isHomeTeamEvent
        ? homeSkaters > awaySkaters
        : awaySkaters > homeSkaters;
}

function inferTeamIdFromPlay(
    play: ApiPlay,
    playerTeamById: Map<number, number | null>
) {
    const explicitTeamId = asNullableNumber(play.details?.eventOwnerTeamId);
    if (explicitTeamId != null) return explicitTeamId;

    const candidatePlayerIds = [
        asNullableNumber(play.details?.shootingPlayerId),
        asNullableNumber(play.details?.scoringPlayerId),
        asNullableNumber(play.details?.hittingPlayerId),
        asNullableNumber(play.details?.playerId),
    ];

    for (const playerId of candidatePlayerIds) {
        if (playerId == null) continue;
        if (playerTeamById.has(playerId)) {
            return playerTeamById.get(playerId) ?? null;
        }
    }

    return null;
}

function inferBlockingTeamId(
    play: ApiPlay,
    playerTeamById: Map<number, number | null>,
    homeTeam: HistoricalGameDetailTeam,
    awayTeam: HistoricalGameDetailTeam
) {
    const blockingPlayerId = asNullableNumber(play.details?.blockingPlayerId);

    if (blockingPlayerId != null && playerTeamById.has(blockingPlayerId)) {
        return playerTeamById.get(blockingPlayerId) ?? null;
    }

    const shooterTeamId = inferTeamIdFromPlay(play, playerTeamById);
    if (shooterTeamId == null) return null;

    if (homeTeam.id != null && shooterTeamId === homeTeam.id) {
        return awayTeam.id;
    }

    if (awayTeam.id != null && shooterTeamId === awayTeam.id) {
        return homeTeam.id;
    }

    return null;
}

function xCoordToRinkY(xCoord: number) {
    const clamped = Math.max(
        OFFENSIVE_ZONE_BLUE_LINE_X,
        Math.min(OFFENSIVE_ZONE_GOAL_LINE_X, Math.abs(xCoord))
    );
    const span = OFFENSIVE_ZONE_GOAL_LINE_X - OFFENSIVE_ZONE_BLUE_LINE_X;
    const ratio = (clamped - OFFENSIVE_ZONE_BLUE_LINE_X) / span;
    return 70 - ratio * 59;
}

function yCoordToRinkX(yCoord: number) {
    const clamped = Math.max(-42.5, Math.min(42.5, yCoord));
    const ratio = (clamped + 42.5) / 85;
    return 2 + ratio * 81;
}

function formatScoreAfter(
    play: ApiPlay,
    homeTeam: HistoricalGameDetailTeam,
    awayTeam: HistoricalGameDetailTeam
) {
    const awayScore = asNullableNumber(play.details?.awayScore);
    const homeScore = asNullableNumber(play.details?.homeScore);

    if (awayScore == null || homeScore == null) {
        return `${awayTeam.abbrev} ${awayTeam.score} · ${homeTeam.abbrev} ${homeTeam.score}`;
    }

    return `${awayTeam.abbrev} ${awayScore} · ${homeTeam.abbrev} ${homeScore}`;
}

function addStat(
    stats: TeamStatsMap,
    period: GameDetailPeriodKey,
    teamAbbrev: string,
    key: keyof HistoricalGameTeamStatsRow,
    value: number
) {
    stats.ALL[teamAbbrev][key] += value;

    if (period !== "ALL") {
        stats[period][teamAbbrev][key] += value;
    }
}

function buildChartAndStats(
    plays: ApiPlay[],
    homeTeam: HistoricalGameDetailTeam,
    awayTeam: HistoricalGameDetailTeam,
    playerNameById: Map<number, string>,
    playerTeamById: Map<number, number | null>
) {
    const chartEvents: HistoricalGameShotEvent[] = [];
    const scoringEvents: HistoricalGameGoalEvent[] = [];
    const teamStats = createTeamStats(homeTeam, awayTeam);

    const teamAbbrevById = new Map<number, string>();
    if (homeTeam.id != null) teamAbbrevById.set(homeTeam.id, homeTeam.abbrev);
    if (awayTeam.id != null) teamAbbrevById.set(awayTeam.id, awayTeam.abbrev);

    for (const play of plays) {
        const playType = asString(play.typeDescKey).toLowerCase();
        const period = periodKeyOf(play);
        const periodNumber = asNumber(play.periodDescriptor?.number);

        if (playType === "hit") {
            const hitTeamId = inferTeamIdFromPlay(play, playerTeamById);
            const hitTeamAbbrev =
                hitTeamId != null ? teamAbbrevById.get(hitTeamId) ?? "" : "";

            if (hitTeamAbbrev) {
                addStat(teamStats, period, hitTeamAbbrev, "hits", 1);
            }

            continue;
        }

        if (playType === "penalty") {
            const penalisedTeamId = inferTeamIdFromPlay(play, playerTeamById);
            const penalisedTeamAbbrev =
                penalisedTeamId != null
                    ? teamAbbrevById.get(penalisedTeamId) ?? ""
                    : "";

            if (penalisedTeamAbbrev) {
                addStat(
                    teamStats,
                    period,
                    penalisedTeamAbbrev,
                    "penaltyMinutes",
                    asNumber(play.details?.duration)
                );
            }

            continue;
        }

        if (
            playType !== "shot-on-goal" &&
            playType !== "missed-shot" &&
            playType !== "blocked-shot" &&
            playType !== "goal"
        ) {
            continue;
        }

        const rawX = asNullableNumber(play.details?.xCoord);
        const rawY = asNullableNumber(play.details?.yCoord);
        const ownerTeamId = inferTeamIdFromPlay(play, playerTeamById);
        const teamAbbrev =
            ownerTeamId != null ? teamAbbrevById.get(ownerTeamId) ?? "" : "";

        if (!teamAbbrev) continue;

        const isHomeTeamEvent =
            homeTeam.id != null && ownerTeamId === homeTeam.id;
        const playerId =
            playType === "goal"
                ? asNullableNumber(play.details?.scoringPlayerId)
                : asNullableNumber(play.details?.shootingPlayerId);
        const playerName =
            playerId != null && playerNameById.has(playerId)
                ? playerNameById.get(playerId) ?? `Player ${playerId}`
                : `Player ${playerId ?? ""}`.trim();
        const strength = strengthFromSituationCode(
            asString(play.details?.situationCode),
            isHomeTeamEvent
        );
        const shotType = asString(play.details?.shotType) || null;

        addStat(teamStats, period, teamAbbrev, "shotAttempts", 1);

        if (playType === "shot-on-goal" || playType === "goal") {
            addStat(teamStats, period, teamAbbrev, "shotsOnGoal", 1);
        }

        if (playType === "goal") {
            addStat(teamStats, period, teamAbbrev, "goals", 1);

            if (
                isPowerPlayForTeam(
                    asString(play.details?.situationCode),
                    isHomeTeamEvent
                )
            ) {
                addStat(teamStats, period, teamAbbrev, "powerPlayGoals", 1);
            }
        }

        if (playType === "blocked-shot") {
            const blockingTeamId = inferBlockingTeamId(
                play,
                playerTeamById,
                homeTeam,
                awayTeam
            );
            const blockingTeamAbbrev =
                blockingTeamId != null
                    ? teamAbbrevById.get(blockingTeamId) ?? ""
                    : "";

            if (blockingTeamAbbrev) {
                addStat(teamStats, period, blockingTeamAbbrev, "blockedShots", 1);
            }
        }

        if (rawX != null && rawY != null) {
            const eventId = String(
                play.eventId ?? `${period}-${play.timeInPeriod}-${chartEvents.length}`
            );
            const descriptionParts = [
                playerName || teamAbbrev,
                playType === "goal" ? "goal" : playType.replace(/-/g, " "),
                shotType,
                play.timeInPeriod,
            ].filter(Boolean);

            chartEvents.push({
                eventId,
                teamId: ownerTeamId,
                teamAbbrev,
                playerId,
                playerName,
                type: playType as ShotEventType,
                mode: playType === "goal" ? "goals" : "shots",
                period,
                periodNumber,
                timeInPeriod: asString(play.timeInPeriod) || "00:00",
                shotType,
                strength,
                rinkX: Number(yCoordToRinkX(rawY).toFixed(2)),
                rinkY: Number(xCoordToRinkY(rawX).toFixed(2)),
                description: descriptionParts.join(" · "),
            });
        }

        if (playType === "goal") {
            scoringEvents.push({
                eventId: String(play.eventId ?? scoringEvents.length),
                teamId: ownerTeamId,
                teamAbbrev,
                playerName,
                period,
                periodNumber,
                timeInPeriod: asString(play.timeInPeriod) || "00:00",
                scoreAfter: formatScoreAfter(play, homeTeam, awayTeam),
                strength,
                description: [playerName, strength, shotType]
                    .filter(Boolean)
                    .join(" · "),
            });
        }
    }

    return {
        chartEvents,
        scoringEvents,
        teamStats,
    };
}

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ gameId: string }> }
) {
    try {
        const { gameId: rawGameId } = await params;
        const gameId = asString(rawGameId);
        const numericGameId = Number(gameId);

        if (!gameId || !Number.isFinite(numericGameId)) {
            return NextResponse.json({ error: "Invalid game id" }, { status: 400 });
        }

        const [box, pbp] = await Promise.all([
            fetchJsonWithRetry<ApiBoxscore>(
                `https://api-web.nhle.com/v1/gamecenter/${numericGameId}/boxscore`
            ),
            fetchJsonWithRetry<ApiPlayByPlay>(
                `https://api-web.nhle.com/v1/gamecenter/${numericGameId}/play-by-play`
            ),
        ]);

        const homeTeam = toTeamPayload(box.homeTeam);
        const awayTeam = toTeamPayload(box.awayTeam);

        if (!homeTeam.abbrev || !awayTeam.abbrev) {
            return NextResponse.json(
                { error: "Could not determine teams for this game" },
                { status: 500 }
            );
        }

        const homeForwards = buildSkaterRows(
            box.playerByGameStats?.homeTeam?.forwards ?? []
        );
        const awayForwards = buildSkaterRows(
            box.playerByGameStats?.awayTeam?.forwards ?? []
        );

        const homeDefencemen = buildSkaterRows([
            ...(box.playerByGameStats?.homeTeam?.defense ?? []),
            ...(box.playerByGameStats?.homeTeam?.defence ?? []),
            ...(box.playerByGameStats?.homeTeam?.defensemen ?? []),
        ]);

        const awayDefencemen = buildSkaterRows([
            ...(box.playerByGameStats?.awayTeam?.defense ?? []),
            ...(box.playerByGameStats?.awayTeam?.defence ?? []),
            ...(box.playerByGameStats?.awayTeam?.defensemen ?? []),
        ]);

        const homeSkaters = [...homeForwards, ...homeDefencemen].sort((left, right) => {
            if (right.points !== left.points) return right.points - left.points;
            if (right.goals !== left.goals) return right.goals - left.goals;
            return left.name.localeCompare(right.name);
        });

        const awaySkaters = [...awayForwards, ...awayDefencemen].sort((left, right) => {
            if (right.points !== left.points) return right.points - left.points;
            if (right.goals !== left.goals) return right.goals - left.goals;
            return left.name.localeCompare(right.name);
        });

        const homeGoalies = buildGoalieRows(
            box.playerByGameStats?.homeTeam?.goalies ?? []
        );
        const awayGoalies = buildGoalieRows(
            box.playerByGameStats?.awayTeam?.goalies ?? []
        );

        const { playerNameById, playerTeamById } = buildPlayerLookups(
            homeSkaters,
            awaySkaters,
            homeGoalies,
            awayGoalies,
            homeTeam,
            awayTeam
        );

        const { chartEvents, scoringEvents, teamStats: baseTeamStats } = buildChartAndStats(
            pbp.plays ?? [],
            homeTeam,
            awayTeam,
            playerNameById,
            playerTeamById
        );

        const teamStats = baseTeamStats;

        const payload: HistoricalGameDetailResponse = {
            gameId,
            gameDate: normaliseDate(asString(box.gameDate)),
            startTimeUtc: asString(box.startTimeUTC) || null,
            venueName: nameOf(box.venue) || null,
            decision: formatDecision(box),
            homeTeam,
            awayTeam,
            playerStats: {
                home: {
                    skaters: homeSkaters,
                    forwards: homeForwards,
                    defencemen: homeDefencemen,
                    goalies: homeGoalies,
                },
                away: {
                    skaters: awaySkaters,
                    forwards: awayForwards,
                    defencemen: awayDefencemen,
                    goalies: awayGoalies,
                },
            },
            chartEvents,
            scoringEvents,
            teamStats,
        };

        return NextResponse.json(payload);
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : "Could not load game detail";

        return NextResponse.json({ error: message }, { status: 500 });
    }
}