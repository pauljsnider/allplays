import { discoverPublicTeams, getPublicTeamProfile, getPublicTeamRosterCount, type PublicTeamRosterCount } from './adapters/legacyPublicTeamsDb';
import { type ParentHomeTeam } from './homeLogic';

const PUBLIC_ROSTER_COUNT_CONCURRENCY = 6;
const SINGLE_SHOT_PUBLIC_TEAM_PAGE_REQUEST_LIMIT = 2;

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
};

function normalizePublicTeamSearchText(value: string | null | undefined): string {
    return String(value || '').trim().toLowerCase();
}

function teamLocation(team: { city?: string | null; state?: string | null; zip?: string | null }): string | null {
    if (team.city && team.state) return `${team.city}, ${team.state}`;
    if (team.zip) return team.zip;
    return null;
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
        unreadCount: 0,
        openActions: 0,
    };
}

async function mapPublicTeamsWithRosterCounts(teams: PublicTeamSearchResult[]): Promise<ParentHomeTeam[]> {
    const mappedTeams: ParentHomeTeam[] = [];

    for (let index = 0; index < teams.length; index += PUBLIC_ROSTER_COUNT_CONCURRENCY) {
        const teamBatch = teams.slice(index, index + PUBLIC_ROSTER_COUNT_CONCURRENCY);
        const mappedBatch = await Promise.all(teamBatch.map(async (team) => {
            try {
                const rosterCount = await getPublicTeamRosterCount(team.id);
                return mapPublicTeam(team, rosterCount);
            } catch {
                // A legacy roster can contain a document that is not publicly
                // readable. Preserve that boundary and omit the count instead
                // of falling back to fetching roster records or showing zero.
                return mapPublicTeam(team, null);
            }
        }));
        mappedTeams.push(...mappedBatch);
    }

    return mappedTeams;
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

    if (/^[a-z]{2}$/.test(normalizedSearchText)) {
        return normalizedState === normalizedSearchText;
    }

    if (teamFields.some((field) => field.includes(normalizedSearchText))) {
        return true;
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
    const teams = includeRosterCounts
        ? await mapPublicTeamsWithRosterCounts(matchingTeams)
        : matchingTeams.map((team: PublicTeamSearchResult) => mapPublicTeam(team, null));

    return {
        teams,
        nextCursor: result.nextCursor || null
    };
}

export async function getBoundedPublicTeamSearchPage({
    searchText,
    locationFilter,
    cursor: initialCursor = null,
    pageSize = 24,
    includeRosterCounts = true
}: PublicTeamsPageOptions = {}): Promise<PublicTeamsPage> {
    const rawResultLimit = Number(pageSize);
    const resultLimit = Number.isFinite(rawResultLimit)
        ? Math.min(Math.max(Math.floor(rawResultLimit), 1), 100)
        : 24;
    const teamsById = new Map<string, ParentHomeTeam>();
    const seenCursors = new Set<string>();
    let cursor: unknown | null = initialCursor;
    if (cursor) seenCursors.add(JSON.stringify(cursor));

    for (let requestCount = 0;
        requestCount < SINGLE_SHOT_PUBLIC_TEAM_PAGE_REQUEST_LIMIT && teamsById.size < resultLimit;
        requestCount += 1) {
        const page = await getPublicTeamsPage({
            searchText,
            locationFilter,
            cursor,
            pageSize: resultLimit - teamsById.size,
            includeRosterCounts
        });
        page.teams.forEach((team) => teamsById.set(team.teamId, team));
        cursor = page.nextCursor || null;
        if (!cursor || teamsById.size >= resultLimit) break;
        const cursorKey = JSON.stringify(cursor);
        if (seenCursors.has(cursorKey)) {
            throw new Error('Public team search returned a repeated cursor.');
        }
        seenCursors.add(cursorKey);
    }

    return {
        teams: Array.from(teamsById.values()),
        nextCursor: teamsById.size < resultLimit ? cursor : null
    };
}

export async function getPublicTeamsByLocation(locationFilter?: string): Promise<ParentHomeTeam[]> {
    const page = await getBoundedPublicTeamSearchPage({ searchText: locationFilter });
    if (page.nextCursor) {
        throw new Error('Public team location search is incomplete; use paged discovery to continue.');
    }
    return page.teams;
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
        location: teamLocation(team)
    };
}
