import { addPendingFamilyMember, readFamilyMembers } from './adapters/legacyParentTools';
import type { AuthUser } from './types';

const legacyOrigin = 'https://allplays.ai';

export type ParentHouseholdLinkedPlayer = {
    teamId: string;
    teamName: string;
    playerId: string;
    playerName: string;
    playerNumber?: string;
    playerPhotoUrl?: string | null;
};

export type ParentHouseholdFamilyMember = Record<string, any> & {
    id: string;
    email: string;
    displayName: string;
    status: string;
    teamName: string;
    playerName: string;
    playerNumber?: string;
    relation: string;
    accessCode?: string;
    inviteUrl?: string;
};

export type ParentHouseholdInviteRequest = {
    playerKey: string;
    email: string;
    displayName?: string;
    relation: string;
};

export type ParentHouseholdInviteResult = {
    code: string;
    inviteUrl: string;
};

export async function loadParentHouseholdInviteModel(user: AuthUser | null): Promise<{ linkedPlayers: ParentHouseholdLinkedPlayer[]; members: ParentHouseholdFamilyMember[] }> {
    if (!user?.uid) return { linkedPlayers: [], members: [] };
    const [linkedPlayers, members] = await Promise.all([
        Promise.resolve(normalizeFamilyChildren(user.parentOf || []) as ParentHouseholdLinkedPlayer[]),
        Promise.resolve(readFamilyMembers(user.uid))
    ]);
    return {
        linkedPlayers,
        members: (members || []).map((member: any) => ({
            ...member,
            inviteUrl: toAbsoluteLegacyUrl(member.inviteUrl)
        }))
    };
}

export async function createParentHouseholdMemberInvite(user: AuthUser | null, request: ParentHouseholdInviteRequest): Promise<ParentHouseholdInviteResult> {
    if (!user?.uid) throw new Error('Sign in before creating a household invite.');
    const linkedPlayers = normalizeFamilyChildren(user.parentOf || []) as ParentHouseholdLinkedPlayer[];
    if (!linkedPlayers.length) throw new Error('No linked players are available for household invites.');
    const selected = linkedPlayers.find((player) => `${player.teamId}::${player.playerId}` === request.playerKey);
    if (!selected) throw new Error('Choose a linked player to share.');
    const email = compactString(request.email).toLowerCase();
    const relation = compactString(request.relation);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email for the household contact.');
    if (!relation) throw new Error('Enter the household contact relation.');

    const existingMembers = await Promise.resolve(readFamilyMembers(user.uid));
    const result = await addPendingFamilyMember(user.uid, {
        email,
        displayName: compactString(request.displayName),
        relation,
        teamId: selected.teamId,
        teamName: selected.teamName,
        playerId: selected.playerId,
        playerName: selected.playerName,
        playerNumber: selected.playerNumber,
        playerPhotoUrl: selected.playerPhotoUrl
    }, { existingMembers });
    return {
        code: compactString((result as any)?.code),
        inviteUrl: toAbsoluteLegacyUrl((result as any)?.inviteUrl)
    };
}

function getLegacyUrl(path: string) {
    return new URL(path, legacyOrigin).toString();
}

function normalizeFamilyChildren(children: any[]) {
    return (Array.isArray(children) ? children : [])
        .filter((child) => child?.teamId && child?.playerId)
        .map((child) => ({
            teamId: compactString(child.teamId),
            teamName: compactString(child.teamName),
            playerId: compactString(child.playerId),
            playerName: compactString(child.playerName),
            playerNumber: compactString(child.playerNumber || child.number),
            playerPhotoUrl: child.playerPhotoUrl || null
        }));
}

function toAbsoluteLegacyUrl(value: unknown) {
    const path = compactString(value);
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    return getLegacyUrl(path.replace(/^\//, ''));
}

function compactString(value: unknown) {
    return String(value || '').trim();
}
