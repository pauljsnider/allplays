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
    if (cancelled()) return [];
    // Distinguish exactly 2,000 records from a truncated larger game without
    // fetching another full page. This read also remains below the20/read rule.
    const remainder = await getDocs(query(ref, orderBy('createdAt', 'asc'), startAfter(cursor), limit(1)));
    if (remainder.metadata.fromCache) throw new Error('overlay/history-offline');
    if (!remainder.docs.length) return events;
    throw new Error('overlay/history-limit');
}
