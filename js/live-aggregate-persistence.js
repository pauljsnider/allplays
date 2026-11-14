import { getLiveStatsEpoch, liveStatsMetadata, readLiveStatsForWrite } from './live-aggregate-stats.js?v=1';

// Pure dependency-injected transaction boundary; callers supply existing SDK access.
export async function persistLiveAggregateSnapshot({ db, runTransaction, gameRef, statsRef,
    payload, expectedEpoch, privateRef, privatePayload }) {
    if (typeof expectedEpoch !== 'string') throw new Error('Missing player totals reset epoch.');
    return runTransaction(db, async transaction => {
        const [gameSnapshot, statsSnapshot, privateSnapshot] = await Promise.all([
            transaction.get(gameRef), transaction.get(statsRef),
            privateRef ? transaction.get(privateRef) : Promise.resolve(null)
        ]);
        const game = gameSnapshot.data() || {};
        if (getLiveStatsEpoch(game) !== expectedEpoch) throw new Error('Tracking reset changed; totals were not saved.');
        readLiveStatsForWrite(statsSnapshot.data() || {}, game);
        if (privateSnapshot) readLiveStatsForWrite(privateSnapshot.data() || {}, game);
        const data = { ...payload, ...liveStatsMetadata(game) };
        transaction.set(statsRef, data, { mergeFields: Object.keys(data) });
        if (privateRef) {
            if (privatePayload) transaction.set(privateRef, { ...privatePayload, ...liveStatsMetadata(game) });
            else transaction.delete(privateRef);
        }
    });
}

// Each finish chunk checks the epoch in the same transaction as its writes.
// This includes zero-player finishes and retries of persisted plans.
export async function persistLiveEpochWrites({ db, runTransaction, gameRef, expectedEpoch, writes }) {
    if (typeof expectedEpoch !== 'string') throw new Error('Missing player totals reset epoch.');
    return runTransaction(db, async transaction => {
        const snapshot = await transaction.get(gameRef);
        const game = snapshot.data();
        if (!game || getLiveStatsEpoch(game) !== expectedEpoch) {
            throw new Error('Tracking reset changed; finish was not saved.');
        }
        for (const write of writes) {
            if (write.kind === 'update') transaction.update(write.ref, write.data);
            else transaction.set(write.ref, write.data);
        }
    });
}

// A reviewed statsheet is a replacement generation. Keep the existing batch
// surface for callers, but bind all public/private rows and game metadata to
// one epoch-checked transaction. Retained old rows cannot become current totals.
export function createLiveStatsReplacementBatch({ db, runTransaction, gameRef, expectedEpoch,
    resetEventId = crypto.randomUUID(), resetAt = Date.now() }) {
    if (typeof expectedEpoch !== 'string') throw new Error('Missing player totals reset epoch.');
    const writes = [];
    const reset = { liveResetEventId: resetEventId, liveResetAt: resetAt };
    return {
        reset,
        set: (ref, data) => writes.push({ kind: 'set', ref, data }),
        delete: ref => writes.push({ kind: 'delete', ref }),
        update: (ref, data) => writes.push({ kind: 'update', ref, data }),
        commit: () => runTransaction(db, async transaction => {
            const game = (await transaction.get(gameRef)).data();
            if (!game || getLiveStatsEpoch(game) !== expectedEpoch) throw new Error('Tracking reset changed; import was not saved.');
            const metadata = liveStatsMetadata(reset);
            for (const write of writes) {
                if (write.kind === 'delete') transaction.delete(write.ref);
                else if (write.ref.path === gameRef.path) transaction.update(write.ref, { ...write.data, ...reset });
                else if (write.kind === 'set') transaction.set(write.ref,
                    /\/(aggregatedStats|privatePlayerStats)\//.test(write.ref.path) ? { ...write.data, ...metadata } : write.data);
                else transaction.update(write.ref, write.data);
            }
        })
    };
}
