import { discoverPublicTeams, getPublicTeamGamesProjection, getPublicTeamProfile, getPublicTeamRosterCount, type PublicTeamProjectedGame, type PublicTeamRosterCount } from './adapters/legacyPublicTeamsDb';
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
    standings: PublicTeamStandings | null;
};

export type PublicTeamStandings = {
    label: string;
    rows: Array<Record<string, any>>;
    currentRow: Record<string, any> | null;
};

export type PublicStandingsConfig = {
    enabled: boolean;
    rankingMode: 'points' | 'win_pct';
    points: {
        win: number | null;
        tie: number | null;
        loss: number | null;
    } | null;
    maxGoalDiff: number | null;
    tiebreakers: string[];
    twoTeamTiebreakers: string[];
    multiTeamTiebreakers: string[];
};

export type PublicStandingsTournament = {
    divisionName?: string;
    division?: string;
    poolName?: string;
};

export type PublicTeamStandingsInput = {
    id: string;
    date: Date;
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    status: 'completed';
    tournament?: PublicStandingsTournament;
};

export type PublicTeamRecentResult = {
    id: string;
    date: Date;
    opponent: string;
    teamScore: number;
    opponentScore: number;
    result: 'win' | 'loss' | 'draw';
};

type NormalizedPublicCompletedGame = {
    standings: PublicTeamStandingsInput;
    recentResult: PublicTeamRecentResult;
};

const PUBLIC_TEAM_RECENT_RESULTS_LIMIT = 5;

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
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
            ? url.toString()
            : null;
    } catch {
        return null;
    }
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function publicStringList(value: unknown, maxItems = 20, maxLength = 40): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().slice(0, maxLength))
        .filter(Boolean)
        .slice(0, maxItems);
}

function normalizePublicStandingsConfig(value: unknown): PublicStandingsConfig | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const config = value as Record<string, unknown>;
    const points = config.points && typeof config.points === 'object' && !Array.isArray(config.points)
        ? config.points as Record<string, unknown>
        : null;
    const maxGoalDiff = finiteNumber(config.maxGoalDiff);
    return {
        enabled: config.enabled === true,
        rankingMode: config.rankingMode === 'win_pct' ? 'win_pct' : 'points',
        points: points ? {
            win: finiteNumber(points.win),
            tie: finiteNumber(points.tie),
            loss: finiteNumber(points.loss)
        } : null,
        maxGoalDiff: maxGoalDiff !== null && maxGoalDiff > 0 ? maxGoalDiff : null,
        tiebreakers: publicStringList(config.tiebreakers),
        twoTeamTiebreakers: publicStringList(config.twoTeamTiebreakers),
        multiTeamTiebreakers: publicStringList(config.multiTeamTiebreakers)
    };
}

function normalizePublicStandings(value: unknown): PublicTeamStandings | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const standings = value as Record<string, unknown>;
    const rows = Array.isArray(standings.rows)
        ? standings.rows.filter((row): row is Record<string, any> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
        : [];
    if (!rows.length) return null;
    const currentRow = standings.currentRow && typeof standings.currentRow === 'object' && !Array.isArray(standings.currentRow)
        ? standings.currentRow as Record<string, any>
        : null;
    return {
        label: typeof standings.label === 'string' ? standings.label : '',
        rows,
        currentRow
    };
}

function publicTournamentText(value: unknown): string {
    return typeof value === 'string' ? value.trim().slice(0, 160) : '';
}

function normalizePublicStandingsTournament(value: unknown): PublicStandingsTournament | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const tournament = value as Record<string, unknown>;
    const normalized: PublicStandingsTournament = {};
    const divisionName = publicTournamentText(tournament.divisionName);
    const division = publicTournamentText(tournament.division);
    const poolName = publicTournamentText(tournament.poolName);
    if (divisionName) normalized.divisionName = divisionName;
    if (division) normalized.division = division;
    if (poolName) normalized.poolName = poolName;
    return Object.keys(normalized).length ? normalized : null;
}

