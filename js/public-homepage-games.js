export const PUBLIC_HOMEPAGE_GAMES_URL = 'https://us-central1-game-flow-c6311.cloudfunctions.net/publicHomepageGamesV1';

export async function getPublicHomepageGames({
    fetchImpl = globalThis.fetch,
    signal,
    url = PUBLIC_HOMEPAGE_GAMES_URL
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('Public homepage games transport is unavailable.');
    }

    const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal
    });
    if (!response.ok) {
        throw new Error(`Public homepage games request failed (${response.status}).`);
    }
    const payload = await response.json();
    if (!payload || typeof payload !== 'object') {
        throw new Error('Public homepage games response is invalid.');
    }
    return {
        live: Array.isArray(payload.live) ? payload.live : [],
        upcoming: Array.isArray(payload.upcoming) ? payload.upcoming : [],
        replays: Array.isArray(payload.replays) ? payload.replays : []
    };
}
