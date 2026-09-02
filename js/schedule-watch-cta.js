import {
    getGameReplayLifecycle,
    resolveGameReplayPlaybackSource
} from './game-replay-video.js?v=2';

function normalizeStatus(value) {
    return String(value || '').trim().toLowerCase();
}

function isPrivateGame(game) {
    return game?.isPrivate === true || normalizeStatus(game?.visibility) === 'private';
}

function isDeletedGame(game) {
    return normalizeStatus(game?.status) === 'deleted' || normalizeStatus(game?.liveStatus) === 'deleted';
}

function isCancelledGame(game) {
    return game?.isCancelled === true
        || ['cancelled', 'canceled'].includes(normalizeStatus(game?.status))
        || ['cancelled', 'canceled'].includes(normalizeStatus(game?.liveStatus));
}

function hasCompletedReplayLifecycle(game) {
    return getGameReplayLifecycle(game).isCompleted;
}

export function hasReplayVideoEvidence(game) {
    const playbackSource = resolveGameReplayPlaybackSource(game);
    if (playbackSource.state === 'playable') return true;
    if (playbackSource.state !== 'none') return false;
    return game?.hasReplayVideo === true;
}

export function resolveScheduleWatchCta(game) {
    if (!game || normalizeStatus(game.type) === 'practice') return null;
    if (isCancelledGame(game) || isDeletedGame(game) || isPrivateGame(game)) return null;

    const teamId = String(game.teamId || '').trim();
    const gameId = String(game.gameId || game.id || '').trim();
    if (!teamId || !gameId) return null;

    const lifecycle = getGameReplayLifecycle(game);
    const hasCompletedLivePlayback = ['completed', 'final'].includes(lifecycle.liveStatus);
    if (hasCompletedReplayLifecycle(game)
        && (hasCompletedLivePlayback || hasReplayVideoEvidence(game))) {
        return {
            kind: 'replay',
            label: 'Watch Replay',
            href: `live-game.html?teamId=${encodeURIComponent(teamId)}&gameId=${encodeURIComponent(gameId)}&replay=true`
        };
    }

    if (lifecycle.isActiveLive) {
        return {
            kind: 'live',
            label: 'Watch Live',
            href: `live-game.html?teamId=${encodeURIComponent(teamId)}&gameId=${encodeURIComponent(gameId)}`
        };
    }

    return null;
}
