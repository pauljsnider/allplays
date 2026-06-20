import type { QuerySnapshot, DocumentData } from 'firebase/firestore';
import {
    collection,
    db,
    doc,
    functions,
    httpsCallable,
    limit,
    onSnapshot,
    orderBy,
    query,
    updateDoc,
    serverTimestamp
} from '../../../../js/firebase.js';

export type NotificationInboxItem = {
    id: string;
    category: string;
    type: string;
    title: string;
    body: string;
    text: string;
    appRoute: string;
    createdAt: unknown;
    readAt: unknown | null;
};

function getStringField(data: DocumentData, key: string): string {
    const value = data[key];
    return typeof value === 'string' ? value : '';
}

function buildNotificationText(title: string, body: string, legacyText: string): string {
    if (title && body) return `${title}: ${body}`;
    return title || body || legacyText;
}

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
        (snapshot: QuerySnapshot<DocumentData>) => {
            const items: NotificationInboxItem[] = snapshot.docs.map((docSnap) => {
                const data = docSnap.data();
                const category = getStringField(data, 'category') || getStringField(data, 'type');
                const title = getStringField(data, 'title');
                const body = getStringField(data, 'body');
                const legacyText = getStringField(data, 'text');
                return {
                    id: docSnap.id,
                    category,
                    type: category,
                    title,
                    body,
                    text: buildNotificationText(title, body, legacyText),
                    appRoute: getStringField(data, 'appRoute'),
                    createdAt: data['createdAt'] ?? null,
                    readAt: data['readAt'] ?? null
                };
            });
            callback(items);
        },
        (error: unknown) => {
            if (onError) {
                onError(error);
            } else {
                console.error('Failed to subscribe to notification inbox:', error);
            }
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

export async function markAllNotificationsRead(uid: string, items: NotificationInboxItem[]): Promise<void> {
    const unreadItemIds = Array.from(new Set(
        (Array.isArray(items) ? items : [])
            .filter((item) => item && !item.readAt)
            .map((item) => String(item.id || '').trim())
            .filter(Boolean)
    ));
    if (!uid || unreadItemIds.length === 0) {
        return;
    }

    const callable = httpsCallable(functions, 'markAllNotificationInboxRead');
    await callable({});
}
