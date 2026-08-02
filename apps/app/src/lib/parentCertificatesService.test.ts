import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadParentCertificate, loadParentCertificates } from './parentCertificatesService';

const legacyParentToolsMocks = vi.hoisted(() => ({
    getCertificate: vi.fn(),
    getTeam: vi.fn(),
    listCertificatesForPlayer: vi.fn()
}));

vi.mock('./adapters/legacyParentTools', () => ({
    getCertificate: legacyParentToolsMocks.getCertificate,
    getTeam: legacyParentToolsMocks.getTeam,
    listCertificatesForPlayer: legacyParentToolsMocks.listCertificatesForPlayer
}));

const parent = {
    uid: 'parent-1',
    parentOf: [
        { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Sam Player' },
        { teamId: 'team-2', teamName: 'Falcons', playerId: 'player-2', playerName: 'Jordan Star' }
    ]
} as any;

describe('parent certificate loading', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        legacyParentToolsMocks.getCertificate.mockResolvedValue(null);
        legacyParentToolsMocks.getTeam.mockImplementation(async (teamId) => ({ name: teamId === 'team-1' ? 'Bears' : 'Falcons' }));
        legacyParentToolsMocks.listCertificatesForPlayer.mockResolvedValue([]);
    });

    it('loads a published linked certificate directly without starting list or team reads', async () => {
        legacyParentToolsMocks.getCertificate.mockResolvedValue({
            id: 'cert-1',
            playerId: 'player-1',
            recipientName: 'Sam Player',
            status: 'published',
            title: 'Hustle Award'
        });

        const card = await loadParentCertificate(parent, 'team-1', 'cert-1');

        expect(legacyParentToolsMocks.getCertificate).toHaveBeenCalledTimes(1);
        expect(legacyParentToolsMocks.getCertificate).toHaveBeenCalledWith('team-1', 'cert-1');
        expect(legacyParentToolsMocks.listCertificatesForPlayer).not.toHaveBeenCalled();
        expect(legacyParentToolsMocks.getTeam).not.toHaveBeenCalled();
        expect(card).toMatchObject({
            id: 'cert-1',
            teamId: 'team-1',
            teamName: 'Bears',
            playerId: 'player-1',
            playerName: 'Sam Player',
            status: 'published',
            url: 'https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-1'
        });
    });

    it('rejects missing and unpublished direct certificates', async () => {
        expect(await loadParentCertificate(parent, 'team-1', 'missing')).toBeNull();

        legacyParentToolsMocks.getCertificate.mockResolvedValue({
            id: 'draft-cert',
            playerId: 'player-1',
            status: 'draft'
        });
        expect(await loadParentCertificate(parent, 'team-1', 'draft-cert')).toBeNull();
        expect(legacyParentToolsMocks.listCertificatesForPlayer).not.toHaveBeenCalled();
    });

    it('rejects requests for a team not linked to the parent without reading the certificate', async () => {
        const card = await loadParentCertificate(parent, 'team-3', 'cert-1');

        expect(card).toBeNull();
        expect(legacyParentToolsMocks.getCertificate).not.toHaveBeenCalled();
        expect(legacyParentToolsMocks.listCertificatesForPlayer).not.toHaveBeenCalled();
    });

    it('rejects a direct record whose team metadata conflicts with the requested team', async () => {
        legacyParentToolsMocks.getCertificate.mockResolvedValue({
            id: 'cert-1',
            teamId: 'team-2',
            playerId: 'player-1',
            status: 'published'
        });

        expect(await loadParentCertificate(parent, 'team-1', 'cert-1')).toBeNull();
    });

    it('rejects a certificate for an unlinked player on a linked team', async () => {
        legacyParentToolsMocks.getCertificate.mockResolvedValue({
            id: 'cert-1',
            playerId: 'player-9',
            status: 'published'
        });

        expect(await loadParentCertificate(parent, 'team-1', 'cert-1')).toBeNull();
        expect(legacyParentToolsMocks.listCertificatesForPlayer).not.toHaveBeenCalled();
    });

    it('loads bounded lists after a direct result without refetching or duplicating it', async () => {
        legacyParentToolsMocks.getCertificate.mockResolvedValue({
            id: 'cert-1',
            playerId: 'player-1',
            status: 'published',
            title: 'Hustle Award',
            updatedAt: new Date('2026-08-02T03:00:00Z')
        });
        const directCard = await loadParentCertificate(parent, 'team-1', 'cert-1');
        legacyParentToolsMocks.listCertificatesForPlayer
            .mockResolvedValueOnce([{
                id: 'cert-1',
                playerId: 'player-1',
                status: 'published',
                title: 'Hustle Award',
                updatedAt: new Date('2026-08-02T03:00:00Z')
            }])
            .mockResolvedValueOnce([{
                id: 'cert-2',
                playerId: 'player-2',
                status: 'published',
                title: 'Leadership Award',
                updatedAt: new Date('2026-08-01T03:00:00Z')
            }]);

        const cards = await loadParentCertificates(parent, { includeCertificate: directCard });

        expect(legacyParentToolsMocks.getCertificate).toHaveBeenCalledTimes(1);
        expect(legacyParentToolsMocks.listCertificatesForPlayer).toHaveBeenCalledTimes(2);
        expect(legacyParentToolsMocks.listCertificatesForPlayer).toHaveBeenNthCalledWith(1, 'team-1', 'player-1', {
            status: 'published',
            limit: 25
        });
        expect(legacyParentToolsMocks.listCertificatesForPlayer).toHaveBeenNthCalledWith(2, 'team-2', 'player-2', {
            status: 'published',
            limit: 25
        });
        expect(cards.map((card) => card.id)).toEqual(['cert-1', 'cert-2']);
        expect(cards.filter((card) => card.id === 'cert-1')).toHaveLength(1);
    });

    it('retains the bounded list behavior for non-deep-linked awards', async () => {
        legacyParentToolsMocks.listCertificatesForPlayer
            .mockResolvedValueOnce([{ id: 'cert-1', title: 'Hustle Award' }])
            .mockResolvedValueOnce([{ id: 'cert-2', title: 'Leadership Award' }]);

        const cards = await loadParentCertificates(parent);

        expect(legacyParentToolsMocks.getCertificate).not.toHaveBeenCalled();
        expect(legacyParentToolsMocks.listCertificatesForPlayer).toHaveBeenCalledTimes(2);
        expect(legacyParentToolsMocks.listCertificatesForPlayer).toHaveBeenNthCalledWith(1, 'team-1', 'player-1', {
            status: 'published',
            limit: 25
        });
        expect(legacyParentToolsMocks.listCertificatesForPlayer).toHaveBeenNthCalledWith(2, 'team-2', 'player-2', {
            status: 'published',
            limit: 25
        });
        expect(cards.map((card) => card.playerId)).toEqual(['player-1', 'player-2']);
    });

    it('reuses one team read for linked children on the same team', async () => {
        legacyParentToolsMocks.listCertificatesForPlayer
            .mockResolvedValueOnce([{ id: 'cert-1', title: 'Hustle Award' }])
            .mockResolvedValueOnce([{ id: 'cert-2', title: 'Leadership Award' }]);

        await loadParentCertificates({
            uid: 'parent-1',
            parentOf: [
                { teamId: 'team-1', playerId: 'player-1', playerName: 'Sam Player' },
                { teamId: 'team-1', playerId: 'player-2', playerName: 'Jordan Star' }
            ]
        } as any);

        expect(legacyParentToolsMocks.getTeam).toHaveBeenCalledTimes(1);
        expect(legacyParentToolsMocks.getTeam).toHaveBeenCalledWith('team-1');
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