function normalizePublicCompletedGame(
    value: PublicTeamProjectedGame,
    teamId: string,
    teamName: string
): NormalizedPublicCompletedGame | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const status = String(value.status || '').trim().toLowerCase();
    const liveStatus = String(value.liveStatus || '').trim().toLowerCase();
    const type = String(value.type || '').trim().toLowerCase();
    const visibility = String(value.visibility || '').trim().toLowerCase();
    const completedStatuses = ['completed', 'complete', 'final', 'finished'];
    if (!completedStatuses.includes(status)) return null;
    if (liveStatus && !completedStatuses.includes(liveStatus)) return null;
    if (type && type !== 'game') return null;
    if (visibility === 'private' || value.isPrivate === true || value.private === true || value.deleted === true) return null;
    if (value.teamId && String(value.teamId).trim() !== teamId) return null;

    const id = String(value.id || '').trim();
    const opponent = String(value.opponent || '').trim();
    const teamScore = finiteNumber(value.teamScore);
    const opponentScore = finiteNumber(value.opponentScore);
    const date = new Date(String(value.startsAt || ''));
    if (!id || !teamName || !opponent || teamScore === null || opponentScore === null) return null;
    if (teamScore < 0 || opponentScore < 0 || Number.isNaN(date.getTime())) return null;

    const isHome = value.isHome !== false;
    const tournament = normalizePublicStandingsTournament(value.tournament);
    return {
        standings: {
            id,
            date,
            homeTeam: isHome ? teamName : opponent,
            awayTeam: isHome ? opponent : teamName,
            homeScore: isHome ? teamScore : opponentScore,
            awayScore: isHome ? opponentScore : teamScore,
            status: 'completed',
            ...(tournament ? { tournament } : {})
        },
        recentResult: {
            id,
            date,
            opponent,
            teamScore,
            opponentScore,
            result: teamScore > opponentScore ? 'win' : teamScore < opponentScore ? 'loss' : 'draw'
        }
    };
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
    const status = String(team?.status || '').trim().toLowerCase();
    if (String(team?.id || '').trim() !== normalizedTeamId || !team?.name || team.isPublic !== true || team.active === false || team.archived === true || ['archived', 'inactive', 'disabled'].includes(status)) {
        throw new Error('Public team not found.');
    }
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
        standingsConfig: normalizePublicStandingsConfig(team.standingsConfig),
        standings: normalizePublicStandings(team.standings)
    };
}

async function getNormalizedPublicCompletedGames(teamId: string): Promise<NormalizedPublicCompletedGame[]> {
    const normalizedTeamId = String(teamId || '').trim();
    if (!normalizedTeamId) throw new Error('Team ID is required.');
    const projection = await getPublicTeamGamesProjection(normalizedTeamId);
    const projectionTeamId = String(projection?.team?.id || '').trim();
    const teamName = String(projection?.team?.name || '').trim();
    if (projectionTeamId !== normalizedTeamId || !teamName) {
        throw new Error('Public team not found.');
    }
    return (Array.isArray(projection.games) ? projection.games : [])
        .map((game) => normalizePublicCompletedGame(game, normalizedTeamId, teamName))
        .filter((game): game is NormalizedPublicCompletedGame => game !== null);
}

export async function getPublicTeamStandingsInputs(teamId: string): Promise<PublicTeamStandingsInput[]> {
    return (await getNormalizedPublicCompletedGames(teamId)).map((game) => game.standings);
}

export async function getPublicTeamRecentResults(teamId: string): Promise<PublicTeamRecentResult[]> {
    return (await getNormalizedPublicCompletedGames(teamId))
        .map((game) => game.recentResult)
        .sort((left, right) => right.date.getTime() - left.date.getTime() || left.id.localeCompare(right.id))
        .slice(0, PUBLIC_TEAM_RECENT_RESULTS_LIMIT);
}
