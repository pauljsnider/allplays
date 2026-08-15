import { discoverPublicTeams, getPublicLeagueStandingsProjection, getPublicTeamGamesProjection, getPublicTeamProfile, getPublicTeamRosterCount, type PublicLeagueStandingsGame, type PublicTeamRosterCount } from './adapters/legacyPublicTeamsDb';
import { computeNativeStandings } from './adapters/legacyPublicStandings';
import { type ParentHomeTeam } from './homeLogic';

const PUBLIC_ROSTER_COUNT_CONCURRENCY = 6;
let activePublicRosterCountRequests = 0;
type PendingPublicRosterCountRequest = {
    run: () => void;
    reject: (reason: unknown) => void;
    signal?: AbortSignal;
    abortListener?: () => void;
};
const pendingPublicRosterCountRequests: PendingPublicRosterCountRequest[] = [];

function publicRosterCountAbortError(): Error {
    const error = new Error('Public team roster-count hydration was canceled.');
    error.name = 'AbortError';
    return error;
}

function runNextPublicRosterCountRequests(): void {
    while (activePublicRosterCountRequests < PUBLIC_ROSTER_COUNT_CONCURRENCY) {
        const pendingRequest = pendingPublicRosterCountRequests.shift();
        if (!pendingRequest) return;
        if (pendingRequest.abortListener) {
            pendingRequest.signal?.removeEventListener('abort', pendingRequest.abortListener);
        }
        if (pendingRequest.signal?.aborted) {
            pendingRequest.reject(publicRosterCountAbortError());
            continue;
        }
        pendingRequest.run();
    }
}

function getBoundedPublicTeamRosterCount(teamId: string, signal?: AbortSignal): Promise<PublicTeamRosterCount> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(publicRosterCountAbortError());
            return;
        }

        const runRequest = () => {
            activePublicRosterCountRequests += 1;
            void getPublicTeamRosterCount(teamId)
                .then(resolve, reject)
                .finally(() => {
                    activePublicRosterCountRequests -= 1;
                    runNextPublicRosterCountRequests();
                });
        };

        if (activePublicRosterCountRequests < PUBLIC_ROSTER_COUNT_CONCURRENCY) {
            runRequest();
        } else {
            const pendingRequest: PendingPublicRosterCountRequest = { run: runRequest, reject, signal };
            if (signal) {
                pendingRequest.abortListener = () => {
                    const pendingIndex = pendingPublicRosterCountRequests.indexOf(pendingRequest);
                    if (pendingIndex === -1) return;
                    pendingPublicRosterCountRequests.splice(pendingIndex, 1);
                    reject(publicRosterCountAbortError());
                };
                signal.addEventListener('abort', pendingRequest.abortListener, { once: true });
            }
            pendingPublicRosterCountRequests.push(pendingRequest);
        }
    });
}

export type PublicTeamsPage = {
    teams: ParentHomeTeam[];
    nextCursor: unknown | null;
};

type PublicTeamsPageOptions = {
    searchText?: string;
    locationFilter?: string;
    cursor?: unknown | null;
    pageSize?: number;
    includeRosterCounts?: boolean;
};

export type PublicTeamProfile = {
    id: string;
    name: string;
    sport: string | null;
    description: string | null;
    photoUrl: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    location: string | null;
    leagueUrl: string | null;
    standingsConfig: PublicStandingsConfig | null;
};

export type PublicStandingsConfig = {
    enabled: boolean;
    rankingMode: 'points' | 'win_pct';
    points: { win: number | null; tie: number | null; loss: number | null } | null;
    maxGoalDiff: number | null;
    tiebreakers: string[];
    twoTeamTiebreakers: string[];
    multiTeamTiebreakers: string[];
    seasonLabel: string | null;
    seasonStart: string | null;
    seasonEnd: string | null;
    leagueTeamIds: string[];
};

