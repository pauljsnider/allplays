import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadParentCertificates } from './parentCertificatesService';

const legacyParentToolsMocks = vi.hoisted(() => ({
    getTeam: vi.fn(),
    listCertificatesForPlayer: vi.fn()
}));

vi.mock('./adapters/legacyParentTools', () => ({
    getTeam: legacyParentToolsMocks.getTeam,
    listCertificatesForPlayer: legacyParentToolsMocks.listCertificatesForPlayer
}));

describe('loadParentCertificates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        legacyParentToolsMocks.getTeam.mockResolvedValue({ name: 'Bears' });
        legacyParentToolsMocks.listCertificatesForPlayer.mockResolvedValue([]);
    });

    it('expands the published certificate read for the deep-linked team only', async () => {
        await loadParentCertificates({
            uid: 'parent-1',
            parentOf: [
                { teamId: 'team-1', playerId: 'player-1', playerName: 'Sam Player' },
                { teamId: 'team-2', playerId: 'player-2', playerName: 'Jordan Star' }
            ]
        } as any, {
            requestedTeamId: 'team-1',
            requestedCertificateId: 'cert-older'
        });

        expect(legacyParentToolsMocks.listCertificatesForPlayer).toHaveBeenNthCalledWith(1, 'team-1', 'player-1', {
            status: 'published',
            limit: 250
        });
        expect(legacyParentToolsMocks.listCertificatesForPlayer).toHaveBeenNthCalledWith(2, 'team-2', 'player-2', {
            status: 'published',
            limit: 25
        });
    });
});
