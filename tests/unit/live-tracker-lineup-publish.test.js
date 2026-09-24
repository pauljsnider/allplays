import { describe, expect, it, vi } from 'vitest';
import { persistThenPublishLiveLineup } from '../../js/live-tracker-lineup-publish.js';

describe('live tracker lineup publication', () => {
    it('publishes only after the canonical lineup write succeeds', async () => {
        const calls = [];

        await persistThenPublishLiveLineup({
            shouldPublish: true,
            persistLineup: vi.fn(async () => { calls.push('persist'); }),
            publishLineup: vi.fn(async () => { calls.push('publish'); })
        });

        expect(calls).toEqual(['persist', 'publish']);
    });

    it('does not publish an event when canonical lineup persistence fails', async () => {
        const publishLineup = vi.fn();

        await expect(persistThenPublishLiveLineup({
            shouldPublish: true,
            persistLineup: vi.fn(async () => { throw new Error('write rejected'); }),
            publishLineup
        })).rejects.toThrow('write rejected');

        expect(publishLineup).not.toHaveBeenCalled();
    });

    it('persists without publishing when the game is not live', async () => {
        const persistLineup = vi.fn();
        const publishLineup = vi.fn();

        await persistThenPublishLiveLineup({ persistLineup, publishLineup, shouldPublish: false });

        expect(persistLineup).toHaveBeenCalledOnce();
        expect(publishLineup).not.toHaveBeenCalled();
    });
});
