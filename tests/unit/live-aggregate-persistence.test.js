import { expect, it, vi } from 'vitest';
import { persistLiveAggregateSnapshot } from '../../js/live-aggregate-persistence.js';
import { liveStatsMetadata } from '../../js/live-aggregate-stats.js';

function fixture(game, existing = {}) {
    const set = vi.fn(), remove = vi.fn();
    const gameRef = { path: 'fixture/game' }, statsRef = { path: 'fixture/stats' };
    const runTransaction = vi.fn(async (_db, callback) => callback({
        get: async ref => ({ data: () => ref === gameRef ? game : existing }),
        set, delete: remove
    }));
    return { set, remove, options: { db: {}, runTransaction, gameRef, statsRef,
        payload: { stats: { pts: 12 }, timeMs: 123 }, expectedEpoch: liveStatsMetadata(game).liveStatsEpoch } };
}

it('refuses delayed old-epoch writes before staging any mutation', async () => {
    const f = fixture({ liveResetEventId: 'new' });
    await expect(persistLiveAggregateSnapshot({ ...f.options, expectedEpoch: 'id:old' })).rejects.toThrow('reset changed');
    expect(f.set).not.toHaveBeenCalled();
});

it('never replaces ambiguous untagged historical totals with a partial snapshot', async () => {
    const f = fixture({ liveResetAt: 1000 }, { stats: { pts: 10, reb: 4 } });
    await expect(persistLiveAggregateSnapshot(f.options)).rejects.toThrow('unknown reset epoch');
    expect(f.set).not.toHaveBeenCalled();
});

it('replaces the complete map and participation metadata only within the checked epoch', async () => {
    const game = { liveResetEventId: 'new' };
    const f = fixture(game, { stats: { pts: 10 }, ...liveStatsMetadata(game) });
    await persistLiveAggregateSnapshot(f.options);
    expect(f.set).toHaveBeenCalledExactlyOnceWith(f.options.statsRef,
        { stats: { pts: 12 }, timeMs: 123, liveStatsVersion: 1, liveStatsEpoch: 'id:new' },
        { mergeFields: ['stats', 'timeMs', 'liveStatsVersion', 'liveStatsEpoch'] });
});

it('does not expose private fields in the public aggregate transaction write', async () => {
    const f = fixture({});
    const privateRef = { path: 'fixture/private' };
    await persistLiveAggregateSnapshot({ ...f.options, privateRef, privatePayload: { stats: { privateNotes: 1 } } });
    expect(f.set.mock.calls[0][1]).not.toHaveProperty('privateNotes');
    expect(f.set.mock.calls[1]).toEqual([privateRef, { stats: { privateNotes: 1 }, liveStatsVersion: 1, liveStatsEpoch: '' }]);
});

it('refuses an older queued finalization with no captured epoch', async () => {
    const f = fixture({});
    await expect(persistLiveAggregateSnapshot({ ...f.options, expectedEpoch: undefined })).rejects.toThrow('Missing');
    expect(f.options.runTransaction).not.toHaveBeenCalled();
});

it('guards zero-player completion and rejects a reset after the last stat write', async () => {
    const { persistLiveEpochWrites } = await import('../../js/live-aggregate-persistence.js');
    const update = vi.fn(), set = vi.fn();
    let game = { liveResetEventId: 'old' };
    const options = { db: {}, gameRef: {}, expectedEpoch: 'id:old',
        writes: [{ kind: 'update', ref: {}, data: { status: 'completed', homeScore: 12 } }],
        runTransaction: async (_db, callback) => callback({ get: async () => ({ data: () => game }), update, set }) };
    await persistLiveEpochWrites(options);
    expect(update).toHaveBeenCalledTimes(1);
    update.mockClear();
    game = { liveResetEventId: 'new' };
    await expect(persistLiveEpochWrites(options)).rejects.toThrow('reset changed');
    expect(update).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    await expect(persistLiveEpochWrites({ ...options, writes: [{ kind: 'set', ref: {}, data: { text: 'old event' } }] })).rejects.toThrow('reset changed');
    expect(set).not.toHaveBeenCalled();
});
