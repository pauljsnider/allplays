import { discoverPublicTeams } from './adapters/legacyPublicTeamsDb';
import { type ParentHomeTeam } from './homeLogic';

export type PublicTeamsPage = {
    teams: ParentHomeTeam[];
    nextCursor: unknown | null;
};

function teamLocation(team: { city?: string; state?: string; zip?: string }): string | null {
    if (team.city && team.state) return `${team.city}, ${team.state}`;
    if (team.zip) return team.zip;
    return null;
}

function mapPublicTeam(team: { id: string; name: string; sport?: string | null; photoUrl?: string | null; city?: string; state?: string; zip?: string; appAccess?: boolean; webAccess?: boolean; isPublic?: boolean }): ParentHomeTeam {
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
        players: [],
        nextEvent: null,
        eventCount: 0,
        unreadCount: 0,
        openActions: 0,
    };
}

export async function getPublicTeamsPage({ searchText, locationFilter, cursor = null, pageSize = 24 }: { searchText?: string; locationFilter?: string; cursor?: unknown | null; pageSize?: number } = {}): Promise<PublicTeamsPage> {
    const normalizedSearchText = String(searchText ?? locationFilter ?? '').trim();
    const result = await discoverPublicTeams({
        searchText: normalizedSearchText,
        cursor,
        pageSize
    });

    return {
        teams: result.teams.map(mapPublicTeam),
        nextCursor: result.nextCursor || null
    };
}

export async function getPublicTeamsByLocation(locationFilter?: string): Promise<ParentHomeTeam[]> {
    const result = await getPublicTeamsPage({ searchText: locationFilter });
    return result.teams;
}
