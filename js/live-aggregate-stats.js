// Live totals use the tracker's canonical aggregates, never aggregate + event deltas.
// Replay remains event-driven. Metadata certifies the reset epoch of the contents.
export function getLiveStatsEpoch(game = {}) {
    const id = typeof game.liveResetEventId === 'string' ? game.liveResetEventId.trim() : '';
    if (id) return `id:${id}`;
    const value = game.liveResetAt;
    const time = typeof value?.toMillis === 'function' ? value.toMillis()
        : typeof value?.toDate === 'function' ? value.toDate().getTime()
            : value instanceof Date ? value.getTime()
                : typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(time) && time > 0 ? `time:${time}` : '';
}

export function liveStatsMetadata(game = {}) {
    return { liveStatsVersion: 1, liveStatsEpoch: getLiveStatsEpoch(game) };
}

export function liveStatsMatchEpoch(row = {}, game = {}) {
    const epoch = getLiveStatsEpoch(game);
    if (row.liveStatsVersion === undefined && row.liveStatsEpoch === undefined) return epoch === '';
    return row.liveStatsVersion === 1 && row.liveStatsEpoch === epoch;
}

export function readLiveStats(row = {}, game = {}) {
    if (!liveStatsMatchEpoch(row, game)) return {};
    return Object.fromEntries(Object.entries(row.stats || {}).filter(([key, value]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key) && typeof value === 'number' && Number.isFinite(value)));
}

export function readLiveStatsForWrite(row = {}, game = {}) {
    // Untagged nonempty history after a reset is ambiguous, not known zero.
    // Refuse destructive replacement until its epoch can be reconciled.
    if (getLiveStatsEpoch(game) && row.liveStatsVersion === undefined &&
        row.liveStatsEpoch === undefined && Object.keys(row.stats || {}).length) {
        throw new Error('Existing player totals have an unknown reset epoch; they were not changed.');
    }
    return readLiveStats(row, game);
}

export function applyLiveAggregateTotals(state, rows, { received = true, epochGame = state.game || {} } = {}) {
    if (!received || state.isReplay || state.liveStatus === 'replay') return;
    const accepted = {};
    let unknown = false;
    for (const row of rows) {
        if (!liveStatsMatchEpoch(row, epochGame)) { unknown = true; continue; }
        if (typeof row.id !== 'string' || !row.id || ['__proto__', 'constructor', 'prototype'].includes(row.id)) {
            unknown = true; continue;
        }
        accepted[row.id] = readLiveStats(row, epochGame);
    }
    // Empty old games may be event-only. Do not certify their event-derived totals.
    // Once aggregates are observed, deletions are authoritative empty totals.
    if (rows.length || state.hasAggregateTotals || getLiveStatsEpoch(epochGame)) {
        state.stats = accepted;
        state.hasAggregateTotals = true;
    }
    state.aggregateTotalsStatus = unknown ? 'incomplete' : state.hasAggregateTotals ? 'ready' : 'event-only';
}