export type PublicTeamRecentResult = {
    id: string;
    date: Date;
    opponent: string;
    teamScore: number;
    opponentScore: number;
    result: 'Win' | 'Loss' | 'Tie';
};

export type PublicTeamResults = {
    standings: {
        enabled: boolean;
        label: string;
        rows: PublicStandingsRow[];
        currentRow: PublicStandingsRow | null;
    };
    recentResults: PublicTeamRecentResult[];
};

export type PublicStandingsRow = Record<string, unknown> & {
    teamId: string;
    team: string;
    isCurrentTeam: boolean;
};

const PUBLIC_RESULTS_LIMIT = 5;
const PUBLIC_RESULTS_PROJECTION_LIMIT = 500;

function normalizePublicTeamSearchText(value: string | null | undefined): string {
    return String(value || '').trim().toLowerCase();
}

function teamLocation(team: { city?: string | null; state?: string | null; zip?: string | null }): string | null {
    if (team.city && team.state) return `${team.city}, ${team.state}`;
    if (team.zip) return team.zip;
    return null;
}

function publicHttpUrl(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const url = new URL(value.trim());
        return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
            ? url.toString()
            : null;
    } catch {
        return null;
    }
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function publicStringList(value: unknown, maxItems = 20): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, maxItems);
}

function publicDateOnly(value: unknown): string | null {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function normalizeStandingsConfig(value: unknown): PublicStandingsConfig | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const config = value as Record<string, unknown>;
    const rawPoints = config.points && typeof config.points === 'object' && !Array.isArray(config.points)
        ? config.points as Record<string, unknown>
        : null;
    const maxGoalDiff = finiteNumber(config.maxGoalDiff);
    return {
        enabled: config.enabled === true,
        rankingMode: config.rankingMode === 'win_pct' ? 'win_pct' : 'points',
        points: rawPoints ? {
            win: finiteNumber(rawPoints.win),
            tie: finiteNumber(rawPoints.tie),
            loss: finiteNumber(rawPoints.loss)
        } : null,
        maxGoalDiff: maxGoalDiff !== null && maxGoalDiff > 0 ? maxGoalDiff : null,
        tiebreakers: publicStringList(config.tiebreakers),
        twoTeamTiebreakers: publicStringList(config.twoTeamTiebreakers),
        multiTeamTiebreakers: publicStringList(config.multiTeamTiebreakers),
        seasonLabel: typeof config.seasonLabel === 'string' && config.seasonLabel.trim()
            ? config.seasonLabel.trim().slice(0, 100)
            : null,
        seasonStart: publicDateOnly(config.seasonStart),
        seasonEnd: publicDateOnly(config.seasonEnd),
        leagueTeamIds: publicStringList(config.leagueTeamIds, 32)
    };
}

function shiftUtcYear(date: Date, yearOffset: number): Date {
    const shifted = new Date(date.getTime());
    const month = shifted.getUTCMonth();
    const day = shifted.getUTCDate();
    shifted.setUTCDate(1);
    shifted.setUTCFullYear(shifted.getUTCFullYear() + yearOffset);
    shifted.setUTCMonth(month);
    const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), month + 1, 0)).getUTCDate();
    shifted.setUTCDate(Math.min(day, lastDay));
    return shifted;
}

type NormalizedPublicFinal = PublicTeamRecentResult;

function normalizePublicFinal(value: unknown): NormalizedPublicFinal | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const game = value as Record<string, unknown>;
    if (game.type && String(game.type).toLowerCase() !== 'game') return null;
    if (String(game.visibility || '').toLowerCase() === 'private' || game.isPrivate === true || game.private === true || game.deleted === true) return null;
    if (String(game.status || '').toLowerCase() !== 'completed') return null;
    if (game.liveStatus && !['completed', 'final'].includes(String(game.liveStatus).toLowerCase())) return null;
    const teamScore = finiteNumber(game.teamScore);
    const opponentScore = finiteNumber(game.opponentScore);
    if (teamScore === null || opponentScore === null || teamScore < 0 || opponentScore < 0) return null;
    const date = new Date(String(game.startsAt || ''));
    if (Number.isNaN(date.getTime())) return null;
    const opponent = String(game.opponent || '').trim();
    if (!opponent) return null;
    return {
        id: String(game.id || ''),
        date,
        opponent,
        teamScore,
        opponentScore,
        result: teamScore > opponentScore ? 'Win' : teamScore < opponentScore ? 'Loss' : 'Tie'
    };
}

