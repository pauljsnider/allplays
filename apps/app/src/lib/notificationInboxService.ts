import type { QuerySnapshot, DocumentData } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import {
    collection,
    db,
    functions,
    httpsCallable,
    limit,
    onSnapshot,
    orderBy,
    query,
    where
} from './adapters/legacyNotificationInboxDb';
import { getPrimaryAppCheckHeaders } from './adapters/legacyFirebaseAppCheck';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import { createLogger } from './logger';

const logger = createLogger('notification-inbox-service');
const notificationInboxLimit = 50;
const unreadNotificationCountLimit = 100;
const nativeNotificationPollMs = 30_000;
const nativeNotificationRequestTimeoutMs = 8_000;

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

function mapNotificationInboxData(id: string, data: DocumentData): NotificationInboxItem {
    const category = getStringField(data, 'category') || getStringField(data, 'type');
    const title = getStringField(data, 'title');
    const body = getStringField(data, 'body');
    const legacyText = getStringField(data, 'text');
    return {
        id,
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
}

function mapNotificationInboxSnapshot(snapshot: QuerySnapshot<DocumentData>): NotificationInboxItem[] {
    return snapshot.docs.map((docSnap) => mapNotificationInboxData(docSnap.id, docSnap.data()));
}

function decodeFirestoreValue(value: any): any {
    if (!value || typeof value !== 'object') return null;
    if ('stringValue' in value) return value.stringValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) return Number(value.integerValue || 0);
    if ('doubleValue' in value) return Number(value.doubleValue || 0);
    if ('timestampValue' in value) return new Date(value.timestampValue);
    if ('nullValue' in value) return null;
    if ('arrayValue' in value) return (value.arrayValue?.values || []).map((entry: any) => decodeFirestoreValue(entry));
    if ('mapValue' in value) return decodeFirestoreFields(value.mapValue?.fields || {});
    return null;
}

function decodeFirestoreFields(fields: Record<string, any> = {}) {
    return Object.entries(fields).reduce<Record<string, any>>((acc, [key, value]) => {
        acc[key] = decodeFirestoreValue(value);
        return acc;
    }, {});
}

function isNativeRuntime() {
    return Capacitor.isNativePlatform();
}

function getProjectId() {
    const projectId = String(firebaseAuth?.app?.options?.projectId || '').trim();
    if (!projectId) throw new Error('Firebase project is unavailable.');
    return projectId;
}

async function getNativeHeaders(requestUrl: string) {
    const token = await getNativeAuthIdToken(true);
    if (!token) throw new Error('Native auth token is unavailable.');
    return getPrimaryAppCheckHeaders({
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
    }, requestUrl);
}

async function nativeFetch(requestUrl: string, init: RequestInit) {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), nativeNotificationRequestTimeoutMs);
    try {
        return await fetch(requestUrl, { ...init, signal: controller.signal });
    } finally {
        globalThis.clearTimeout(timeoutId);
    }
}

async function nativeCallable(name: string, data: Record<string, unknown>) {
    const requestUrl = `https://us-central1-${getProjectId()}.cloudfunctions.net/${name}`;
    const response = await nativeFetch(requestUrl, {
        method: 'POST',
        headers: await getNativeHeaders(requestUrl),
        body: JSON.stringify({ data })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error?.message || `Notification request failed (${response.status}).`);
    }
    return payload?.result || payload?.data;
}

