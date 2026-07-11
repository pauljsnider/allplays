const endedGameStatuses = new Set(['cancelled', 'canceled', 'completed', 'final', 'deleted']);
const liveBroadcastStatuses = new Set(['live', 'streaming']);
const readyBroadcastStatuses = new Set(['ready', 'ready_for_managed_stream']);
const failedBroadcastStatuses = new Set(['failed', 'error', 'permission_failed']);
const runtimeBroadcastStatuses = new Set(['ready', 'live', 'failed']);
export const BROADCAST_STREAM_HEARTBEAT_MS = 15_000;
export const BROADCAST_STREAM_LEASE_MS = 45_000;

function toTimeMs(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value?.toDate === 'function') return value.toDate().getTime();
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function canOpenGameDayBroadcastSetup(game = {}) {
    const statuses = [game.status, game.liveStatus]
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean);
    return !statuses.some(status => endedGameStatuses.has(status));
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

export function resolveGameDayBroadcastStatus(game = {}, { now = new Date() } = {}) {
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
    const leaseExpiresAtMs = toTimeMs(session.localStreamLeaseExpiresAt);
    const nowMs = toTimeMs(now) ?? Date.now();
    if (liveBroadcastStatuses.has(streamStatus) && leaseExpiresAtMs !== null && leaseExpiresAtMs > nowMs) {
        return {
            state: 'live',
            label: 'Live device streaming is active.'
        };
    }

    if (liveBroadcastStatuses.has(streamStatus)) {
        return {
            state: 'stale',
            label: 'The last live device signal expired. Open setup to resume streaming.'
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

export function buildBroadcastRuntimeSession({ existingSession, status, user = {}, now = new Date() } = {}) {
    if (!existingSession || typeof existingSession !== 'object') return null;
    if (!existingSession.id || !existingSession.name || !existingSession.status ||
        !existingSession.provider || !existingSession.permissions || !existingSession.createdAt) return null;
    const safeStatus = String(status || '').trim().toLowerCase();
    if (!runtimeBroadcastStatuses.has(safeStatus)) return null;
    const updatedAt = now instanceof Date ? new Date(now.getTime()) : new Date(now);
    if (Number.isNaN(updatedAt.getTime())) return null;
    const session = {
        id: existingSession.id,
        name: existingSession.name,
        status: existingSession.status,
        provider: existingSession.provider,
        permissions: existingSession.permissions,
        createdAt: existingSession.createdAt,
        localStreamStatus: safeStatus,
        localStreamActive: safeStatus === 'live',
        localStreamUpdatedAt: updatedAt,
        updatedAt,
        updatedBy: String(user?.uid || existingSession.updatedBy || '').trim() || null
    };
    if (existingSession.errorMessage) session.errorMessage = existingSession.errorMessage;
    if (safeStatus === 'live') {
        session.localStreamLeaseExpiresAt = new Date(updatedAt.getTime() + BROADCAST_STREAM_LEASE_MS);
    } else {
        delete session.localStreamLeaseExpiresAt;
    }
    return session;
}
