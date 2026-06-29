function toMillis(value) {
    if (value == null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value?.toMillis === 'function') {
        const ms = value.toMillis();
        return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === 'object' && Number.isFinite(value.seconds)) {
        const nanos = Number.isFinite(value.nanoseconds) ? value.nanoseconds : 0;
        return (value.seconds * 1000) + Math.floor(nanos / 1000000);
    }
    return null;
}

function periodOrder(period) {
    const value = String(period || '').trim().toUpperCase();
    const quarterMatch = value.match(/^Q(\d+)$/);
    if (quarterMatch) return Number(quarterMatch[1]);

    const otMatch = value.match(/^OT(?:\s*|[-]?)(\d+)?$/);
    if (otMatch) return 100 + Number(otMatch[1] || 1);

    return 0;
}

function compareProgress(a, b) {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;

    const periodDiff = periodOrder(a.period) - periodOrder(b.period);
    if (periodDiff !== 0) return periodDiff;

    const clockDiff = a.clock - b.clock;
    if (clockDiff !== 0) return clockDiff;

    return a.order - b.order;
}

function pickMostAdvanced(candidates) {
    return candidates.reduce((best, item) => (
        compareProgress(item, best) > 0 ? item : best
    ), null);
}

export function buildPersistedResumeClockState(game) {
    return {
        liveClockPeriod: game?.liveClockPeriod,
        liveClockMs: game?.liveClockMs,
        liveClockRunning: game?.liveClockRunning,
        liveClockUpdatedAt: game?.liveClockUpdatedAt,
        period: game?.period,
        gameClockMs: game?.gameClockMs,
        clock: game?.clock
    };
}

