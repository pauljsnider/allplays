import { db, collection, getDocs, query, orderBy, limit, startAfter } from './firebase.js?v=33';
import { decodeSharedGameSyntheticId } from './shared-games.js?v=2';

// Overlay live history is bounded and cancellable between pages. Every list
// read retains the existing active-game rule limit of 20 documents.
export async function getOverlayLiveEventHistory(teamId, gameId, cancelled = () => false) {
    const path = decodeSharedGameSyntheticId(gameId) || `teams/${teamId}/games/${gameId}`;
    const ref = collection(db, `${path}/liveEvents`);
    const events = [];
    let cursor = null;
    for (let page = 0; page < 100; page += 1) {
        if (cancelled()) return [];
        const constraints = [orderBy('createdAt', 'asc'), limit(20)];
        if (cursor) constraints.push(startAfter(cursor));
        const snapshot = await getDocs(query(ref, ...constraints));
        // Cached rows cannot authoritatively confirm historical deletions.
        if (snapshot.metadata.fromCache) throw new Error('overlay/history-offline');
        events.push(...snapshot.docs.map(row => ({ id: row.id, ...row.data() })));
        if (snapshot.docs.length < 20) return events;
        cursor = snapshot.docs.at(-1);
    }
    throw new Error('overlay/history-limit');
}
