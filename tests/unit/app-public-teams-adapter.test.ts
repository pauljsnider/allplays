import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    callable: vi.fn(),
    httpsCallable: vi.fn()
}));

vi.mock('../../js/db.js', () => ({
    discoverPublicTeams: vi.fn(),
    getPublicTeamRosterCount: vi.fn()
}));
vi.mock('../../js/firebase.js', () => ({
    functions: {},
    httpsCallable: firebaseMocks.httpsCallable
}));

import { getPublicTeamGamesProjection } from '../../apps/app/src/lib/adapters/legacyPublicTeamsDb';

describe('legacyPublicTeamsDb public games projection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firebaseMocks.httpsCallable.mockReturnValue(firebaseMocks.callable);
    });

    it('follows bounded cursors and returns one identity-checked projection', async () => {
        firebaseMocks.callable
            .mockResolvedValueOnce({
                data: {
                    team: { id: 'team-public-1', name: 'Austin Bats' },
                    games: [{ id: 'game-1' }],
                    range: { truncated: true },
                    nextCursor: 'cursor-2'
                }
            })
            .mockResolvedValueOnce({
                data: {
                    team: { id: 'team-public-1', name: 'Austin Bats' },
                    games: [{ id: 'game-2' }],
                    range: { truncated: false }
                }
            });

        await expect(getPublicTeamGamesProjection('team-public-1')).resolves.toEqual({
            team: { id: 'team-public-1', name: 'Austin Bats' },
            games: [{ id: 'game-1' }, { id: 'game-2' }]
        });
        expect(firebaseMocks.httpsCallable).toHaveBeenCalledWith({}, 'getPublicTeamGamesProjection');
        expect(firebaseMocks.callable).toHaveBeenNthCalledWith(1, { teamId: 'team-public-1', limit: 500 });
        expect(firebaseMocks.callable).toHaveBeenNthCalledWith(2, { teamId: 'team-public-1', limit: 500, cursor: 'cursor-2' });
    });

    it('fails closed when truncated pagination has no fresh cursor', async () => {
        firebaseMocks.callable
            .mockResolvedValueOnce({ data: { team: { id: 'team-public-1', name: 'Austin Bats' }, games: [], range: { truncated: true }, nextCursor: 'cursor-2' } })
            .mockResolvedValueOnce({ data: { team: { id: 'team-public-1', name: 'Austin Bats' }, games: [], range: { truncated: true }, nextCursor: 'cursor-2' } });

        await expect(getPublicTeamGamesProjection('team-public-1')).rejects.toThrow('usable cursor');
    });
});
