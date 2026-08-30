import { describe, expect, it, vi } from 'vitest';
import {
    loadPublicGameResetIdentity,
    normalizePublicGameResetIdentity
} from '../../js/live-game-overlay-reset-identity.js';

describe('live game overlay public reset identity', () => {
    it('normalizes only a bounded reset event ID paired with a valid boundary', () => {
        expect(normalizePublicGameResetIdentity({
            liveResetEventId: ' reset-123 ',
            liveResetAt: '2026-08-30T01:00:00.000Z'
        })).toEqual({
            resetEventId: 'reset-123',
            resetAtMs: Date.parse('2026-08-30T01:00:00.000Z')
        });
        expect(normalizePublicGameResetIdentity({
            liveResetEventId: 'bad/id',
            liveResetAt: '2026-08-30T01:00:00.000Z'
        })).toBeNull();
        expect(normalizePublicGameResetIdentity({
            liveResetEventId: 'reset-123',
            liveResetAt: 'not-a-date'
        })).toBeNull();
    });

    it('loads the exact public game projection without caching partial failures', async () => {
        const callable = vi.fn().mockResolvedValue({
            data: {
                item: {
                    liveResetEventId: 'reset-public',
                    liveResetAt: '2026-08-30T01:00:00.000Z'
                }
            }
        });
        const httpsCallable = vi.fn(() => callable);

        await expect(loadPublicGameResetIdentity('team-1', 'game-1', {
            loadFirebase: async () => ({ functions: {}, httpsCallable })
        })).resolves.toEqual({
            resetEventId: 'reset-public',
            resetAtMs: Date.parse('2026-08-30T01:00:00.000Z')
        });
        expect(httpsCallable).toHaveBeenCalledWith({}, 'getPublicGameProjection');
        expect(callable).toHaveBeenCalledWith({ teamId: 'team-1', gameId: 'game-1' });

        await expect(loadPublicGameResetIdentity('bad/team', 'game-1', {
            loadFirebase: async () => ({ functions: {}, httpsCallable })
        })).rejects.toThrow('Valid team and game IDs are required.');
        await expect(loadPublicGameResetIdentity('team-1', 'game-1', {
            loadFirebase: async () => ({})
        })).rejects.toThrow('Firebase Functions are unavailable.');
    });
});
