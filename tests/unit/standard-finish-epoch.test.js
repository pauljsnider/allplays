import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { commitStandardTrackerFinishData, resetStandardTrackerData } from '../../js/track-finish.js';
import { applyLiveAggregateTotals, readLiveStatsForWrite, liveStatsMetadata } from '../../js/live-aggregate-stats.js';

const gamePath = 'teams/t/games/g';
const playerPath = `${gamePath}/aggregatedStats/p`;
const privatePlayerPath = `${gamePath}/privatePlayerStats/p`;
function fixture({ before = () => {}, retry = () => false, game = { liveResetAt: 1000 } } = {}) {
    const documents = new Map([[gamePath, game]]);
    let calls = 0;
    const committed = [];
    const payload = {
        db: {}, doc: (_db, path, id) => ({ path: `${path}/${id}` }),
        teamId: 't', gameId: 'g', currentUserUid: 'coach', expectedEpoch: 'time:1000',
        players: [{ id: 'p', name: 'Player' }], columns: ['PTS'],
        playerStatsByPlayerId: { p: { pts: 12 } }, finalHome: 12, finalAway: 3,
        runTransaction: async (_db, callback) => {
            calls++;
            before(calls, documents);
            for (let attempt = 0; attempt < 2; attempt++) {
                const staged = [];
                let writing = false;
                await callback({
                    get: async ref => {
                        expect(writing).toBe(false);
                        const data = structuredClone(documents.get(ref.path));
                        return { data: () => data };
                    },
                    set: (ref, data) => { writing = true; staged.push(['set', ref.path, data]); },
                    update: (ref, data) => { writing = true; staged.push(['update', ref.path, data]); },
                    delete: ref => { writing = true; staged.push(['delete', ref.path]); }
                });
                // Models the SDK discarding staged writes and retrying after a
                // conflicting game update; not a Firestore emulator assertion.
                if (retry(calls, attempt, documents)) continue;
                for (const [kind, path, data] of staged) {
                    if (kind === 'delete') documents.delete(path);
                    else documents.set(path, kind === 'update' ? { ...documents.get(path), ...data } : data);
                }
                committed.push(staged);
                return;
            }
            throw new Error('test retry exhausted');
        }
    };
    return { payload, documents, committed };
}
const reset = docs => docs.set(gamePath, { liveResetEventId: 'new-reset' });

