import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { raceFirstSuccessfulRead } from '../../js/hedged-read.js';

describe('raceFirstSuccessfulRead', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('keeps the fallback idle when the primary read completes promptly', async () => {
        const fallback = vi.fn().mockResolvedValue({ source: 'rest' });

        await expect(raceFirstSuccessfulRead({
            primary: () => Promise.resolve({ source: 'sdk' }),
            fallback,
            label: 'Profile load',
            fallbackDelayMs: 750,
            primaryTimeoutMs: 5000
        })).resolves.toEqual({
            value: { source: 'sdk' },
            source: 'primary',
            primaryError: undefined
        });

        await vi.advanceTimersByTimeAsync(1000);
        expect(fallback).not.toHaveBeenCalled();
    });

    it('returns the authoritative fallback without waiting for a stalled primary timeout', async () => {
        const fallback = vi.fn().mockResolvedValue({ source: 'rest' });
        const read = raceFirstSuccessfulRead({
            primary: () => new Promise(() => {}),
            fallback,
            label: 'Schedule read',
            fallbackDelayMs: 750,
            primaryTimeoutMs: 5000
        });

        await vi.advanceTimersByTimeAsync(749);
        expect(fallback).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);

        await expect(read).resolves.toEqual({
            value: { source: 'rest' },
            source: 'fallback',
            primaryError: undefined
        });
    });

    it('starts the fallback immediately after a primary failure', async () => {
        const fallback = vi.fn().mockResolvedValue(['team-1']);

        await expect(raceFirstSuccessfulRead({
            primary: () => Promise.reject(new Error('SDK unavailable')),
            fallback,
            fallbackDelayMs: 750
        })).resolves.toEqual(expect.objectContaining({
            value: ['team-1'],
            source: 'fallback',
            primaryError: expect.objectContaining({ message: 'SDK unavailable' })
        }));
        expect(fallback).toHaveBeenCalledTimes(1);
    });

    it('rejects when neither source completes authoritatively', async () => {
        const read = raceFirstSuccessfulRead({
            primary: () => Promise.reject(new Error('SDK unavailable')),
            fallback: () => Promise.reject(new Error('REST unavailable')),
            fallbackDelayMs: 750
        });

        await expect(read).rejects.toThrow('REST unavailable');
    });

    it('rejects within the configured bounds when both sources stall', async () => {
        const read = raceFirstSuccessfulRead({
            primary: () => new Promise(() => {}),
            fallback: () => new Promise(() => {}),
            label: 'Bounded read',
            fallbackDelayMs: 100,
            primaryTimeoutMs: 500,
            fallbackTimeoutMs: 500
        });

        await vi.advanceTimersByTimeAsync(599);
        let settled = false;
        void read.finally(() => { settled = true; }).catch(() => {});
        await Promise.resolve();
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await expect(read).rejects.toThrow('Bounded read fallback timed out.');
    });

    it('does not mask a non-transport primary failure with a fallback result', async () => {
        const fallback = vi.fn().mockResolvedValue([]);
        const read = raceFirstSuccessfulRead({
            primary: () => Promise.reject(Object.assign(new Error('permission denied'), {
                code: 'permission-denied'
            })),
            fallback,
            shouldFallbackAfterPrimaryError: () => false
        });

        await expect(read).rejects.toThrow('permission denied');
        await vi.advanceTimersByTimeAsync(1000);
        expect(fallback).not.toHaveBeenCalled();
    });
});
