import {
    collection,
    db,
    doc,
    limit,
    onSnapshot,
    orderBy,
    query,
    updateDoc,
    serverTimestamp
} from '../../../../js/firebase.js';

export type NotificationInboxItem = {
    id: string;
    type: string;
    text: string;
    appRoute: string;
    createdAt: unknown;
    readAt: unknown | null;
};

/**
 * Subscribe to the user's notification inbox (newest first, limit 50).
 * Returns an unsubscribe function.
 */
export function subscribeToNotificationInbox(
    uid: string,
    callback: (items: NotificationInboxItem[]) => void,
    onError?: (error: unknown) => void
): () => void {
    const q = query(
        collection(db, `users/${uid}/notificationInbox`),
        orderBy('createdAt', 'desc'),
        limit(50)
    );

    return onSnapshot(
        q,
        (snapshot) => {
            const items: NotificationInboxItem[] = snapshot.docs.map((docSnap) => {
                const data = docSnap.data();
                return {
                    id: docSnap.id,
                    type: typeof data['type'] === 'string' ? data['type'] : '',
                    text: typeof data['text'] === 'string' ? data['text'] : '',
                    appRoute: typeof data['appRoute'] === 'string' ? data['appRoute'] : '',
                    createdAt: data['createdAt'] ?? null,
                    readAt: data['readAt'] ?? null
                };
            });
            callback(items);
        },
        (error) => {
            if (onError) onError(error);
        }
    );
}

/**
 * Count unread items (those without a readAt value).
 */
export function countUnread(items: NotificationInboxItem[]): number {
    return items.filter((item) => !item.readAt).length;
}

/**
 * Mark a notification inbox item as read by setting its readAt to now.
 */
export async function markNotificationRead(uid: string, itemId: string): Promise<void> {
    const docRef = doc(db, `users/${uid}/notificationInbox`, itemId);
    await updateDoc(docRef, { readAt: serverTimestamp() });
}