describe('standard and Basketball Beta epoch-safe finish', () => {
    it.each([false, true])('saved totals survive live reopen and both viewers (Beta=%s)', async includeTimeMs => {
        const { payload, documents } = fixture();
        if (includeTimeMs) payload.playerStatsByPlayerId.p.time = 9000;
        documents.set(playerPath, { stats: { pts: 10 }, ...liveStatsMetadata({ liveResetAt: 1000 }) });
        await commitStandardTrackerFinishData({ ...payload, includeTimeMs });
        const row = documents.get(playerPath);
        expect(row).toMatchObject({ liveStatsVersion: 1, liveStatsEpoch: 'time:1000', stats: { pts: 12 } });
        expect(row.timeMs).toBe(includeTimeMs ? 9000 : undefined);
        expect(readLiveStatsForWrite(row, documents.get(gamePath))).toEqual({ pts: 12 });
        for (const mode of ['overlay', 'legacy']) {
            const state = { game: documents.get(gamePath), stats: {}, mode };
            applyLiveAggregateTotals(state, [{ id: 'p', ...row }]);
            expect(state.stats.p).toEqual({ pts: 12 });
            expect(state.aggregateTotalsStatus).toBe('ready');
        }
        await commitStandardTrackerFinishData({ ...payload, includeTimeMs });
        expect(documents.get(playerPath).stats.pts).toBe(12);
    });
    it('rejects a stale session before even saving its events', async () => {
        const f = fixture({ before: (_n, docs) => reset(docs) });
        await expect(commitStandardTrackerFinishData({ ...f.payload, gameLog: [{ text: 'stale' }] })).rejects.toThrow('reset changed');
        expect(f.committed).toHaveLength(0);
    });
    it('rejects an SDK retry after a reset and discards the first staged totals', async () => {
        const f = fixture({ retry: (_n, attempt, docs) => { if (attempt === 0) { reset(docs); return true; } return false; } });
        await expect(commitStandardTrackerFinishData(f.payload)).rejects.toThrow('reset changed');
        expect(f.documents.has(playerPath)).toBe(false);
        expect(f.committed).toHaveLength(0);
    });
    it('stops between stats chunks and never completes the reset game', async () => {
        const f = fixture({ before: (n, docs) => { if (n === 2) reset(docs); } });
        await expect(commitStandardTrackerFinishData({ ...f.payload,
            players: [{ id: 'p', name: 'P' }, { id: 'q', name: 'Q' }], maxAggregatedStatsBatchWrites: 2
        })).rejects.toThrow('reset changed');
        expect(f.committed).toHaveLength(1);
        expect(f.documents.has(`${gamePath}/aggregatedStats/q`)).toBe(false);
        expect(f.documents.get(gamePath).status).toBeUndefined();
        expect(readLiveStatsForWrite(f.documents.get(playerPath), f.documents.get(gamePath))).toEqual({});
    });
    it('checks the final game transaction, including zero-player games', async () => {
        const f = fixture({ before: (n, docs) => { if (n === 2) reset(docs); } });
        await expect(commitStandardTrackerFinishData(f.payload)).rejects.toThrow('reset changed');
        expect(f.documents.get(gamePath).status).toBeUndefined();
        const empty = fixture({ before: (_n, docs) => reset(docs) });
        await expect(commitStandardTrackerFinishData({ ...empty.payload, players: [] })).rejects.toThrow('reset changed');
        expect(empty.committed).toHaveLength(0);
    });
    it('preserves ambiguous untagged history without certifying it', async () => {
        const f = fixture(); f.documents.set(playerPath, { stats: { pts: 99 } });
        await expect(commitStandardTrackerFinishData(f.payload)).rejects.toThrow('unknown reset epoch');
        expect(f.documents.get(playerPath)).toEqual({ stats: { pts: 99 } });
        expect(f.committed).toHaveLength(0);
    });
    it('rejects a concurrently created ambiguous private row without certifying or deleting it', async () => {
        const f = fixture({ before: (call, docs) => {
            if (call === 1) docs.set(privatePlayerPath, { stats: { effort: 99 } });
        } });
        await expect(commitStandardTrackerFinishData(f.payload)).rejects.toThrow('unknown reset epoch');
        expect(f.documents.get(privatePlayerPath)).toEqual({ stats: { effort: 99 } });
        expect(f.committed).toHaveLength(0);
    });
    it.each(['../../track.html', '../../js/track-basketball.js'])('pins %s to the loaded session, not a newly fetched reset', path => {
        const source = readFileSync(new URL(path, import.meta.url), 'utf8');
        expect(source).toContain('expectedEpoch: getLiveStatsEpoch(currentGame)');
        expect(source).toContain('runTransaction,');
        expect(source).toContain('readLiveStatsForWrite(');
        expect(source).not.toContain('expectedEpoch: getLiveStatsEpoch(latestGame)');
    });
});


