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

export function deriveResumeClockState(liveEvents, defaults = { period: 'Q1', clock: 0 }) {
    const fallbackPeriod = defaults?.period || 'Q1';
    const fallbackClock = Number.isFinite(defaults?.clock) ? defaults.clock : 0;

    if (!Array.isArray(liveEvents) || liveEvents.length === 0) {
        return { period: fallbackPeriod, clock: fallbackClock, restored: false };
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
        return { period: fallbackPeriod, clock: fallbackClock, restored: false };
    }

    const withTimestamp = candidates.filter(item => Number.isFinite(item.createdAtMs));
    if (withTimestamp.length) {
        const latest = withTimestamp.reduce((best, item) => {
            if (!best) return item;
            if (item.createdAtMs > best.createdAtMs) return item;
            if (item.createdAtMs === best.createdAtMs && item.order > best.order) return item;
            return best;
        }, null);
        return { period: latest.period, clock: latest.clock, restored: true };
    }

    const furthest = candidates.reduce((best, item) => {
        if (!best) return item;
        const bestPeriod = periodOrder(best.period);
        const itemPeriod = periodOrder(item.period);
        if (itemPeriod > bestPeriod) return item;
        if (itemPeriod === bestPeriod && item.clock > best.clock) return item;
        return best;
    }, null);

    return { period: furthest.period, clock: furthest.clock, restored: true };
}