function normalizePublicLeagueFinal(value: PublicLeagueStandingsGame): Record<string, unknown> | null {
    const homeTeam = typeof value.homeTeam === 'string' ? value.homeTeam.trim() : '';
    const awayTeam = typeof value.awayTeam === 'string' ? value.awayTeam.trim() : '';
    const homeTeamId = typeof value.homeTeamId === 'string' ? value.homeTeamId.trim() : '';
    const awayTeamId = typeof value.awayTeamId === 'string' ? value.awayTeamId.trim() : '';
    const homeScore = finiteNumber(value.homeScore);
    const awayScore = finiteNumber(value.awayScore);
    const startsAt = new Date(String(value.startsAt || ''));
    if (String(value.status || '').toLowerCase() !== 'completed' || value.countsTowardSeasonRecord === false) return null;
    if (!homeTeam || !awayTeam || homeScore === null || awayScore === null || homeScore < 0 || awayScore < 0 || Number.isNaN(startsAt.getTime())) return null;
    return {
        homeTeam: homeTeamId || homeTeam,
        awayTeam: awayTeamId || awayTeam,
        homeTeamName: homeTeam,
        awayTeamName: awayTeam,
        homeScore,
        awayScore,
        status: 'completed',
        startsAt: startsAt.toISOString()
    };
}

function hasCompletePublicStandingsConfig(config: PublicStandingsConfig | null): config is PublicStandingsConfig & {
    seasonStart: string;
    seasonEnd: string;
} {
    return Boolean(
        config?.enabled &&
        config.seasonStart &&
        config.seasonEnd &&
        config.seasonStart <= config.seasonEnd &&
        config.leagueTeamIds.length
    );
}

type PublicTeamSearchResult = {
    id: string;
    name: string;
    sport?: string | null;
    photoUrl?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    appAccess?: boolean;
    webAccess?: boolean;
    isPublic?: boolean;
};

function mapPublicTeam(team: PublicTeamSearchResult, rosterCount: PublicTeamRosterCount | null): ParentHomeTeam {
    return {
        teamId: team.id,
        teamName: team.name,
        role: 'Public',
        sport: team.sport ?? null,
        photoUrl: team.photoUrl ?? null,
        location: teamLocation(team),
        city: team.city ?? null,
        state: team.state ?? null,
        zip: team.zip ?? null,
        appAccess: team.appAccess ?? false,
        webAccess: team.webAccess ?? true,
        isPublic: true,
        publicRosterCount: rosterCount?.count ?? null,
        publicRosterCountCapped: rosterCount?.isCapped ?? false,
        players: [],
        nextEvent: null,
        eventCount: 0,
        upcomingEventCount: 0,
        unreadCount: 0,
        openActions: 0,
    };
}

