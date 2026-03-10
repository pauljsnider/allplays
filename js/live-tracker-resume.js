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

export function deriveResumeClockState(liveEvents, defaults = { period: 'Q1', clock: 0 }, persistedClockState = null) {
    const fallbackPeriod = defaults?.period || 'Q1';
    const fallbackClock = Number.isFinite(defaults?.clock) ? defaults.clock : 0;
    const persistedPeriod = typeof persistedClockState?.liveClockPeriod === 'string'
        ? persistedClockState.liveClockPeriod
        : null;
    const persistedClock = Number(persistedClockState?.liveClockMs);
    const persistedState = (
        persistedPeriod &&
        Number.isFinite(persistedClock) &&
        persistedClock >= 0
    )
        ? { period: persistedPeriod, clock: persistedClock, restored: true }
        : null;

    if (!Array.isArray(liveEvents) || liveEvents.length === 0) {
        return persistedState || { period: fallbackPeriod, clock: fallbackClock, restored: false };
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
        return persistedState || { period: fallbackPeriod, clock: fallbackClock, restored: false };
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
