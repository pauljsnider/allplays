import { getLiveStatsEpoch, liveStatsMetadata, readLiveStatsForWrite } from './live-aggregate-stats.js?v=1';

// Pure dependency-injected transaction boundary; callers supply existing SDK access.
export async function persistLiveAggregateSnapshot({ db, runTransaction, gameRef, statsRef,
    payload, expectedEpoch, privateRef, privatePayload }) {
    if (typeof expectedEpoch !== 'string') throw new Error('Missing player totals reset epoch.');
    return runTransaction(db, async transaction => {
        const [gameSnapshot, statsSnapshot] = await Promise.all([
            transaction.get(gameRef), transaction.get(statsRef)
        ]);
        const game = gameSnapshot.data() || {};
        if (getLiveStatsEpoch(game) !== expectedEpoch) throw new Error('Tracking reset changed; totals were not saved.');
        readLiveStatsForWrite(statsSnapshot.data() || {}, game);
        const data = { ...payload, ...liveStatsMetadata(game) };
        transaction.set(statsRef, data, { mergeFields: Object.keys(data) });
        if (privateRef) {
            if (privatePayload) transaction.set(privateRef, privatePayload);
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
