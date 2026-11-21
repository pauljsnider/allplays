import { buildTrackStatsheetApplyPlan } from '../../js/track-statsheet-apply.js';
import { commitStandardTrackerFinishData } from '../../js/track-finish.js';
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createLiveStatsReplacementBatch, persistLiveAggregateSnapshot } from '../../js/live-aggregate-persistence.js';
import { getLiveStatsEpoch, liveStatsMetadata, readLiveStatsForWrite, applyLiveAggregateTotals } from '../../js/live-aggregate-stats.js';
import { splitPlayerStatsByVisibility } from '../../js/stat-leaderboards.js';

function storeFixture(game = { liveResetAt: 1000 }) {
    const gameRef = { path: 'teams/t/games/g' };
    const publicRef = { path: `${gameRef.path}/aggregatedStats/p` };
    const privateRef = { path: `${gameRef.path}/privatePlayerStats/p` };
    const rows = new Map([[gameRef.path, game]]);
    const runTransaction = async (_db, callback) => {
        const writes = [];
        await callback({
            get: async ref => { expect(writes).toHaveLength(0); return { data: () => structuredClone(rows.get(ref.path)) }; },
            set: (ref, data) => writes.push(() => rows.set(ref.path, structuredClone(data))),
            delete: ref => writes.push(() => rows.delete(ref.path)),
            update: (ref, data) => writes.push(() => rows.set(ref.path, { ...rows.get(ref.path), ...structuredClone(data) }))
        });
        writes.forEach(write => write());
    };
    return { gameRef, publicRef, privateRef, rows, runTransaction, db: {} };
}

it('statsheet replacement establishes a new epoch, rejects old live finish and reopens public/private totals', async () => {
    const f = storeFixture();
    const batch = createLiveStatsReplacementBatch({ ...f, expectedEpoch: 'time:1000', resetEventId: 'import', resetAt: 2000 });
    batch.set(f.publicRef, { stats: { pts: 12 } });
    batch.set(f.privateRef, { stats: { effort: 7 } });
    batch.update(f.gameRef, { status: 'completed' });
    await batch.commit();
    const game = f.rows.get(f.gameRef.path);
    expect(readLiveStatsForWrite(f.rows.get(f.publicRef.path), game)).toEqual({ pts: 12 });
    expect(readLiveStatsForWrite(f.rows.get(f.privateRef.path), game)).toEqual({ effort: 7 });
    const viewer = { game, stats: {} };
    applyLiveAggregateTotals(viewer, [{ id: 'p', ...f.rows.get(f.publicRef.path) }]);
    expect(viewer.stats).toEqual({ p: { pts: 12 } });
    await expect(persistLiveAggregateSnapshot({ ...f, statsRef: f.publicRef, expectedEpoch: 'time:1000', payload: { stats: { pts: 2 } } })).rejects.toThrow('reset changed');
    expect(f.rows.get(f.publicRef.path).stats).toEqual({ pts: 12 });
});

it('a reset while a statsheet waits rejects the entire replacement without cleanup writes', async () => {
    const f = storeFixture(); f.rows.set(f.publicRef.path, { stats: { pts: 99 } });
    const batch = createLiveStatsReplacementBatch({ ...f, expectedEpoch: 'time:1000', resetEventId: 'import' });
    batch.delete(f.publicRef); batch.update(f.gameRef, { status: 'completed' });
    f.rows.set(f.gameRef.path, { liveResetEventId: 'other' });
    await expect(batch.commit()).rejects.toThrow('reset changed');
    expect(f.rows.get(f.publicRef.path).stats.pts).toBe(99);
    expect(f.rows.get(f.gameRef.path).status).toBeUndefined();
});

it('live finish certifies private totals separately and can reopen them in Beta', async () => {
    const f = storeFixture();
    await persistLiveAggregateSnapshot({ ...f, statsRef: f.publicRef, expectedEpoch: 'time:1000',
        payload: { stats: { pts: 12 } }, privatePayload: { stats: { effort: 7 } } });
    const game = f.rows.get(f.gameRef.path);
    expect(readLiveStatsForWrite(f.rows.get(f.privateRef.path), game)).toEqual({ effort: 7 });
    expect(f.rows.get(f.publicRef.path).stats).toEqual({ pts: 12 });
});

