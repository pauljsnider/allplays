export const PUBLIC_HOMEPAGE_GAMES_URL = 'https://us-central1-game-flow-c6311.cloudfunctions.net/publicHomepageGamesV1';
export const PUBLIC_HOMEPAGE_REQUEST_TIMEOUT_MS = 10_000;

export async function getPublicHomepageGames({
    fetchImpl = globalThis.fetch,
    signal,
    timeoutMs = PUBLIC_HOMEPAGE_REQUEST_TIMEOUT_MS,
    url = PUBLIC_HOMEPAGE_GAMES_URL
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('Public homepage games transport is unavailable.');
    }

    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : PUBLIC_HOMEPAGE_REQUEST_TIMEOUT_MS;
    const requestController = new AbortController();
    let timeoutId;
    let rejectAbort;
    const abortPromise = new Promise((_, reject) => {
        rejectAbort = reject;
    });
    const abortRequest = (error) => {
        if (!requestController.signal.aborted) {
            requestController.abort(error);
        }
        rejectAbort(error);
    };
    const handleExternalAbort = () => {
        abortRequest(signal?.reason instanceof Error
            ? signal.reason
            : new Error('Public homepage games request was aborted.'));
    };

    if (signal?.aborted) {
        handleExternalAbort();
    } else {
        signal?.addEventListener('abort', handleExternalAbort, { once: true });
        timeoutId = setTimeout(() => {
            abortRequest(new Error('Public homepage games request timed out.'));
        }, timeout);
    }

    const requestPromise = (async () => {
        const response = await fetchImpl(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: requestController.signal
        });
        if (!response.ok) {
            throw new Error(`Public homepage games request failed (${response.status}).`);
        }
        const payload = await response.json();
        if (!payload || typeof payload !== 'object') {
            throw new Error('Public homepage games response is invalid.');
        }
        return payload;
    })();

    let payload;
    try {
        payload = await Promise.race([requestPromise, abortPromise]);
    } finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', handleExternalAbort);
    }
    return {
        partial: payload.partial === true,
        partialCategories: Array.isArray(payload.partialCategories)
            ? payload.partialCategories.filter((category) => ['live', 'upcoming', 'replays'].includes(category))
            : [],
        live: Array.isArray(payload.live) ? payload.live : [],
        upcoming: Array.isArray(payload.upcoming) ? payload.upcoming : [],
        replays: Array.isArray(payload.replays) ? payload.replays : []
    };
}
