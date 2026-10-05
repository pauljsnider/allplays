import { resolveGameReplayPlaybackSource } from './game-replay-video.js?v=3';

export function unavailableReplayPlayback(message = 'Replay video is unavailable.') {
    return {
        mode: 'none', hasVideo: false, isRecordedReplay: false,
        sourceUrl: null, publicUrl: null,
        replayState: { status: 'unavailable', message }
    };
}

// Observe Firebase identity directly: checkAuth waits for profile/access reads
// and cannot invalidate principal-scoped media promptly during that wait.
export async function observeReplayPlaybackAuth(onChange, deps = {}) {
    const firebase = deps.firebase || await import('./firebase.js?v=33');
    return firebase.onAuthStateChanged(firebase.auth, onChange);
}

// Public projections omit private archive URLs (older adapters also omit the
// archive marker). Only this
// callable may release playback to the current principal; never cache its URL
// in a game document or fall back to an older URL after denial/removal.
export async function resolveAuthorizedReplayPlayback({ teamId, gameId, clipStartMs, clipEndMs }, deps = {}) {
    try {
        const firebase = deps.firebase || await import('./firebase.js?v=33');
        const principal = firebase.auth?.currentUser || null;
        const readPlayback = firebase.httpsCallable(firebase.functions, 'getGameReplayPlayback', { timeout: 10000 });
        const { data } = await readPlayback({ teamId, gameId });
        if ((firebase.auth?.currentUser || null) !== principal) return unavailableReplayPlayback();
        if (data?.state !== 'ready' || data?.available !== true || !data?.replayVideo) {
            return unavailableReplayPlayback(data?.reason === 'team-pass-required'
                ? 'Replay access is required to watch this recording.'
                : 'Replay video is unavailable.');
        }
        // Resolve only the server-released archive, excluding stale public URLs
        // and historical aliases from the original projection.
        const source = resolveGameReplayPlaybackSource({ replayVideo: data.replayVideo });
        if (source.state !== 'playable') return unavailableReplayPlayback();
        const options = {
            ...source, hasVideo: true, isRecordedReplay: true, replayState: null,
            publicLabel: source.provider === 'youtube' ? 'Watch replay on YouTube ↗' : 'Open replay video ↗',
            clipStartMs: Number.isFinite(clipStartMs) && clipStartMs >= 0 ? clipStartMs : null,
            clipEndMs: Number.isFinite(clipEndMs) && clipEndMs > clipStartMs ? clipEndMs : null
        };
        // The server has already checked team visibility, current membership,
        // archive consistency and entitlement. Do not repeat a client-only gate.
        return { ...options, isPublicProjectionVideo: true };
    } catch {
        return unavailableReplayPlayback('Replay video is temporarily unavailable. Reload to try again.');
    }
}

// Explicit replay has no game-document subscription. Revalidate only its media
// authorization, never the synthetic score/event timeline. A hung transport is
// failed closed by the watchdog but remains in-flight until it settles, so even
// repeated auth/lifecycle signals cannot accumulate overlapping callable reads.
export function createReplayPlaybackRevalidator({ refresh, invalidate }, deps = {}) {
    const host = deps.window || window;
    const doc = deps.document || document;
    const timers = deps.timers || globalThis;
    let stopped = false;
    let pageHidden = false;
    let timer = null;
    let deadline = null;
    let inFlight = null;
    let queued = false;
    const suspended = () => pageHidden || doc.hidden;
    const clearTimers = () => {
        timers.clearTimeout(timer);
        timers.clearTimeout(deadline);
        timer = deadline = null;
    };
    const schedule = () => {
        if (stopped || suspended() || inFlight || timer !== null) return;
        timer = timers.setTimeout(() => {
            timer = null;
            void request();
        }, 15000);
    };
    const request = () => {
        if (stopped || suspended()) return Promise.resolve(false);
        timers.clearTimeout(timer);
        timer = null;
        if (inFlight) {
            queued = true;
            return inFlight;
        }
        deadline = timers.setTimeout(() => {
            deadline = null;
            invalidate('Replay access check timed out. Retrying when the connection recovers.');
        }, 10000);
        inFlight = Promise.resolve().then(() => stopped || suspended() ? false : refresh()).catch(() => {
            if (!stopped && !suspended()) invalidate('Replay video is temporarily unavailable.');
            return false;
        });
        const pending = inFlight;
        void pending.then(() => {
            timers.clearTimeout(deadline);
            deadline = null;
            inFlight = null;
            if (stopped || suspended()) return;
            if (queued) {
                queued = false;
                void request();
            } else schedule();
        });
        return pending;
    };
    const invalidateAndRefresh = () => {
        if (stopped) return Promise.resolve(false);
        clearTimers();
        invalidate('Checking replay access…');
        // Retain a watchdog when an auth change queues behind an older read.
        if (inFlight && !suspended()) deadline = timers.setTimeout(() => {
            deadline = null;
            invalidate('Replay access check timed out. Retrying when the connection recovers.');
        }, 10000);
        return request();
    };
    const onHide = (event) => {
        if (event.type === 'pagehide' && !event.persisted) { stop(); return; }
        pageHidden = true;
        queued = false;
        clearTimers();
        invalidate('Checking replay access…');
    };
    const onShow = () => {
        pageHidden = false;
        void invalidateAndRefresh();
    };
    const onVisibility = () => {
        if (doc.hidden) {
            queued = false;
            clearTimers();
            invalidate('Checking replay access…');
        } else if (!pageHidden) void invalidateAndRefresh();
    };
    const stop = () => {
        if (stopped) return;
        stopped = true;
        queued = false;
        clearTimers();
        invalidate('Replay video is unavailable.');
        host.removeEventListener('pagehide', onHide);
        host.removeEventListener('pageshow', onShow);
        host.removeEventListener('beforeunload', onHide);
        doc.removeEventListener('visibilitychange', onVisibility);
    };
    host.addEventListener('pagehide', onHide);
    host.addEventListener('pageshow', onShow);
    host.addEventListener('beforeunload', onHide);
    doc.addEventListener('visibilitychange', onVisibility);
    return { refresh: request, invalidateAndRefresh, stop };
}
