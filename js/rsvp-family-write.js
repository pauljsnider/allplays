function uniqueNonEmptyIds(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean))];
}

/**
 * Atomically replaces child-specific RSVP overrides with one family response.
 * Firestore dependencies are injected so this small write boundary stays easy
 * to verify without loading the full legacy database module.
 */
export async function commitFamilyRsvpWrite({
    db,
    writeBatch,
    doc,
    teamId,
    gameId,
    userId,
    childIds,
    rsvpPayload,
    notePayload
}) {
    const normalizedChildIds = uniqueNonEmptyIds(childIds);
    if (!teamId || !gameId || !userId || normalizedChildIds.length === 0) {
        throw new Error('Family RSVP write requires a team, event, user, and children.');
    }

    const rsvpCollectionPath = `teams/${teamId}/games/${gameId}/rsvps`;
    const noteCollectionPath = `teams/${teamId}/games/${gameId}/rsvpNotes`;
    const batch = writeBatch(db);

    batch.set(doc(db, rsvpCollectionPath, userId), rsvpPayload);
    batch.set(doc(db, noteCollectionPath, userId), notePayload);
    normalizedChildIds.forEach((childId) => {
        const overrideId = `${userId}__${childId}`;
        batch.delete(doc(db, rsvpCollectionPath, overrideId));
        batch.delete(doc(db, noteCollectionPath, overrideId));
    });

    await batch.commit();
}
