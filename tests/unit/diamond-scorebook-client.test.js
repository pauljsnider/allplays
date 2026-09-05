import { describe, expect, it, vi } from 'vitest';
import { activateDiamondGameForLegacy, configureDiamondTeamForSport, getDiamondGameAccess } from '../../js/diamond-scorebook-client.js';

describe('legacy Diamond callable adapter', () => {
    it('uses the shared profile contract and a bounded team id', async () => {
        const invoke = vi.fn().mockResolvedValue({ data: { available: true, configured: true } });
        const httpsCallable = vi.fn(() => invoke);

        await expect(configureDiamondTeamForSport(' team-a ', 'Softball', { captureMode: 'full' }, {
            functions: {},
            httpsCallable,
            crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000111' }
        })).resolves.toMatchObject({ available: true, configured: true });
        expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'configureDiamondTeam');
        expect(invoke).toHaveBeenCalledWith({
            requestId: '00000000-0000-4000-8000-000000000111',
            teamId: 'team-a',
            enabled: true,
            sport: 'fastpitch',
            rulesProfileId: 'fastpitch-youth',
            rulesProfileVersion: 1,
            captureMode: 'full'
        });
    });

    it('does not call the server for unsupported sports', async () => {
        const httpsCallable = vi.fn();
        await expect(configureDiamondTeamForSport('team-a', 'Soccer', {}, { functions: {}, httpsCallable }))
            .resolves.toEqual({ available: false, configured: false, reason: 'unsupported-team-or-sport' });
        expect(httpsCallable).not.toHaveBeenCalled();
    });

    it('loads game-scoped access through the server', async () => {
        const invoke = vi.fn().mockResolvedValue({ data: { available: true, canActivate: true, canScore: true } });
        await expect(getDiamondGameAccess('team-a', 'game-a', {
            functions: {},
            httpsCallable: vi.fn(() => invoke)
        })).resolves.toMatchObject({ canActivate: true, canScore: true });
        expect(invoke).toHaveBeenCalledWith({ teamId: 'team-a', gameId: 'game-a' });
    });

    it('activates through the server with a secure stable request id and explicit capture mode', async () => {
        const invoke = vi.fn().mockResolvedValue({ data: { activated: true, trackingEngine: 'diamond-v2' } });
        const randomUUID = vi.fn(() => '00000000-0000-4000-8000-000000000123');

        await expect(activateDiamondGameForLegacy('team-a', 'game-a', 'full', {
            functions: {},
            httpsCallable: vi.fn(() => invoke),
            crypto: { randomUUID }
        })).resolves.toMatchObject({ activated: true, trackingEngine: 'diamond-v2' });
        expect(invoke).toHaveBeenCalledWith({
            requestId: '00000000-0000-4000-8000-000000000123',
            teamId: 'team-a',
            gameId: 'game-a',
            captureMode: 'full'
        });
    });

    it('fails closed when activation cannot create a cryptographically secure request id', async () => {
        const invoke = vi.fn();
        await expect(activateDiamondGameForLegacy('team-a', 'game-a', 'quick', {
            functions: {},
            httpsCallable: vi.fn(() => invoke),
            crypto: {}
        })).rejects.toThrow(/Secure request IDs are unavailable/);
        expect(invoke).not.toHaveBeenCalled();
    });

    it('does not attempt team configuration without secure randomness', async () => {
        const invoke = vi.fn();
        await expect(configureDiamondTeamForSport('team-a', 'Baseball', {}, {
            functions: {},
            httpsCallable: vi.fn(() => invoke),
            crypto: {}
        })).rejects.toThrow(/Secure request IDs are unavailable/);
        expect(invoke).not.toHaveBeenCalled();
    });
});
