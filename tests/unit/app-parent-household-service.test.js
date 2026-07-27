import { beforeEach, describe, expect, it, vi } from 'vitest';

const parentToolsMocks = vi.hoisted(() => ({
    addPendingFamilyMember: vi.fn(),
    getPlayers: vi.fn(),
    readFamilyMembers: vi.fn()
}));

const playerDbMocks = vi.hoisted(() => ({
    getPlayerPrivateProfile: vi.fn()
}));

vi.mock('../../apps/app/src/lib/adapters/legacyParentTools', () => parentToolsMocks);
vi.mock('../../apps/app/src/lib/adapters/legacyPlayerDb', () => playerDbMocks);

import {
    createParentHouseholdMemberInvite,
    loadParentHouseholdInviteModel
} from '../../apps/app/src/lib/parentHouseholdService.ts';

const user = {
    uid: 'user-1',
    parentOf: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9' }]
};

beforeEach(() => {
    vi.clearAllMocks();
    parentToolsMocks.readFamilyMembers.mockResolvedValue([]);
    parentToolsMocks.getPlayers.mockResolvedValue([{ id: 'player-1', name: 'Pat Star', parents: [] }]);
    playerDbMocks.getPlayerPrivateProfile.mockResolvedValue(null);
});

describe('parent household invite service', () => {
    it('loads linked contacts from player private profile parents', async () => {
        playerDbMocks.getPlayerPrivateProfile.mockResolvedValueOnce({
            parents: [
                { userId: 'mom-1', name: 'Mom Snider', email: 'mom@allplays.ai', relation: 'Mom' }
            ]
        });

        const model = await loadParentHouseholdInviteModel(user);

        expect(playerDbMocks.getPlayerPrivateProfile).toHaveBeenCalledWith('team-1', 'player-1');
        expect(model.linkedContacts).toEqual([
            expect.objectContaining({
                teamId: 'team-1',
                playerId: 'player-1',
                playerName: 'Pat Star',
                name: 'Mom Snider',
                email: 'mom@allplays.ai',
                relation: 'Mom',
                status: 'linked'
            })
        ]);
    });

    it('canonicalizes stored and newly created household invite links', async () => {
        parentToolsMocks.readFamilyMembers
            .mockResolvedValueOnce([{
                id: 'member-1',
                accessCode: 'HOME1234',
                inviteUrl: 'accept-invite.html?code=HOME1234&type=household'
            }])
            .mockResolvedValueOnce([]);
        parentToolsMocks.addPendingFamilyMember.mockResolvedValueOnce({
            code: 'HOME5678',
            inviteUrl: 'accept-invite.html?code=HOME5678&type=household'
        });

        const model = await loadParentHouseholdInviteModel(user);
        const created = await createParentHouseholdMemberInvite(user, {
            playerKey: 'team-1::player-1',
            email: 'family@example.com',
            relation: 'Guardian'
        });

        expect(model.members[0].inviteUrl).toBe(
            'https://allplays.ai/app/#/accept-invite?code=HOME1234&type=household'
        );
        expect(created.inviteUrl).toBe(
            'https://allplays.ai/app/#/accept-invite?code=HOME5678&type=household'
        );
    });
});