export async function hydratePublicTeamRosterCounts(teams: ParentHomeTeam[], { signal }: { signal?: AbortSignal } = {}): Promise<ParentHomeTeam[]> {
    const hydratedTeams: ParentHomeTeam[] = [];

    for (let index = 0; index < teams.length; index += PUBLIC_ROSTER_COUNT_CONCURRENCY) {
        if (signal?.aborted) return teams;
        const teamBatch = teams.slice(index, index + PUBLIC_ROSTER_COUNT_CONCURRENCY);
        let mappedBatch: ParentHomeTeam[];
        try {
            mappedBatch = await Promise.all(teamBatch.map(async (team) => {
                try {
                    const rosterCount = await getBoundedPublicTeamRosterCount(team.teamId, signal);
                    if (signal?.aborted) throw publicRosterCountAbortError();
                    return {
                        ...team,
                        publicRosterCount: rosterCount.count,
                        publicRosterCountCapped: rosterCount.isCapped
                    };
                } catch (error) {
                    if (signal?.aborted) throw error;
                    // A legacy roster can contain a document that is not publicly
                    // readable. Preserve that boundary and omit the count instead
                    // of falling back to fetching roster records or showing zero.
                    return {
                        ...team,
                        publicRosterCount: null,
                        publicRosterCountCapped: false
                    };
                }
            }));
        } catch (error) {
            if (signal?.aborted) return teams;
            throw error;
        }
        hydratedTeams.push(...mappedBatch);
    }

    return hydratedTeams;
}

function matchesPublicTeamSearch(team: { name?: string | null; city?: string | null; state?: string | null; zip?: string | null }, searchText: string): boolean {
    const normalizedSearchText = normalizePublicTeamSearchText(searchText);
    if (!normalizedSearchText) {
        return true;
    }

    const normalizedName = normalizePublicTeamSearchText(team.name);
    const normalizedCity = normalizePublicTeamSearchText(team.city);
    const normalizedState = String(team.state || '').trim().toLowerCase();
    const normalizedZip = String(team.zip || '').trim();
    const location = normalizePublicTeamSearchText(teamLocation(team) || '');
    const searchTokens = normalizedSearchText.split(/[\s,]+/).filter(Boolean);
    const teamFields = [normalizedName, normalizedCity, normalizedState, normalizedZip, location].filter(Boolean);
    const combinedFields = teamFields.join(' ');

    if (/^\d{1,5}$/.test(normalizedSearchText)) {
        return normalizedZip.startsWith(normalizedSearchText);
    }

    if (teamFields.some((field) => field.includes(normalizedSearchText))) {
        return true;
    }

    if (/^[a-z]{2}$/.test(normalizedSearchText)) {
        return normalizedState === normalizedSearchText;
    }

    return searchTokens.every((token) => combinedFields.includes(token));
}

export async function getPublicTeamsPage({ searchText, locationFilter, cursor = null, pageSize = 24, includeRosterCounts = true }: PublicTeamsPageOptions = {}): Promise<PublicTeamsPage> {
    const normalizedSearchText = String(searchText ?? locationFilter ?? '').trim();
    const result = await discoverPublicTeams({
        searchText: normalizedSearchText,
        cursor,
        pageSize
    });
    const matchingTeams = result.teams
        .filter((team: { name?: string | null; city?: string | null; state?: string | null; zip?: string | null }) => matchesPublicTeamSearch(team, normalizedSearchText));
    const lightweightTeams = matchingTeams.map((team: PublicTeamSearchResult) => mapPublicTeam(team, null));
    const teams = includeRosterCounts
        ? await hydratePublicTeamRosterCounts(lightweightTeams)
        : lightweightTeams;

    return {
        teams,
        nextCursor: result.nextCursor || null
    };
}

export async function getPublicTeamsByLocation(locationFilter?: string): Promise<ParentHomeTeam[]> {
    const result = await getPublicTeamsPage({ searchText: locationFilter });
    return result.teams;
}

export async function getPublicTeamDetail(teamId: string): Promise<PublicTeamProfile> {
    const normalizedTeamId = String(teamId || '').trim();
    if (!normalizedTeamId) throw new Error('Team ID is required.');
    const team = await getPublicTeamProfile(normalizedTeamId);
    if (!team?.id || !team?.name) throw new Error('Public team not found.');
    return {
        id: String(team.id),
        name: String(team.name),
        sport: team.sport ? String(team.sport) : null,
        description: team.description ? String(team.description) : null,
        photoUrl: team.photoUrl ? String(team.photoUrl) : null,
        city: team.city ? String(team.city) : null,
        state: team.state ? String(team.state) : null,
        zip: team.zip ? String(team.zip) : null,
        location: teamLocation(team),
        leagueUrl: publicHttpUrl(team.leagueUrl),
        standingsConfig: normalizeStandingsConfig(team.standingsConfig)
    };
}

