import { beforeEach, describe, expect, it, vi } from 'vitest';

const legacyPlayerDbMocks = vi.hoisted(() => ({
    getPlayerPrivateProfile: vi.fn()
}));

const legacyParentToolsMocks = vi.hoisted(() => ({
    addPendingFamilyMember: vi.fn(),
    db: { name: 'db' },
    doc: vi.fn((...segments: unknown[]) => segments.slice(1).join('/')),
    getDoc: vi.fn(),
    getPlayers: vi.fn(),
    readFamilyMembers: vi.fn(),
    removeFamilyMember: vi.fn()
}));

vi.mock('./adapters/legacyPlayerDb', () => legacyPlayerDbMocks);
vi.mock('./adapters/legacyParentTools', () => legacyParentToolsMocks);

const profileServiceMocks = vi.hoisted(() => ({
    loadProfileDocument: vi.fn()
}));

// Exercise the real parent-scope merge while stubbing only the profile read:
// the service must hydrate from the Firestore profile before trusting the
// in-memory auth user (#5246).
vi.mock('./profileService', async () => {
    const { mergeParentAccessUser } = await import('./parentAccessScope');
    return {
        loadProfileDocument: profileServiceMocks.loadProfileDocument,
        hydrateParentAccessUser: async (user: any) => {
            if (!user?.uid) return user;
            const profile = await profileServiceMocks.loadProfileDocument(user.uid).catch(() => null);
            if (!profile) return user;
            return mergeParentAccessUser(user, profile);
        }
    };
});

import { createParentHouseholdMemberInvite, loadParentHouseholdInviteModel, revokeParentHouseholdMemberAccess } from './parentHouseholdService';

function playerSnapshot(id: string, data: Record<string, unknown>) {
    return {
        id,
        exists: () => true,
        data: () => data
    };
}

describe('loadParentHouseholdInviteModel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        legacyParentToolsMocks.readFamilyMembers.mockResolvedValue([]);
        profileServiceMocks.loadProfileDocument.mockResolvedValue({});
    });

    it('reads each unique linked player document once and normalizes contacts', async () => {
        legacyParentToolsMocks.getDoc.mockImplementation(async (path: string) => (
            path === 'teams/team-1/players/player-1'
                ? playerSnapshot('player-1', {
                    parents: [{
                        userId: 'parent-2',
                        displayName: 'Zoe Parent',
                        email: 'ZOE@example.com',
                        relation: 'Mother'
                    }]
                })
                : playerSnapshot('player-2', {
                    guardianName: 'Alex Guardian',
                    guardianEmail: 'alex@example.com'
                })
        ));
        legacyPlayerDbMocks.getPlayerPrivateProfile.mockImplementation(async (_teamId: string, playerId: string) => (
            playerId === 'player-1'
                ? { familyContacts: [{ name: 'Pat Caregiver', phone: '555-0100', relation: 'Grandparent' }] }
                : null
        ));

        const model = await loadParentHouseholdInviteModel({
            uid: 'parent-1',
            parentOf: [
                { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Zed Player' },
                { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Zed Player' },
                { teamId: 'team-2', teamName: 'Hawks', playerId: 'player-2', playerName: 'Amy Player' }
            ]
        } as any);

        expect(legacyParentToolsMocks.getPlayers).not.toHaveBeenCalled();
        expect(legacyParentToolsMocks.doc).toHaveBeenCalledTimes(2);
        expect(legacyParentToolsMocks.getDoc).toHaveBeenCalledTimes(2);
        expect(legacyPlayerDbMocks.getPlayerPrivateProfile).toHaveBeenCalledTimes(2);
        expect(legacyPlayerDbMocks.getPlayerPrivateProfile).toHaveBeenCalledWith('team-1', 'player-1');
        expect(legacyPlayerDbMocks.getPlayerPrivateProfile).toHaveBeenCalledWith('team-2', 'player-2');
        expect(model.linkedContacts).toEqual([
            expect.objectContaining({
                name: 'Alex Guardian',
                email: 'alex@example.com',
                relation: 'Guardian',
                playerId: 'player-2',
                status: 'contact'
            }),
            expect.objectContaining({
                name: 'Pat Caregiver',
                phone: '555-0100',
                relation: 'Grandparent',
                playerId: 'player-1',
                status: 'contact'
            }),
            expect.objectContaining({
                id: 'parent-2',
                name: 'Zoe Parent',
                email: 'zoe@example.com',
                relation: 'Mother',
                playerId: 'player-1',
                status: 'linked'
            })
        ]);
    });

    it('keeps contacts from the readable document when the paired read fails', async () => {
        legacyParentToolsMocks.getDoc.mockImplementation(async (path: string) => {
            if (path === 'teams/team-1/players/player-1') throw new Error('public denied');
            return playerSnapshot('player-2', {
                parents: [{ displayName: 'Public Parent', email: 'public@example.com' }]
            });
        });
        legacyPlayerDbMocks.getPlayerPrivateProfile.mockImplementation(async (_teamId: string, playerId: string) => {
            if (playerId === 'player-2') throw new Error('private denied');
            return { familyContacts: [{ name: 'Private Parent', email: 'private@example.com' }] };
        });

        const model = await loadParentHouseholdInviteModel({
            uid: 'parent-1',
            parentOf: [
                { teamId: 'team-1', playerId: 'player-1', playerName: 'One Player' },
                { teamId: 'team-2', playerId: 'player-2', playerName: 'Two Player' }
            ]
        } as any);

        expect(model.linkedContacts.map((contact) => contact.email)).toEqual([
            'private@example.com',
            'public@example.com'
        ]);
        expect(legacyParentToolsMocks.getDoc).toHaveBeenCalledTimes(2);
        expect(legacyPlayerDbMocks.getPlayerPrivateProfile).toHaveBeenCalledTimes(2);
    });

    it('surfaces a child linked in the Firestore profile after sign-in (#5246)', async () => {
        profileServiceMocks.loadProfileDocument.mockResolvedValue({
            parentOf: [{ teamId: 'team-2', teamName: 'Hawks', playerId: 'player-2', playerName: 'Will Player' }],
            parentTeamIds: ['team-2'],
            parentPlayerKeys: ['team-2::player-2']
        });
        legacyParentToolsMocks.getDoc.mockImplementation(async () => playerSnapshot('player-2', {}));
        legacyPlayerDbMocks.getPlayerPrivateProfile.mockResolvedValue(null);

        const model = await loadParentHouseholdInviteModel({ uid: 'parent-1', parentOf: [] } as any);

        expect(profileServiceMocks.loadProfileDocument).toHaveBeenCalledWith('parent-1');
        expect(model.linkedPlayers).toEqual([
            expect.objectContaining({ teamId: 'team-2', playerId: 'player-2', playerName: 'Will Player' })
        ]);
        expect(legacyParentToolsMocks.getDoc).toHaveBeenCalledWith('teams/team-2/players/player-2');
    });
});

