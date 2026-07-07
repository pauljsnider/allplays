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
    where,
    serverTimestamp,
    updateDoc
} from './adapters/legacyNotificationInboxDb';
import { createLogger } from './logger';

const logger = createLogger('notification-inbox-service');
const notificationInboxLimit = 50;

export type NotificationInboxItem = {
    id: string;
    category: string;
    type: string;
    title: string;
    body: string;
    text: string;
    appRoute: string;
    conversationId: string;
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

function mapNotificationInboxSnapshot(snapshot: QuerySnapshot<DocumentData>): NotificationInboxItem[] {
    return snapshot.docs.map((docSnap) => {
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
            conversationId: getStringField(data, 'conversationId'),
            createdAt: data['createdAt'] ?? null,
            readAt: data['readAt'] ?? null
        };
    });
}

/**
 * Subscribe to the unread notification count only.
 * Returns an unsubscribe function.
 */
export function subscribeToUnreadNotificationCount(
    uid: string,
    callback: (count: number) => void,
    onError?: (error: unknown) => void
): () => void {
    const q = query(
        collection(db, `users/${uid}/notificationInbox`),
        where('readAt', '==', null)
    );

    const primaryUnsubscribe = onSnapshot(
        q,
        (snapshot: QuerySnapshot<DocumentData>) => {
            callback(snapshot.size);
        },
        (error: unknown) => {
            if (onError) {
                onError(error);
            } else {
                logger.error('Failed to subscribe to unread notification count.', { error });
            }
        }
    );

    return () => {
        primaryUnsubscribe();
    };
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
    const inboxRef = collection(db, `users/${uid}/notificationInbox`);
    const q = query(
        inboxRef,
        orderBy('createdAt', 'desc'),
        limit(notificationInboxLimit)
    );

    const primaryUnsubscribe = onSnapshot(
        q,
        (snapshot: QuerySnapshot<DocumentData>) => {
            callback(mapNotificationInboxSnapshot(snapshot));
        },
        (error: unknown) => {
            if (onError) {
                onError(error);
            } else {
                logger.error('Failed to subscribe to notification inbox.', { error });
            }
        }
    );

    return () => {
        primaryUnsubscribe();
    };
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
