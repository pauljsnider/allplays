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
    readFamilyMembers: vi.fn()
}));

vi.mock('./adapters/legacyPlayerDb', () => legacyPlayerDbMocks);
vi.mock('./adapters/legacyParentTools', () => legacyParentToolsMocks);

import { loadParentHouseholdInviteModel } from './parentHouseholdService';

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
});
