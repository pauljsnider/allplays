import { createParentMembershipRequest, discoverPublicTeams, getPlayers, getTeam, listMyParentMembershipRequests } from './adapters/legacyParentTools';
import type { AuthUser } from './types';

export type ParentAccessTeam = {
    id: string;
    name: string;
    sport?: string;
    city?: string;
    state?: string;
    zip?: string;
};

export type ParentAccessTeamsPage = {
    teams: ParentAccessTeam[];
    nextCursor: unknown | null;
};

export type ParentAccessPlayer = {
    id: string;
    name: string;
    number?: string;
    photoUrl?: string | null;
};

export type ParentAccessRequest = {
    id: string;
    teamId: string;
    teamName: string;
    playerId: string;
    playerName: string;
    relation: string;
    status: string;
    decisionNote?: string | null;
    createdAt?: unknown;
};

export async function loadParentAccessModel(user: AuthUser | null) {
    if (!user?.uid) return { teams: [], requests: [] };
    const requests = await Promise.resolve(listMyParentMembershipRequests(user.uid));
    return {
        teams: [],
        requests: (requests || []).map(normalizeAccessRequest)
    };
}

export async function discoverParentAccessTeams({
    searchText = '',
    cursor = null,
    pageSize = 20
}: { searchText?: string; cursor?: unknown | null; pageSize?: number } = {}): Promise<ParentAccessTeamsPage> {
    const result = await Promise.resolve(discoverPublicTeams({
        searchText: String(searchText || '').trim(),
        cursor,
        pageSize
    }));
    return {
        teams: normalizeAccessTeams(result?.teams),
        nextCursor: result?.nextCursor || null
    };
}

export async function loadParentAccessPlayers(teamId: string): Promise<ParentAccessPlayer[]> {
    if (!teamId) return [];
    const players = await Promise.resolve(getPlayers(teamId));
    return (players || [])
        .filter((player: any) => player?.active !== false)
        .map((player: any) => ({
            id: compactString(player.id),
            name: compactString(player.name) || 'Player',
            number: compactString(player.number),
            photoUrl: player.photoUrl || null
        }))
        .filter((player: ParentAccessPlayer) => player.id)
        .sort((a: ParentAccessPlayer, b: ParentAccessPlayer) => a.name.localeCompare(b.name));
}

export async function loadParentAccessTeam(teamId: string): Promise<ParentAccessTeam | null> {
    if (!teamId) return null;
    const team = await Promise.resolve(getTeam(teamId));
    return normalizeAccessTeams(team ? [team] : [])[0] || null;
}

export async function submitParentAccessRequest(teamId: string, playerId: string, relation: string) {
    return createParentMembershipRequest(teamId, playerId, relation || 'Parent');
}

function normalizeAccessTeams(teams: any[]): ParentAccessTeam[] {
    return (Array.isArray(teams) ? teams : [])
        .filter((team) => team?.isPublic !== false)
        .map((team) => ({
            id: compactString(team.id || team.teamId),
            name: compactString(team.name || team.teamName) || 'Team',
            sport: compactString(team.sport),
            city: compactString(team.city),
            state: compactString(team.state),
            zip: compactString(team.zip)
        }))
        .filter((team) => team.id)
        .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeAccessRequest(request: any): ParentAccessRequest {
    return {
        id: compactString(request.id),
        teamId: compactString(request.teamId),
        teamName: compactString(request.teamName) || 'Team',
        playerId: compactString(request.playerId),
        playerName: compactString(request.playerName) || 'Player',
        relation: compactString(request.relation) || 'Parent',
        status: compactString(request.status) || 'pending',
        decisionNote: request.decisionNote || null,
        createdAt: request.createdAt || null
    };
}

function compactString(value: unknown) {
    return String(value || '').trim();
}
