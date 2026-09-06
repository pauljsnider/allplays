import { describe, expect, it, vi } from 'vitest';
import { DIAMOND_LEGACY_APP_BUILD, activateDiamondGameForLegacy, cancelDiamondGameForLegacy, configureDiamondTeamForSport, getDiamondGameAccess } from '../../js/diamond-scorebook-client.js';

describe('legacy Diamond callable adapter', () => {
    it('uses the shared profile contract and a bounded team id', async () => {
        const invoke = vi.fn().mockResolvedValue({ data: { available: true, configured: true } });
        const httpsCallable = vi.fn(() => invoke);

        await expect(configureDiamondTeamForSport(' team-a ', 'Softball', { enabled: true, captureMode: 'full' }, {
            functions: {},
            httpsCallable,
            crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000111' }
        })).resolves.toMatchObject({ available: true, configured: true });
        expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'configureDiamondTeam');
        expect(invoke).toHaveBeenCalledWith({
            requestId: '00000000-0000-4000-8000-000000000111',
            teamId: 'team-a',
            appBuild: DIAMOND_LEGACY_APP_BUILD,
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
        expect(invoke).toHaveBeenCalledWith({
            teamId: 'team-a',
            gameId: 'game-a',
            appBuild: DIAMOND_LEGACY_APP_BUILD
        });
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
            appBuild: DIAMOND_LEGACY_APP_BUILD,
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

    it('cancels from an authoritative snapshot and reuses the exact command after an ambiguous response', async () => {
        const getState = vi.fn().mockResolvedValue({
            data: {
                authoritative: true,
                instanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                revision: 7,
                state: {
                    instanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                    revision: 7,
                    lifecycle: 'active',
                    rulesProfileId: 'baseball-youth',
                    rulesProfileVersion: 1
                }
            }
        });
        const submit = vi.fn()
            .mockRejectedValueOnce({ code: 'functions/unavailable', message: 'response lost' })
            .mockResolvedValueOnce({ data: { outcome: 'accepted', revision: 8, eventId: 'event-8' } });
        const httpsCallable = vi.fn((_functions, name) => name === 'getDiamondState' ? getState : submit);
        const randomUUID = vi.fn(() => '00000000-0000-4000-8000-000000000222');

        const result = await cancelDiamondGameForLegacy(' team-a ', ' game-a ', {
            reason: '  Cancelled   from schedule management. '
        }, {
            functions: {},
            httpsCallable,
            crypto: { randomUUID }
        });

        expect(result).toEqual({ cancelled: true, outcome: 'accepted', revision: 8 });
        expect(result).not.toHaveProperty('reason');
        expect(getState).toHaveBeenCalledWith({ teamId: 'team-a', gameId: 'game-a', visibility: 'private' });
        expect(randomUUID).toHaveBeenCalledTimes(1);
        expect(submit).toHaveBeenCalledTimes(2);
        const expectedCommand = {
            schemaVersion: 2,
            commandId: '00000000-0000-4000-8000-000000000222',
            teamId: 'team-a',
            gameId: 'game-a',
            appBuild: DIAMOND_LEGACY_APP_BUILD,
            expectedInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            expectedRevision: 7,
            rulesProfileId: 'baseball-youth',
            rulesProfileVersion: 1,
            type: 'cancel',
            payload: { confirmed: true, reason: 'Cancelled from schedule management.' }
        };
        expect(submit.mock.calls[0][0]).toEqual(expectedCommand);
        expect(submit.mock.calls[1][0]).toBe(submit.mock.calls[0][0]);
    });

    it('fails closed before cancellation when private state is not authoritative', async () => {
        const getState = vi.fn().mockResolvedValue({
            data: {
                authoritative: false,
                instanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                revision: 7,
                state: { rulesProfileId: 'baseball-youth', rulesProfileVersion: 1 }
            }
        });
        const submit = vi.fn();
        const httpsCallable = vi.fn((_functions, name) => name === 'getDiamondState' ? getState : submit);

        await expect(cancelDiamondGameForLegacy('team-a', 'game-a', {}, {
            functions: {},
            httpsCallable,
            crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000222' }
        })).rejects.toThrow(/authoritative Diamond game revision/);

        expect(submit).not.toHaveBeenCalled();
    });

    it('confirms an ambiguous legacy cancellation only after the same game instance advances to cancelled', async () => {
        const active = {
            data: {
                authoritative: true,
                instanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                revision: 7,
                state: {
                    lifecycle: 'active',
                    rulesProfileId: 'baseball-youth',
                    rulesProfileVersion: 1
                }
            }
        };
        const cancelled = {
            data: {
                ...active.data,
                revision: 8,
                state: { ...active.data.state, lifecycle: 'cancelled' }
            }
        };
        const getState = vi.fn().mockResolvedValueOnce(active).mockResolvedValueOnce(cancelled);
        const submit = vi.fn()
            .mockRejectedValueOnce({ code: 'functions/unavailable', message: 'response lost' })
            .mockRejectedValueOnce({ code: 'functions/unavailable', message: 'response still unavailable' });
        const httpsCallable = vi.fn((_functions, name) => name === 'getDiamondState' ? getState : submit);

        await expect(cancelDiamondGameForLegacy('team-a', 'game-a', {}, {
            functions: {},
            httpsCallable,
            crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000222' }
        })).resolves.toEqual({ cancelled: true, outcome: 'duplicate', revision: 8 });

        expect(submit).toHaveBeenCalledTimes(2);
        expect(submit.mock.calls[1][0]).toBe(submit.mock.calls[0][0]);
        expect(getState).toHaveBeenCalledTimes(2);
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
