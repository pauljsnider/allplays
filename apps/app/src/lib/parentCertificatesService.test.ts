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

    it('reuses one team read for linked children on the same team', async () => {
        legacyParentToolsMocks.listCertificatesForPlayer
            .mockResolvedValueOnce([{ id: 'cert-1', title: 'Hustle Award' }])
            .mockResolvedValueOnce([{ id: 'cert-2', title: 'Leadership Award' }]);

        const cards = await loadParentCertificates({
            uid: 'parent-1',
            parentOf: [
                { teamId: 'team-1', playerId: 'player-1', playerName: 'Sam Player' },
                { teamId: 'team-1', playerId: 'player-2', playerName: 'Jordan Star' }
            ]
        } as any);

        expect(legacyParentToolsMocks.getTeam).toHaveBeenCalledTimes(1);
        expect(legacyParentToolsMocks.getTeam).toHaveBeenCalledWith('team-1');
        expect(legacyParentToolsMocks.listCertificatesForPlayer).toHaveBeenCalledTimes(2);
        expect(legacyParentToolsMocks.listCertificatesForPlayer).toHaveBeenNthCalledWith(1, 'team-1', 'player-1', {
            status: 'published',
            limit: 25
        });
        expect(legacyParentToolsMocks.listCertificatesForPlayer).toHaveBeenNthCalledWith(2, 'team-1', 'player-2', {
            status: 'published',
            limit: 25
        });
        expect(cards.map((card) => card.playerId)).toEqual(['player-1', 'player-2']);
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
        expect(legacyParentToolsMocks.getTeam).toHaveBeenCalledTimes(2);
        expect(legacyParentToolsMocks.getTeam).toHaveBeenNthCalledWith(1, 'team-1');
        expect(legacyParentToolsMocks.getTeam).toHaveBeenNthCalledWith(2, 'team-2');
    });

    it('falls back to child team names when team metadata has no usable name', async () => {
        legacyParentToolsMocks.getTeam.mockResolvedValue({});
        legacyParentToolsMocks.listCertificatesForPlayer.mockResolvedValueOnce([{ id: 'cert-1', title: 'Hustle Award' }]);

        const cards = await loadParentCertificates({
            uid: 'parent-1',
            parentOf: [
                { teamId: 'team-1', teamName: 'Family Bears', playerId: 'player-1', playerName: 'Sam Player' }
            ]
        } as any);

        expect(cards[0].teamName).toBe('Family Bears');
    });

    it('falls back to child team names when team metadata fails to load', async () => {
        legacyParentToolsMocks.getTeam.mockRejectedValue(new Error('team read failed'));
        legacyParentToolsMocks.listCertificatesForPlayer.mockResolvedValueOnce([{ id: 'cert-1', title: 'Hustle Award' }]);

        const cards = await loadParentCertificates({
            uid: 'parent-1',
            parentOf: [
                { teamId: 'team-1', teamName: 'Family Bears', playerId: 'player-1', playerName: 'Sam Player' }
            ]
        } as any);

        expect(cards[0].teamName).toBe('Family Bears');
    });
});
