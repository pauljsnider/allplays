import { describe, expect, it, vi } from 'vitest';
import {
    PUBLIC_HOMEPAGE_GAMES_URL,
    getPublicHomepageGames
} from '../../js/public-homepage-games.js';

describe('public homepage games client', () => {
    it('loads one sanitized discovery payload from the bounded public endpoint', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            live: [{ id: 'live-1' }],
            upcoming: [{ id: 'upcoming-1' }],
            replays: [{ id: 'replay-1' }],
            privateInternalField: 'ignored'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        }));

        await expect(getPublicHomepageGames({ fetchImpl })).resolves.toEqual({
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
});