function formatResumeLogClock(ms) {
    const safeMs = Math.max(0, Number(ms) || 0);
    const totalSeconds = Math.floor(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function buildStatUndoDataFromLiveEvent(event) {
    const undoData = {
        type: 'stat',
        playerId: event?.playerId || null,
        statKey: event?.statKey || null,
        value: Number(event?.value || 0),
        isOpponent: Boolean(event?.isOpponent)
    };

    if (Object.prototype.hasOwnProperty.call(event || {}, 'streamRelativeTimestampMs')) {
        undoData.videoTimestampCaptureActive = event.videoTimestampCaptureActive;
        undoData.streamRelativeTimestampMs = event.streamRelativeTimestampMs;
        undoData.videoTimestampUnavailableReason = event.videoTimestampUnavailableReason;
    }

    return undoData;
}

function isReversalStatBroadcast(event) {
    if (event?.type !== 'stat') return false;

    const value = Number(event?.value || 0);
    if (!Number.isFinite(value) || value >= 0) return false;

    const text = typeof event?.description === 'string' ? event.description.trim().toUpperCase() : '';
    return text.startsWith('UNDO ') || text.startsWith('REMOVE ');
}

function findReversedLogEntryIndex(entries, event) {
    const reversedValue = Math.abs(Number(event?.value || 0));
    const playerId = event?.playerId || null;
    const statKey = String(event?.statKey || '').toLowerCase();
    const isOpponent = Boolean(event?.isOpponent);

    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const undoData = entries[index]?.undoData;
        if (!undoData || undoData.type !== 'stat') continue;
        if ((undoData.playerId || null) !== playerId) continue;
        if (String(undoData.statKey || '').toLowerCase() !== statKey) continue;
        if (Boolean(undoData.isOpponent) !== isOpponent) continue;
        if (Number(undoData.value || 0) !== reversedValue) continue;
        return index;
    }

    return -1;
}

export function buildResumeLogFromLiveEvents(liveEvents = [], { now = () => Date.now() } = {}) {
    if (!Array.isArray(liveEvents) || liveEvents.length === 0) return [];

    const entries = [];

    liveEvents.forEach((event, index) => {
        const type = event?.type;
        if (type !== 'stat' && type !== 'note') return;

        if (isReversalStatBroadcast(event)) {
            const reversedIndex = findReversedLogEntryIndex(entries, event);
            if (reversedIndex >= 0) {
                entries.splice(reversedIndex, 1);
            }
            return;
        }

        const text = typeof event?.description === 'string' ? event.description.trim() : '';
        if (!text) return;

        const createdAtMs = toMillis(event.createdAt);
        const clock = Number(event?.gameClockMs);
        const entry = {
            text,
            ts: createdAtMs ?? now(),
            period: typeof event?.period === 'string' ? event.period : '',
            clock: formatResumeLogClock(Number.isFinite(clock) ? clock : 0),
            __resumeOrder: index,
            __resumeCreatedAtMs: createdAtMs
        };

        if (type === 'stat') {
            entry.undoData = buildStatUndoDataFromLiveEvent(event);
        }

        entries.push(entry);
    });

    return entries
        .sort((a, b) => {
            const aTime = Number.isFinite(a.__resumeCreatedAtMs) ? a.__resumeCreatedAtMs : null;
            const bTime = Number.isFinite(b.__resumeCreatedAtMs) ? b.__resumeCreatedAtMs : null;
            if (aTime !== null && bTime !== null && aTime !== bTime) return bTime - aTime;
            return b.__resumeOrder - a.__resumeOrder;
        })
        .map(({ __resumeOrder, __resumeCreatedAtMs, ...entry }) => entry);
}

export function buildResumeLineupElapsedMs(resumeClockState, { localStateSavedAt = null } = {}) {
    const elapsedWhileRunningMs = Math.max(0, Number(resumeClockState?.elapsedWhileRunningMs) || 0);
    if (!elapsedWhileRunningMs) return 0;

    if (localStateSavedAt == null) return elapsedWhileRunningMs;

    const localSavedAtMs = toMillis(localStateSavedAt);
    if (!Number.isFinite(localSavedAtMs)) return 0;

    const resumeEvaluatedAtMs = Number(resumeClockState?.resumeEvaluatedAtMs);
    if (!Number.isFinite(resumeEvaluatedAtMs)) return 0;

    const persistedUpdatedAtMs = Number(resumeClockState?.persistedUpdatedAtMs);
    const elapsedStartMs = Number.isFinite(persistedUpdatedAtMs)
        ? Math.max(persistedUpdatedAtMs, localSavedAtMs)
        : localSavedAtMs;

    return Math.max(0, resumeEvaluatedAtMs - elapsedStartMs);
}

export function deriveResumeClockState(liveEvents, defaults = { period: 'Q1', clock: 0 }, persistedClockState = null, { now = () => Date.now() } = {}) {
    const fallbackPeriod = defaults?.period || 'Q1';
    const fallbackClock = Number.isFinite(defaults?.clock) ? defaults.clock : 0;
    const persistedPeriod = [
        persistedClockState?.liveClockPeriod,
        persistedClockState?.period
    ].find((value) => typeof value === 'string' && value.trim());
    const persistedClock = Number(
        persistedClockState?.liveClockMs ??
        persistedClockState?.gameClockMs ??
        persistedClockState?.clock
    );
    const persistedUpdatedAtMs = toMillis(persistedClockState?.liveClockUpdatedAt);
    const persistedRunning = persistedClockState?.liveClockRunning === true;
    const resumeEvaluatedAtMs = now();
    const elapsedWhileRunningMs = (
        persistedRunning &&
        Number.isFinite(persistedUpdatedAtMs)
    )
        ? Math.max(0, resumeEvaluatedAtMs - persistedUpdatedAtMs)
        : 0;
    const persistedState = (
        persistedPeriod &&
        Number.isFinite(persistedClock) &&
        persistedClock >= 0
    )
        ? {
            period: persistedPeriod,
            clock: persistedClock + elapsedWhileRunningMs,
            restored: true,
            running: persistedRunning,
            elapsedWhileRunningMs,
            persistedUpdatedAtMs,
            resumeEvaluatedAtMs
        }
        : null;

    if (persistedState?.running) {
        return persistedState;
    }

    if (!Array.isArray(liveEvents) || liveEvents.length === 0) {
        return persistedState || { period: fallbackPeriod, clock: fallbackClock, restored: false, running: false, elapsedWhileRunningMs: 0 };
    }

    const candidates = liveEvents
        .map((event, index) => {
            const period = typeof event?.period === 'string' ? event.period : null;
            const clock = Number(event?.gameClockMs);
            if (!period || !Number.isFinite(clock) || clock < 0) return null;

            return {
                period,
                clock,
                createdAtMs: toMillis(event.createdAt),
                order: index
            };
        })
        .filter(Boolean);

    if (!candidates.length) {
        return persistedState || { period: fallbackPeriod, clock: fallbackClock, restored: false, running: false, elapsedWhileRunningMs: 0 };
    }

    const withTimestamp = candidates.filter(item => Number.isFinite(item.createdAtMs));
    if (withTimestamp.length && withTimestamp.length === candidates.length) {
        const latest = withTimestamp.reduce((best, item) => {
            if (!best) return item;
            if (item.createdAtMs > best.createdAtMs) return item;
            if (item.createdAtMs === best.createdAtMs && item.order > best.order) return item;
            return best;
        }, null);
        return { period: latest.period, clock: latest.clock, restored: true };
    }

    if (!withTimestamp.length) {
        const furthest = pickMostAdvanced(candidates);
        return { period: furthest.period, clock: furthest.clock, restored: true };
    }

    // Mixed datasets can include pending serverTimestamp() writes (createdAt: null).
    // In this case, preserve recency from snapshot order instead of ignoring untimestamped events.
    const latestByOrder = candidates.reduce(
        (best, item) => (item.order > best.order ? item : best),
        candidates[0]
    );
    return { period: latestByOrder.period, clock: latestByOrder.clock, restored: true };
}
