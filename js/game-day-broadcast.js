const endedGameStatuses = new Set(['cancelled', 'canceled', 'completed', 'final', 'deleted']);
const liveBroadcastStatuses = new Set(['live', 'streaming']);
const readyBroadcastStatuses = new Set(['ready', 'ready_for_managed_stream']);
const failedBroadcastStatuses = new Set(['failed', 'error']);
const runtimeBroadcastStatuses = new Set(['ready', 'starting', 'live', 'failed']);

export function canOpenGameDayBroadcastSetup(game = {}) {
    const status = String(game.liveStatus || game.status || '').trim().toLowerCase();
    return !endedGameStatuses.has(status);
}

export function buildGameDayBroadcastSetupUrl({ teamId, gameId, game = {} } = {}) {
    const safeTeamId = String(teamId || '').trim();
    const safeGameId = String(gameId || '').trim();
    if (!safeTeamId || !safeGameId || !canOpenGameDayBroadcastSetup(game)) return '';

    const params = new URLSearchParams({
        teamId: safeTeamId,
        gameId: safeGameId,
        broadcast: 'setup'
    });
    return `live-game.html#${params.toString()}`;
}

export function resolveGameDayBroadcastStatus(game = {}) {
    if (!canOpenGameDayBroadcastSetup(game)) {
        return {
            state: 'unavailable',
            label: 'Broadcast setup is unavailable after the game ends.'
        };
    }

    const session = game.broadcastSession || {};
    const streamStatus = String(
        session.localStreamStatus || session.runtimeStatus || session.streamStatus || session.status || ''
    ).trim().toLowerCase();
    if (liveBroadcastStatuses.has(streamStatus)) {
        return {
            state: 'live',
            label: 'Live device streaming is active.'
        };
    }

    if (failedBroadcastStatuses.has(streamStatus)) {
        return {
            state: 'failed',
            label: 'Device streaming needs attention. Open setup to retry.'
        };
    }

    if (session.managedStreamReady === true || readyBroadcastStatuses.has(streamStatus)) {
        return {
            state: 'ready',
            label: 'Broadcast setup is ready. Open it to Begin Streaming.'
        };
    }

    return {
        state: 'setup_required',
        label: 'Broadcast setup is required before streaming can begin.'
    };
}

export function buildBroadcastRuntimeSession({ existingSession, status, now = new Date() } = {}) {
    if (!existingSession || typeof existingSession !== 'object') return null;
    const safeStatus = String(status || '').trim().toLowerCase();
    if (!runtimeBroadcastStatuses.has(safeStatus)) return null;
    const updatedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();

    return {
        ...existingSession,
        localStreamStatus: safeStatus,
        localStreamActive: safeStatus === 'live',
        localStreamUpdatedAt: updatedAt,
        updatedAt
    };
}