async function nativeNotificationQuery(uid: string, { unreadOnly }: { unreadOnly: boolean }) {
    const requestUrl = `https://firestore.googleapis.com/v1/projects/${getProjectId()}/databases/(default)/documents/users/${encodeURIComponent(uid)}:runQuery`;
    const structuredQuery: Record<string, unknown> = {
        from: [{ collectionId: 'notificationInbox' }],
        limit: unreadOnly ? unreadNotificationCountLimit : notificationInboxLimit
    };
    if (unreadOnly) {
        structuredQuery.where = {
            fieldFilter: {
                field: { fieldPath: 'readAt' },
                op: 'EQUAL',
                value: { nullValue: 'NULL_VALUE' }
            }
        };
    } else {
        structuredQuery.orderBy = [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }];
    }
    const response = await nativeFetch(requestUrl, {
        method: 'POST',
        headers: await getNativeHeaders(requestUrl),
        body: JSON.stringify({ structuredQuery })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error?.message || `Notification inbox request failed (${response.status}).`);
    }
    return (Array.isArray(payload) ? payload : []).flatMap((entry: any) => {
        const document = entry?.document;
        const id = String(document?.name || '').split('/').pop() || '';
        return id ? [{ id, data: decodeFirestoreFields(document?.fields || {}) }] : [];
    });
}

async function nativeUnreadNotificationCount(uid: string) {
    const requestUrl = `https://firestore.googleapis.com/v1/projects/${getProjectId()}/databases/(default)/documents/users/${encodeURIComponent(uid)}:runAggregationQuery`;
    const structuredQuery = {
        from: [{ collectionId: 'notificationInbox' }],
        where: {
            fieldFilter: {
                field: { fieldPath: 'readAt' },
                op: 'EQUAL',
                value: { nullValue: 'NULL_VALUE' }
            }
        },
        limit: unreadNotificationCountLimit
    };
    const response = await nativeFetch(requestUrl, {
        method: 'POST',
        headers: await getNativeHeaders(requestUrl),
        body: JSON.stringify({
            structuredAggregationQuery: {
                structuredQuery,
                aggregations: [{ alias: 'notificationCount', count: {} }]
            }
        })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error?.message || `Notification inbox request failed (${response.status}).`);
    }
    const rows = Array.isArray(payload) ? payload : [payload];
    const rawCount = rows.find((entry: any) => entry?.result?.aggregateFields?.notificationCount)
        ?.result?.aggregateFields?.notificationCount?.integerValue;
    const count = Number(rawCount);
    if (rawCount === undefined || !Number.isInteger(count) || count < 0) {
        throw new Error('Native notification unread count response was invalid.');
    }
    return count;
}

function subscribeToNativeNotificationQuery<T>(
    load: () => Promise<T>,
    callback: (value: T) => void,
    onError?: (error: unknown) => void
) {
    let active = true;
    let inFlight = false;
    const poll = async () => {
        if (!active || inFlight) return;
        inFlight = true;
        try {
            const value = await load();
            if (active) callback(value);
        } catch (error) {
            if (!active) return;
            if (onError) onError(error);
            else logger.error('Failed to poll native notification inbox.', { error });
        } finally {
            inFlight = false;
        }
    };
    void poll();
    const intervalId = globalThis.setInterval(() => void poll(), nativeNotificationPollMs);
    return () => {
        active = false;
        globalThis.clearInterval(intervalId);
    };
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
    if (isNativeRuntime()) {
        return subscribeToNativeNotificationQuery(
            () => nativeUnreadNotificationCount(uid),
            callback,
            onError
        );
    }
    const q = query(
        collection(db, `users/${uid}/notificationInbox`),
        where('readAt', '==', null),
        limit(unreadNotificationCountLimit)
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
    if (isNativeRuntime()) {
        return subscribeToNativeNotificationQuery(
            () => nativeNotificationQuery(uid, { unreadOnly: false })
                .then((items) => items.map((item) => mapNotificationInboxData(item.id, item.data))),
            callback,
            onError
        );
    }
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
    if (!uid || !itemId) return;
    if (isNativeRuntime()) {
        await nativeCallable('markNotificationInboxItemRead', { itemId });
        return;
    }
    const callable = httpsCallable(functions, 'markNotificationInboxItemRead');
    await callable({ itemId });
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

    if (isNativeRuntime()) {
        await nativeCallable('markAllNotificationInboxRead', {});
    } else {
        const callable = httpsCallable(functions, 'markAllNotificationInboxRead');
        await callable({});
    }
}
