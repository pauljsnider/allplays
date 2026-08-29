/**
 * Normalize a live-event snapshot returned by a descending query.
 *
 * Active subscriptions are newest-first so Firestore can enforce the read
 * bound. Viewers consume events oldest-first, so reverse the bounded result
 * after mapping the document data.
 */
export function normalizeLiveEventsSnapshot(snapshot) {
    return snapshot.docs
        .map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() }))
        .reverse();
}
