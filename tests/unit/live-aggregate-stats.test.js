import { describe, expect, it } from 'vitest';
import { applyLiveAggregateTotals, getLiveStatsEpoch, liveStatsMetadata, readLiveStats } from '../../js/live-aggregate-stats.js';
import { createOverlayState, reconcileOverlayLiveEvents } from '../../js/live-game-overlay-model.js';
import { createOverlayEventHistory } from '../../js/live-game-overlay-feed.js';
import * as stateTools from '../../js/live-game-state.js';

describe.each([
    ['Basketball', 'pts'], ['Soccer', 'goals'], ['Baseball', 'hits'],
    ['Softball', 'runs'], ['Football', 'yards'], ['Volleyball', 'kills'], ['Custom', 'custom']
])('%s canonical live totals', (sport, key) => {
    it('keeps full-game totals beyond the history cap without adding event deltas twice', () => {
        const game = { liveStatus: 'live', sport };
        const state = createOverlayState({ game });
        const history = createOverlayEventHistory();
        const events = Array.from({ length: 2101 }, (_, index) => ({ id: `e${index}`,
            type: 'stat', playerId: index % 2 ? 'b' : 'a', statKey: key,
            value: 1, createdAt: index + 1 }));
        const aggregates = [{ id: 'a', stats: { [key]: 1051 }, ...liveStatsMetadata(game) },
            { id: 'b', stats: { [key]: 1050 }, ...liveStatsMetadata(game) }];
        for (let n = 0; n < events.length; n += 20) history.window(events.slice(n, n + 20));
        expect(history.incomplete).toBe(true);
        for (let delivery = 0; delivery < 2; delivery++) {
            // Aggregate-before-event and duplicate event delivery must converge.
            applyLiveAggregateTotals(state, aggregates);
            reconcileOverlayLiveEvents(state, history.values(), stateTools);
            applyLiveAggregateTotals(state, aggregates);
            expect(state.stats).toEqual({ a: { [key]: 1051 }, b: { [key]: 1050 } });
        }
        applyLiveAggregateTotals(state, [{ ...aggregates[0], stats: { [key]: 1050 } }, aggregates[1]]);
        expect(state.stats.a[key]).toBe(1050); // authoritative negative correction
    });

    it('restores 10 saved points plus a new 2 without replaying the saved baseline', () => {
        const game = { liveStatus: 'live', sport };
        const state = createOverlayState({ game });
        const saved = { id: 'a', stats: { [key]: 10 } };
        expect(readLiveStats(saved, game)[key]).toBe(10);
        const event = { id: 'new', type: 'stat', playerId: 'a', statKey: key, value: 2, createdAt: 1 };
        reconcileOverlayLiveEvents(state, [event], stateTools);
        applyLiveAggregateTotals(state, [{ ...saved, stats: { [key]: 12 }, ...liveStatsMetadata(game) }]);
        expect(state.stats.a[key]).toBe(12);
        applyLiveAggregateTotals(state, [{ ...saved, stats: { [key]: 12 }, ...liveStatsMetadata(game) }]);
        expect(state.stats.a[key]).toBe(12);
    });
});

it('rejects prior and untagged aggregate records after reset instead of relabeling their contents', () => {
    const before = { liveResetEventId: 'old' }, after = { liveResetEventId: 'new' };
    const row = { id: 'a', stats: { pts: 20, reb: 9 }, ...liveStatsMetadata(before) };
    expect(readLiveStats(row, after)).toEqual({});
    expect(readLiveStats({ stats: { pts: 20 } }, after)).toEqual({});
    const state = { game: after, stats: { a: { pts: 20 } } };
    applyLiveAggregateTotals(state, [row]);
    expect(state.stats).toEqual({});
    expect(state.aggregateTotalsStatus).toBe('incomplete');
    applyLiveAggregateTotals(state, [{ id: 'a', stats: { pts: 2 }, ...liveStatsMetadata(after) }]);
    expect(state.stats).toEqual({ a: { pts: 2 } });
    applyLiveAggregateTotals(state, []);
    expect(state.stats).toEqual({});
});

it('does not put final aggregates into replay or certify event-only fallback as complete', () => {
    const replay = { liveStatus: 'replay', stats: { a: { pts: 2 } } };
    applyLiveAggregateTotals(replay, [{ id: 'a', stats: { pts: 100 } }]);
    expect(replay.stats.a.pts).toBe(2);
    const live = { game: {}, stats: { a: { pts: 2 } } };
    applyLiveAggregateTotals(live, []);
    expect(live.stats.a.pts).toBe(2);
    expect(live.aggregateTotalsStatus).toBe('event-only');
});

it('recognizes timestamp-only reset epochs and excludes nonnumeric/private envelope fields', () => {
    const game = { liveResetAt: { toMillis: () => 1234 } };
    expect(getLiveStatsEpoch(game)).toBe('time:1234');
    expect(readLiveStats({ ...liveStatsMetadata(game), privateStats: { secret: 9 },
        stats: { pts: 2, bad: Infinity, name: 'private' } }, game)).toEqual({ pts: 2 });
});