it('does not silently overwrite ambiguous private history during a delayed live sync', async () => {
    const f = storeFixture(); f.rows.set(f.privateRef.path, { stats: { effort: 17 } });
    await expect(persistLiveAggregateSnapshot({ ...f, statsRef: f.publicRef, expectedEpoch: 'time:1000',
        payload: { stats: { pts: 12 } }, privatePayload: { stats: { effort: 0 } } })).rejects.toThrow('unknown reset epoch');
    expect(f.rows.has(f.publicRef.path)).toBe(false);
    expect(f.rows.get(f.privateRef.path).stats.effort).toBe(17);
});

function dbWriter(name, f) {
    const source = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
    const start = source.indexOf(`export async function ${name}(`);
    const end = source.indexOf('\nexport ', start + 1);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end).replace('export ', '');
    return runInNewContext(`${body}\n${name}`, { ...f, splitPlayerStatsByVisibility,
        getLiveStatsEpoch, liveStatsMetadata, readLiveStatsForWrite,
        getGameDocRef: () => f.gameRef, doc: (_db, path, id) => ({ path: `${path}/${id}` }) });
}

it('post-game edits replace both maps with current epoch and reject an older editor after reset', async () => {
    const f = storeFixture(); const save = dbWriter('setCompletedGamePlayerStats', f);
    const payload = { expectedEpoch: 'time:1000', stats: { pts: 12, effort: 7 },
        statTrackerConfig: { columns: ['PTS', 'EFFORT'], statDefinitions: [{ id: 'effort', scope: 'player', visibility: 'private' }] } };
    await save('t', 'g', 'p', payload);
    expect(f.rows.get(f.publicRef.path).stats).toEqual({ pts: 12 });
    expect(f.rows.get(f.privateRef.path).stats).toEqual({ effort: 7 });
    f.rows.set(f.gameRef.path, { liveResetEventId: 'new' });
    await expect(save('t', 'g', 'p', payload)).rejects.toThrow('reset changed');
});

it('legacy private increments preserve private epoch without creating a public secret', async () => {
    const f = storeFixture(); const increment = dbWriter('updatePlayerStats', f);
    await increment('t', 'g', 'p', 'effort', 2, 'P', '1', { statTrackerConfig: {
        statDefinitions: [{ id: 'effort', scope: 'player', visibility: 'private' }] } });
    expect(f.rows.has(f.publicRef.path)).toBe(false);
    expect(f.rows.get(f.privateRef.path)).toMatchObject({ stats: { effort: 2 }, liveStatsEpoch: 'time:1000' });
});


it('statsheet private columns remain private through standard reopen and finish', async () => {
    const config = { columns: ['PTS', 'FOULS'], statDefinitions: [{ id: 'pts', scope: 'player', visibility: 'private' }] };
    const plan = buildTrackStatsheetApplyPlan({ roster: [{ id: 'p', name: 'P', number: '1' }], columns: config.columns, statTrackerConfig: config,
        includedHome: [{ mappedPlayerId: 'p', totalPoints: 12, fouls: 3 }] });
    expect(plan.aggregatedStatsWrites[0].data.stats).toEqual({ fouls: 3 });
    expect(plan.aggregatedStatsWrites[0].privateData.stats).toEqual({ pts: 12 });
    const f = storeFixture(); const batch = createLiveStatsReplacementBatch({ ...f, expectedEpoch: 'time:1000', resetEventId: 'sheet' });
    batch.set(f.publicRef, plan.aggregatedStatsWrites[0].data); batch.set(f.privateRef, plan.aggregatedStatsWrites[0].privateData); batch.update(f.gameRef, plan.gameUpdate);
    await batch.commit();
    const game = f.rows.get(f.gameRef.path);
    const reopened = { ...readLiveStatsForWrite(f.rows.get(f.publicRef.path), game), ...readLiveStatsForWrite(f.rows.get(f.privateRef.path), game) };
    await commitStandardTrackerFinishData({ ...f, doc: (_db, path, id) => ({ path: `${path}/${id}` }), teamId: 't', gameId: 'g', expectedEpoch: 'id:sheet',
        players: [{ id: 'p', name: 'P' }], playerStatsByPlayerId: { p: reopened }, columns: config.columns, statTrackerConfig: config });
    expect(f.rows.get(f.privateRef.path).stats.pts).toBe(12);
    expect(f.rows.get(f.publicRef.path).stats).not.toHaveProperty('pts');
    const standard = readFileSync(new URL('../../track.html', import.meta.url), 'utf8');
    expect(standard).toContain('...readLiveStatsForWrite(row.data(), currentGame)');
});
