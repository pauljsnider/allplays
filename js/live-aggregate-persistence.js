import { getLiveStatsEpoch, liveStatsMetadata, readLiveStatsForWrite } from './live-aggregate-stats.js?v=2';

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
            else {
                const isEvent = /\/(events|liveEvents)\//.test(write.ref.path);
                transaction.set(write.ref, isEvent ? { ...write.data, ...liveStatsMetadata(game) } : write.data);
            }
        }
    });
}

// Live Tracker start-over has the same reset boundary as Standard/Beta: publish
// the new epoch first, then remove only rows that do not belong to that epoch.
// A final guarded patch makes completion fields authoritative after cleanup.
export async function resetLiveTrackerData({ db, runTransaction, gameRef, collectionRefs = [], getDocs,
    expectedEpoch, gamePatch = {}, resetEventId = crypto.randomUUID(), resetAt = Date.now(), chunkSize = 200 }) {
    if (typeof expectedEpoch !== 'string' || !resetEventId || typeof getDocs !== 'function') {
        throw new Error('Missing live tracker reset boundary.');
    }
    const patch = { ...gamePatch, liveResetEventId: resetEventId, liveResetAt: resetAt };
    const resetEpoch = getLiveStatsEpoch(patch);

    async function transact(epoch, callback) {
        await runTransaction(db, async transaction => {
            const game = (await transaction.get(gameRef)).data();
            if (!game || getLiveStatsEpoch(game) !== epoch) {
                throw new Error('Tracking reset changed; reload before resetting again.');
            }
            await callback(transaction, game);
        });
    }

    await transact(expectedEpoch, transaction => transaction.update(gameRef, patch));
    const snapshots = await Promise.all(collectionRefs.map(ref => getDocs(ref)));
    const refs = snapshots.flatMap(snapshot => snapshot.docs.map(row => row.ref));
    for (let start = 0; start < refs.length; start += chunkSize) {
        const chunk = refs.slice(start, start + chunkSize);
        await transact(resetEpoch, async transaction => {
            const rows = await Promise.all(chunk.map(ref => transaction.get(ref)));
            rows.forEach((row, index) => {
                const data = row.data();
                if (data?.liveStatsVersion === 1 && data.liveStatsEpoch === resetEpoch) return;
                transaction.delete(chunk[index]);
            });
        });
    }
    await transact(resetEpoch, transaction => transaction.update(gameRef, patch));
    return patch;
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

// Only explicit reset/cancel flows may remove ambiguous historical private rows.
// Reread under the game epoch: a saved current-generation row must survive a
// delayed cleanup, including replacement of a previously captured document ID.
export async function clearResetPrivateStats({ db, runTransaction, gameRef, privateRef, expectedEpoch }) {
    if (typeof expectedEpoch !== 'string') throw new Error('Missing player totals reset epoch.');
    return runTransaction(db, async transaction => {
        const [gameSnapshot, rowSnapshot] = await Promise.all([transaction.get(gameRef), transaction.get(privateRef)]);
        const game = gameSnapshot.data();
        if (!game || getLiveStatsEpoch(game) !== expectedEpoch) throw new Error('Tracking reset changed; private cleanup was not applied.');
        const row = rowSnapshot.data();
        if (!row || (row.liveStatsVersion === 1 && row.liveStatsEpoch === expectedEpoch)) return;
        transaction.delete(privateRef);
    });
}