describe('standard/Beta reset publication', () => {
    function resetPayload(f) {
        return { ...f.payload, resetEventId: 'fresh', resetAt: 2000,
            collection: (_db, path) => ({ path }),
            getDocs: async ref => ({ docs: [...f.documents.keys()].filter(path => path.startsWith(ref.path + '/'))
                .map(path => ({ ref: { path } })) }) };
    }
    it('advances the epoch after cleanup and refuses a pre-reset finish', async () => {
        const f = fixture();
        f.documents.set(playerPath, { stats: { pts: 12 }, ...liveStatsMetadata({ liveResetAt: 1000 }) });
        const patch = await resetStandardTrackerData(resetPayload(f));
        expect(patch.liveResetEventId).toBe('fresh');
        expect(f.documents.has(playerPath)).toBe(false);
        await expect(commitStandardTrackerFinishData(f.payload)).rejects.toThrow('reset changed');
        await commitStandardTrackerFinishData({ ...f.payload, expectedEpoch: 'id:fresh' });
        expect(f.documents.get(playerPath).liveStatsEpoch).toBe('id:fresh');
    });
    it('publishes the reset epoch before cleanup so an old finish cannot recreate deleted rows', async () => {
        const f = fixture();
        const oldFinish = { ...f.payload, gameLog: [{ text: 'old-session score' }] };
        f.documents.set(playerPath, { stats: { pts: 4 }, ...liveStatsMetadata({ liveResetAt: 1000 }) });
        const payload = resetPayload(f);
        const getDocs = payload.getDocs;
        payload.getDocs = async ref => {
            const snapshot = await getDocs(ref);
            if (ref.path.endsWith('/events')) {
                await expect(commitStandardTrackerFinishData(oldFinish)).rejects.toThrow('reset changed');
            }
            return snapshot;
        };

        const patch = await resetStandardTrackerData(payload);

        expect(patch).toMatchObject({ liveResetEventId: 'fresh', status: 'scheduled', summary: '' });
        expect(f.documents.has(`${gamePath}/events/finish-log-000001`)).toBe(false);
        expect(f.documents.has(playerPath)).toBe(false);
        expect(f.documents.get(gamePath)).toMatchObject({
            liveResetEventId: 'fresh', homeScore: 0, awayScore: 0,
            opponentStats: {}, status: 'scheduled', summary: ''
        });
    });
    it('cannot delete new-epoch rows when another reset wins between cleanup chunks', async () => {
        const f = fixture({ before: (n, docs) => {
            if (n === 2) {
                reset(docs);
                docs.set(`${gamePath}/aggregatedStats/p450`, { stats: { pts: 44 }, liveStatsVersion: 1, liveStatsEpoch: 'id:new-reset' });
            }
        } });
        for (let i = 0; i < 451; i++) f.documents.set(`${gamePath}/aggregatedStats/p${i}`, { stats: { pts: 1 } });
        await expect(resetStandardTrackerData(resetPayload(f))).rejects.toThrow('reset changed');
        expect(f.documents.get(`${gamePath}/aggregatedStats/p450`).stats.pts).toBe(44);
        expect(f.documents.get(gamePath).liveResetEventId).toBe('new-reset');
    });
    it('refuses ambiguous private totals on reopen instead of silently clearing them', () => {
        const game = { liveResetAt: 1000 };
        expect(readLiveStatsForWrite({ stats: { pts: 12 }, ...liveStatsMetadata(game) }, game)).toEqual({ pts: 12 });
        expect(() => readLiveStatsForWrite({ stats: { effort: 7 } }, game)).toThrow('unknown reset epoch');
        const beta = readFileSync(new URL('../../js/track-basketball.js', import.meta.url), 'utf8');
        const privateBlock = beta.slice(beta.indexOf('privateStatsSnapshot.forEach'));
        expect(privateBlock).toContain('readLiveStatsForWrite(d.data(), currentGame)');
    });
    it.each(['../../track.html', '../../js/track-basketball.js'])('uses guarded reset and updates local epoch only after success in %s', path => {
        const source = readFileSync(new URL(path, import.meta.url), 'utf8');
        const resetCall = source.indexOf('const resetPatch = await resetStandardTrackerData(');
        expect(resetCall).toBeGreaterThan(0);
        expect(source.indexOf('Object.assign(currentGame, resetPatch)', resetCall)).toBeGreaterThan(resetCall);
    });
});
