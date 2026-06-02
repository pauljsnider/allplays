import { getTeams } from '../../../../js/db.js';
import { type ParentHomeTeam } from './homeLogic';

function teamLocation(team: { city?: string; state?: string; zip?: string }): string | null {
    if (team.city && team.state) return `${team.city}, ${team.state}`;
    if (team.zip) return team.zip;
    return null;
}

export async function getPublicTeamsByLocation(locationFilter?: string): Promise<ParentHomeTeam[]> {
    const teams = await getTeams({ publicOnly: true, locationFilter: locationFilter || '' });
    return teams.map((team: { id: string; name: string; sport?: string | null; photoUrl?: string | null; city?: string; state?: string; zip?: string; appAccess?: boolean; webAccess?: boolean; isPublic?: boolean }) => ({
        teamId: team.id,
        teamName: team.name,
        role: 'Public',
        sport: team.sport ?? null,
        photoUrl: team.photoUrl ?? null,
        location: teamLocation(team),
        appAccess: team.appAccess ?? false,
        webAccess: team.webAccess ?? true,
        isPublic: true,
        players: [],
        nextEvent: null,
        eventCount: 0,
        unreadCount: 0,
        openActions: 0,
    }));
}