export async function getPublicTeamResults(team: PublicTeamProfile, now = new Date()): Promise<PublicTeamResults> {
    const standingsConfig = team.standingsConfig;
    const hasStandingsSource = hasCompletePublicStandingsConfig(standingsConfig);
    const from = hasStandingsSource ? standingsConfig.seasonStart : shiftUtcYear(now, -1).toISOString().slice(0, 10);
    const to = hasStandingsSource ? standingsConfig.seasonEnd : now.toISOString().slice(0, 10);
    const [projection, standingsProjection] = await Promise.all([
        getPublicTeamGamesProjection(team.id, {
            from,
            to,
            limit: PUBLIC_RESULTS_PROJECTION_LIMIT
        }),
        hasStandingsSource ? getPublicLeagueStandingsProjection(team.id) : Promise.resolve(null)
    ]);
    if (projection?.range?.truncated === true) {
        throw new Error('Unable to load complete public results. Please try again.');
    }

    const finals = (Array.isArray(projection?.games) ? projection.games : [])
        .map(normalizePublicFinal)
        .filter((game): game is NormalizedPublicFinal => game !== null);
    if (standingsProjection && (
        standingsProjection.range?.truncated === true ||
        standingsProjection.range?.from !== standingsConfig?.seasonStart ||
        standingsProjection.range?.to !== standingsConfig?.seasonEnd
    )) {
        throw new Error('Unable to load complete public standings. Please try again.');
    }
    const standingsGames = (Array.isArray(standingsProjection?.games) ? standingsProjection.games : [])
        .map(normalizePublicLeagueFinal)
        .filter((game): game is Record<string, unknown> => game !== null)
        .filter((game) => {
            const date = String(game.startsAt).slice(0, 10);
            return date >= String(standingsConfig?.seasonStart) && date <= String(standingsConfig?.seasonEnd);
        });
    const keyedRows = standingsConfig?.enabled && standingsProjection
        ? computeNativeStandings(standingsGames, standingsConfig as unknown as Record<string, unknown>)
        : [];
    const teamNamesByKey = new Map<string, string>();
    standingsGames.forEach((game) => {
        teamNamesByKey.set(String(game.homeTeam), String(game.homeTeamName));
        teamNamesByKey.set(String(game.awayTeam), String(game.awayTeamName));
    });
    const currentRowIndex = keyedRows.findIndex((row) => String(row?.team || '').trim() === team.id);
    const rows: PublicStandingsRow[] = keyedRows.map((row) => {
        const teamId = String(row?.team || '').trim();
        return {
            ...row,
            teamId,
            team: teamNamesByKey.get(teamId) || teamId,
            isCurrentTeam: teamId === team.id
        };
    });

    return {
        standings: {
            enabled: standingsConfig?.enabled === true,
            label: standingsConfig?.enabled
                ? (standingsConfig.rankingMode === 'win_pct' ? 'Win percentage' : 'Points table')
                : (team.leagueUrl ? 'League page configured' : 'No standings configured'),
            rows,
            currentRow: currentRowIndex >= 0 ? rows[currentRowIndex] : null
        },
        recentResults: finals
            .sort((left, right) => right.date.getTime() - left.date.getTime() || right.id.localeCompare(left.id))
            .slice(0, PUBLIC_RESULTS_LIMIT)
            .map(({ id, date, opponent, teamScore, opponentScore, result }) => ({
                id,
                date,
                opponent,
                teamScore,
                opponentScore,
                result
            }))
    };
}
