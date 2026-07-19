import { getPlayerPrivateProfile } from './adapters/legacyPlayerDb';
import { addPendingFamilyMember, getPlayers, readFamilyMembers } from './adapters/legacyParentTools';
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

export type ParentHouseholdFamilyContact = {
    id: string;
    name: string;
    email: string;
    phone: string;
    relation: string;
    status: 'linked' | 'contact';
    teamId: string;
    teamName: string;
    playerId: string;
    playerName: string;
    playerNumber?: string;
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
    email: string;
    emailSent: boolean;
};

export async function loadParentHouseholdInviteModel(user: AuthUser | null): Promise<{ linkedPlayers: ParentHouseholdLinkedPlayer[]; members: ParentHouseholdFamilyMember[]; linkedContacts: ParentHouseholdFamilyContact[] }> {
    if (!user?.uid) return { linkedPlayers: [], members: [], linkedContacts: [] };
    const linkedPlayerList = normalizeFamilyChildren(user.parentOf || []) as ParentHouseholdLinkedPlayer[];
    const [linkedPlayers, members] = await Promise.all([
        Promise.resolve(linkedPlayerList),
        Promise.resolve(readFamilyMembers(user.uid))
    ]);
    const linkedContacts = await loadLinkedPlayerFamilyContacts(linkedPlayerList);
    return {
        linkedPlayers,
        linkedContacts,
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
        inviteUrl: toAbsoluteLegacyUrl((result as any)?.inviteUrl),
        email,
        emailSent: true
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

async function loadLinkedPlayerFamilyContacts(linkedPlayers: ParentHouseholdLinkedPlayer[]): Promise<ParentHouseholdFamilyContact[]> {
    const byTeam = new Map<string, ParentHouseholdLinkedPlayer[]>();
    linkedPlayers.forEach((player) => {
        if (!player.teamId || !player.playerId) return;
        byTeam.set(player.teamId, [...(byTeam.get(player.teamId) || []), player]);
    });
    const contactGroups = await Promise.all([...byTeam.entries()].map(async ([teamId, players]) => {
        const roster = await Promise.resolve(getPlayers(teamId, { includeInactive: true })).catch(() => []);
        const privateProfiles = await Promise.all(players.map(async (linkedPlayer) => ({
            playerId: linkedPlayer.playerId,
            profile: await getPlayerPrivateProfile(teamId, linkedPlayer.playerId).catch(() => null)
        })));
        const privateProfileByPlayerId = new Map(privateProfiles.map((entry) => [entry.playerId, entry.profile]));
        return players.flatMap((linkedPlayer) => {
            const player = (Array.isArray(roster) ? roster : []).find((candidate: any) => compactString(candidate?.id) === linkedPlayer.playerId) || {};
            return normalizePlayerFamilyContacts(player, linkedPlayer, privateProfileByPlayerId.get(linkedPlayer.playerId));
        });
    }));
    return dedupeFamilyContacts(contactGroups.flat());
}

function normalizePlayerFamilyContacts(player: Record<string, any>, linkedPlayer: ParentHouseholdLinkedPlayer, privateProfile?: Record<string, any> | null): ParentHouseholdFamilyContact[] {
    const contacts: ParentHouseholdFamilyContact[] = [];
    const addContact = (source: Record<string, any> | null | undefined, fallback: Record<string, any> = {}) => {
        if (!source || typeof source !== 'object') return;
        const email = compactString(source.email || source.parentEmail || source.guardianEmail || fallback.email).toLowerCase();
        const userId = compactString(source.userId || source.uid || source.accountUserId || source.parentUserId || source.guardianUserId || fallback.userId);
        const name = compactString(source.name || source.displayName || source.fullName || source.parentName || source.guardianName || fallback.name);
        const phone = compactString(source.phone || source.parentPhone || source.guardianPhone || fallback.phone);
        const relation = compactString(source.relation || source.relationship || source.parentRelation || source.guardianRelation || fallback.relation) || 'Parent/guardian';
        if (!email && !userId && !name && !phone) return;
        contacts.push({
            id: userId || email || `${linkedPlayer.teamId}:${linkedPlayer.playerId}:${contacts.length}`,
            name,
            email,
            phone,
            relation,
            status: userId ? 'linked' : 'contact',
            teamId: linkedPlayer.teamId,
            teamName: linkedPlayer.teamName,
            playerId: linkedPlayer.playerId,
            playerName: linkedPlayer.playerName,
            playerNumber: linkedPlayer.playerNumber
        });
    };

    [
        ...(Array.isArray(player?.parents) ? player.parents : []),
        ...(Array.isArray(player?.privateProfileParents) ? player.privateProfileParents : []),
        ...(Array.isArray(privateProfile?.parents) ? privateProfile.parents : []),
        ...(Array.isArray(privateProfile?.privateProfileParents) ? privateProfile.privateProfileParents : []),
        ...(Array.isArray(privateProfile?.familyContacts) ? privateProfile.familyContacts : [])
    ].forEach((contact) => addContact(contact));
    addContact({
        userId: player?.parentUserId,
        email: player?.parentEmail,
        name: player?.parentName,
        phone: player?.parentPhone,
        relation: player?.parentRelation || 'Parent'
    });
    addContact({
        userId: player?.guardianUserId,
        email: player?.guardianEmail,
        name: player?.guardianName,
        phone: player?.guardianPhone,
        relation: player?.guardianRelation || 'Guardian'
    });
    return contacts;
}

function dedupeFamilyContacts(contacts: ParentHouseholdFamilyContact[]) {
    const seen = new Set<string>();
    return contacts.filter((contact) => {
        const key = `${contact.teamId}:${contact.playerId}:${contact.email || contact.id || contact.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).sort((a, b) => (
        a.playerName.localeCompare(b.playerName)
        || (a.name || a.email || a.phone).localeCompare(b.name || b.email || b.phone)
    ));
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
