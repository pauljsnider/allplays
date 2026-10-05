import { resolveGameReplayPlaybackSource } from './game-replay-video.js?v=3';

export function unavailableReplayPlayback(message = 'Replay video is unavailable.') {
    return {
        mode: 'none', hasVideo: false, isRecordedReplay: false,
        sourceUrl: null, publicUrl: null,
        replayState: { status: 'unavailable', message }
    };
}

// Public projections omit private archive URLs (older adapters also omit the
// archive marker). Only this
// callable may release playback to the current principal; never cache its URL
// in a game document or fall back to an older URL after denial/removal.
export async function resolveAuthorizedReplayPlayback({ teamId, gameId, clipStartMs, clipEndMs }, deps = {}) {
    try {
        const firebase = deps.firebase || await import('./firebase.js?v=33');
        const readPlayback = firebase.httpsCallable(firebase.functions, 'getGameReplayPlayback');
        const { data } = await readPlayback({ teamId, gameId });
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
