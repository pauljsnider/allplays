import { discoverPublicTeams, getPublicTeamRosterCount, type PublicTeamRosterCount } from './adapters/legacyPublicTeamsDb';
import { type ParentHomeTeam } from './homeLogic';

const PUBLIC_ROSTER_COUNT_CONCURRENCY = 6;

export type PublicTeamsPage = {
    teams: ParentHomeTeam[];
    nextCursor: unknown | null;
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

    if (teamFields.some((field) => field.includes(normalizedSearchText))) {
        return true;
    }

    if (/^[a-z]{2}$/.test(normalizedSearchText)) {
        return normalizedState === normalizedSearchText;
    }

    return searchTokens.every((token) => combinedFields.includes(token));
}

export async function getPublicTeamsPage({ searchText, locationFilter, cursor = null, pageSize = 24 }: { searchText?: string; locationFilter?: string; cursor?: unknown | null; pageSize?: number } = {}): Promise<PublicTeamsPage> {
    const normalizedSearchText = String(searchText ?? locationFilter ?? '').trim();
    const result = await discoverPublicTeams({
        searchText: normalizedSearchText,
        cursor,
        pageSize
    });
    const matchingTeams = result.teams
        .filter((team: { name?: string | null; city?: string | null; state?: string | null; zip?: string | null }) => matchesPublicTeamSearch(team, normalizedSearchText));
    const teams = await mapPublicTeamsWithRosterCounts(matchingTeams);

    return {
        teams,
        nextCursor: result.nextCursor || null
    };
}

export async function getPublicTeamsByLocation(locationFilter?: string): Promise<ParentHomeTeam[]> {
    const result = await getPublicTeamsPage({ searchText: locationFilter });
    return result.teams;
}
