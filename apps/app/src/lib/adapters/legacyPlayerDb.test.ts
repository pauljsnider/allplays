import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    callable: vi.fn(),
    functions: { name: 'functions' },
    httpsCallable: vi.fn()
}));
const legacyDbMocks = vi.hoisted(() => ({
    getGames: vi.fn()
}));

vi.mock('@legacy/db.js', () => legacyDbMocks);
vi.mock('@legacy/roster-profile-fields.js', () => ({
    collectRosterParentContacts: vi.fn()
}));
vi.mock('@legacy/firebase.js', () => ({
    functions: firebaseMocks.functions,
    httpsCallable: firebaseMocks.httpsCallable
}));

import { getGames, inviteCoParentToAthlete } from './legacyPlayerDb';

describe('legacyPlayerDb game reads', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards the complete-shared-game requirement to the legacy reader', async () => {
        legacyDbMocks.getGames.mockResolvedValue([]);

        await expect(getGames('team-1', { requireCompleteSharedGames: true })).resolves.toEqual([]);

        expect(legacyDbMocks.getGames).toHaveBeenCalledWith('team-1', {
            requireCompleteSharedGames: true
        });
    });
});

describe('legacyPlayerDb co-parent invitations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firebaseMocks.httpsCallable.mockReturnValue(firebaseMocks.callable);
    });

    it('routes Player invitations through the protected callable with normalized input', async () => {
        firebaseMocks.callable.mockResolvedValue({
            data: {
                id: 'invite-1',
                code: 'cope1234',
                teamName: 'Tigers',
                playerName: 'Sam',
                email: 'coparent@example.com',
                created: true,
                reused: false
            }
        });

        const result = await inviteCoParentToAthlete('team-1', 'player-1', ' CoParent@Example.COM ');

        expect(firebaseMocks.httpsCallable).toHaveBeenCalledWith(firebaseMocks.functions, 'createCoParentInvite');
        expect(firebaseMocks.callable).toHaveBeenCalledWith({
            teamId: 'team-1',
            playerId: 'player-1',
            email: 'coparent@example.com'
        });
        expect(result).toEqual({
            id: 'invite-1',
            code: 'COPE1234',
            teamName: 'Tigers',
            playerName: 'Sam',
            email: 'coparent@example.com',
            created: true,
            reused: false
        });
    });
});
