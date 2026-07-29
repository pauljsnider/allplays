import { describe, expect, it, vi } from 'vitest';
import {
    PUBLIC_HOMEPAGE_GAMES_URL,
    PUBLIC_HOMEPAGE_REQUEST_TIMEOUT_MS,
    getPublicHomepageGames
} from '../../js/public-homepage-games.js';

describe('public homepage games client', () => {
    it('loads one sanitized discovery payload from the bounded public endpoint', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            live: [{ id: 'live-1' }],
            upcoming: [{ id: 'upcoming-1' }],
            replays: [{ id: 'replay-1' }],
            partial: true,
            partialCategories: ['live', 'invalid'],
            privateInternalField: 'ignored'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        }));

        await expect(getPublicHomepageGames({ fetchImpl })).resolves.toEqual({
            partial: true,
            partialCategories: ['live'],
            live: [{ id: 'live-1' }],
            upcoming: [{ id: 'upcoming-1' }],
            replays: [{ id: 'replay-1' }]
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(fetchImpl).toHaveBeenCalledWith(PUBLIC_HOMEPAGE_GAMES_URL, expect.objectContaining({
            method: 'GET',
            headers: { Accept: 'application/json' }
        }));
    });

    it('fails explicitly instead of falling back to unauthorized Firestore queries', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));

        await expect(getPublicHomepageGames({ fetchImpl })).rejects.toThrow(
            'Public homepage games request failed (503).'
        );
    });

    it('aborts and rejects a non-settling request at the internal deadline', async () => {
        vi.useFakeTimers();
        let requestSignal;
        const fetchImpl = vi.fn((_url, options) => {
            requestSignal = options.signal;
            return new Promise(() => {});
        });

        try {
            const request = getPublicHomepageGames({ fetchImpl, timeoutMs: 25 });
            const rejection = expect(request).rejects.toThrow(
                'Public homepage games request timed out.'
            );
            await vi.advanceTimersByTimeAsync(25);

            await rejection;
            expect(requestSignal.aborted).toBe(true);
            expect(PUBLIC_HOMEPAGE_REQUEST_TIMEOUT_MS).toBe(10_000);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the deadline active while reading a stalled response body', async () => {
        vi.useFakeTimers();
        let requestSignal;
        const fetchImpl = vi.fn(async (_url, options) => {
            requestSignal = options.signal;
            return {
                ok: true,
                json: () => new Promise(() => {})
            };
        });

        try {
            const request = getPublicHomepageGames({ fetchImpl, timeoutMs: 25 });
            const rejection = expect(request).rejects.toThrow(
                'Public homepage games request timed out.'
            );
            await vi.advanceTimersByTimeAsync(25);

            await rejection;
            expect(requestSignal.aborted).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});