describe('createParentHouseholdMemberInvite', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        profileServiceMocks.loadProfileDocument.mockResolvedValue({});
    });

    it('lets a household invite target a child linked in the profile after sign-in (#5246)', async () => {
        profileServiceMocks.loadProfileDocument.mockResolvedValue({
            parentOf: [{ teamId: 'team-2', teamName: 'Hawks', playerId: 'player-2', playerName: 'Will Player' }],
            parentTeamIds: ['team-2'],
            parentPlayerKeys: ['team-2::player-2']
        });
        legacyParentToolsMocks.readFamilyMembers.mockResolvedValue([]);
        legacyParentToolsMocks.addPendingFamilyMember.mockResolvedValue({ code: 'ABCDEFGH', inviteUrl: 'https://allplays.ai/app/#/accept-invite?code=ABCDEFGH' });

        const result = await createParentHouseholdMemberInvite(
            { uid: 'parent-1', parentOf: [] } as any,
            { playerKey: 'team-2::player-2', email: 'grandma@example.com', relation: 'Grandmother' }
        );

        expect(result).toEqual(expect.objectContaining({ code: 'ABCDEFGH', email: 'grandma@example.com' }));
        expect(legacyParentToolsMocks.addPendingFamilyMember).toHaveBeenCalledWith(
            'parent-1',
            expect.objectContaining({ teamId: 'team-2', playerId: 'player-2', playerName: 'Will Player' }),
            { existingMembers: [] }
        );
    });

    it('rejects a revoked snapshot-only child after profile hydration (#5252)', async () => {
        profileServiceMocks.loadProfileDocument.mockResolvedValue({
            parentOf: [{ teamId: 'team-1', playerId: 'player-2' }],
            parentTeamIds: ['team-1'],
            parentPlayerKeys: ['team-1::player-2']
        });
        legacyParentToolsMocks.readFamilyMembers.mockResolvedValue([]);

        await expect(createParentHouseholdMemberInvite(
            {
                uid: 'parent-1',
                parentOf: [
                    { teamId: 'team-1', playerId: 'player-1' },
                    { teamId: 'team-1', playerId: 'player-2' }
                ],
                parentPlayerKeys: ['team-1::player-1', 'team-1::player-2']
            } as any,
            { playerKey: 'team-1::player-1', email: 'grandma@example.com', relation: 'Grandmother' }
        )).rejects.toThrow('Choose a linked player to share.');
        expect(legacyParentToolsMocks.addPendingFamilyMember).not.toHaveBeenCalled();
    });

    it('still rejects an unlinked player after profile hydration', async () => {
        profileServiceMocks.loadProfileDocument.mockResolvedValue({
            parentOf: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Madison Player' }]
        });
        legacyParentToolsMocks.readFamilyMembers.mockResolvedValue([]);

        await expect(createParentHouseholdMemberInvite(
            { uid: 'parent-1', parentOf: [] } as any,
            { playerKey: 'team-9::player-9', email: 'grandma@example.com', relation: 'Grandmother' }
        )).rejects.toThrow('Choose a linked player to share.');
        expect(legacyParentToolsMocks.addPendingFamilyMember).not.toHaveBeenCalled();
    });
});

describe('revokeParentHouseholdMemberAccess', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates a valid membership ID to the legacy adapter', async () => {
        const result = { success: true, membershipId: 'membership-1' };
        legacyParentToolsMocks.removeFamilyMember.mockResolvedValue(result);

        await expect(revokeParentHouseholdMemberAccess({ uid: 'parent-1' } as any, ' membership-1 ')).resolves.toBe(result);
        expect(legacyParentToolsMocks.removeFamilyMember).toHaveBeenCalledWith('parent-1', 'membership-1');
    });

    it.each([undefined, null, '', '   '])('rejects missing membership ID %j without invoking the adapter', async (membershipId) => {
        await expect(revokeParentHouseholdMemberAccess({ uid: 'parent-1' } as any, membershipId as any)).rejects.toThrow('Household membership is required.');
        expect(legacyParentToolsMocks.removeFamilyMember).not.toHaveBeenCalled();
    });

    it('propagates adapter failures', async () => {
        const error = new Error('permission denied');
        legacyParentToolsMocks.removeFamilyMember.mockRejectedValue(error);

        await expect(revokeParentHouseholdMemberAccess({ uid: 'parent-1' } as any, 'membership-1')).rejects.toBe(error);
    });
});
