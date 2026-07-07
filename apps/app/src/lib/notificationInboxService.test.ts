import { beforeEach, describe, expect, it, vi } from 'vitest';

const adapterMocks = vi.hoisted(() => ({
    collection: vi.fn(),
    db: { kind: 'db' },
    doc: vi.fn(),
    functions: { kind: 'functions' },
    httpsCallable: vi.fn(),
    limit: vi.fn(),
    onSnapshot: vi.fn(),
    orderBy: vi.fn(),
    query: vi.fn(),
    serverTimestamp: vi.fn(),
    updateDoc: vi.fn(),
    where: vi.fn()
}));

vi.mock('./adapters/legacyNotificationInboxDb', () => adapterMocks);

import {
    collection,
    db,
    limit,
    onSnapshot,
    orderBy,
    query,
    where
} from './adapters/legacyNotificationInboxDb';
import { subscribeToNotificationInbox, subscribeToUnreadNotificationCount } from './notificationInboxService';

describe('notificationInboxService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(collection).mockReturnValue({ kind: 'collection' } as never);
        vi.mocked(where).mockReturnValue({ kind: 'where' } as never);
        vi.mocked(orderBy).mockReturnValue({ kind: 'orderBy' } as never);
        vi.mocked(limit).mockReturnValue({ kind: 'limit' } as never);
        vi.mocked(query).mockReturnValue({ kind: 'query' } as never);
        vi.mocked(onSnapshot).mockReturnValue(vi.fn());
    });

    it('subscribes to unread notifications without hydrating inbox items', () => {
        const callback = vi.fn();
        vi.mocked(onSnapshot).mockImplementation((_query, onNext) => {
            onNext({ size: 3 } as never);
            return vi.fn();
        });

        subscribeToUnreadNotificationCount('user-123', callback);

        expect(collection).toHaveBeenCalledWith(db, 'users/user-123/notificationInbox');
        expect(where).toHaveBeenCalledWith('readAt', '==', null);
        expect(query).toHaveBeenCalledWith({ kind: 'collection' }, { kind: 'where' });
        expect(callback).toHaveBeenCalledWith(3);
    });

    it('does not attach a full inbox fallback when the unread query fails', () => {
        const callback = vi.fn();
        const onError = vi.fn();
        const primaryUnsubscribe = vi.fn();
        const primaryCollection = { kind: 'primaryCollection' };
        const primaryQuery = { kind: 'primaryQuery' };
        const unreadError = new Error('The query requires an index.');
        vi.mocked(collection).mockReturnValueOnce(primaryCollection as never);
        vi.mocked(query).mockReturnValueOnce(primaryQuery as never);
        vi.mocked(onSnapshot).mockImplementationOnce((_query, _onNext, onSnapshotError) => {
            onSnapshotError?.(unreadError);
            return primaryUnsubscribe;
        });

        const unsubscribe = subscribeToUnreadNotificationCount('user-123', callback, onError);

        expect(query).toHaveBeenCalledWith(primaryCollection, { kind: 'where' });
        expect(onSnapshot).toHaveBeenCalledTimes(1);
        expect(onSnapshot).toHaveBeenNthCalledWith(1, primaryQuery, expect.any(Function), expect.any(Function));
        expect(collection).toHaveBeenCalledTimes(1);
        expect(orderBy).not.toHaveBeenCalled();
        expect(limit).not.toHaveBeenCalled();
        expect(callback).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(unreadError);

        unsubscribe();
        expect(primaryUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it('subscribes to the ordered limited inbox snapshot', () => {
        const callback = vi.fn();
        const primaryUnsubscribe = vi.fn();
        const inboxCollection = { kind: 'inboxCollection' };
        const primaryQuery = { kind: 'primaryInboxQuery' };
        vi.mocked(collection).mockReturnValueOnce(inboxCollection as never);
        vi.mocked(query).mockReturnValueOnce(primaryQuery as never);
        vi.mocked(onSnapshot).mockImplementationOnce((_query, onNext) => {
            onNext({
                docs: [
                    {
                        id: 'newest',
                        data: () => ({
                            category: 'schedule',
                            title: 'Newest update',
                            body: 'Latest item',
                            createdAt: { seconds: 20 },
                            readAt: null
                        })
                    },
                    {
                        id: 'older',
                        data: () => ({
                            type: 'team_message',
                            text: 'Earlier message',
                            createdAt: { seconds: 10 },
                            readAt: null
                        })
                    }
                ]
            } as never);
            return primaryUnsubscribe;
        });

        const unsubscribe = subscribeToNotificationInbox('user-123', callback);

        expect(collection).toHaveBeenCalledWith(db, 'users/user-123/notificationInbox');
        expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc');
        expect(limit).toHaveBeenCalledWith(50);
        expect(query).toHaveBeenCalledWith(inboxCollection, { kind: 'orderBy' }, { kind: 'limit' });
        expect(onSnapshot).toHaveBeenCalledTimes(1);
        expect(onSnapshot).toHaveBeenCalledWith(primaryQuery, expect.any(Function), expect.any(Function));
        expect(callback).toHaveBeenCalledWith([
            expect.objectContaining({ id: 'newest', text: 'Newest update: Latest item' }),
            expect.objectContaining({ id: 'older', text: 'Earlier message' })
        ]);

        unsubscribe();
        expect(primaryUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it('reports ordered inbox query errors without attaching a raw full-inbox fallback', () => {
        const callback = vi.fn();
        const onError = vi.fn();
        const primaryUnsubscribe = vi.fn();
        const inboxCollection = { kind: 'inboxCollection' };
        const primaryQuery = { kind: 'primaryInboxQuery' };
        const orderedQueryError = new Error('The query requires an index.');
        vi.mocked(collection).mockReturnValueOnce(inboxCollection as never);
        vi.mocked(query).mockReturnValueOnce(primaryQuery as never);
        vi.mocked(onSnapshot).mockImplementationOnce((_query, _onNext, onSnapshotError) => {
            onSnapshotError?.(orderedQueryError);
            return primaryUnsubscribe;
        });

        const unsubscribe = subscribeToNotificationInbox('user-123', callback, onError);

        expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc');
        expect(limit).toHaveBeenCalledWith(50);
        expect(query).toHaveBeenCalledWith(inboxCollection, { kind: 'orderBy' }, { kind: 'limit' });
        expect(onSnapshot).toHaveBeenCalledTimes(1);
        expect(onSnapshot).toHaveBeenCalledWith(primaryQuery, expect.any(Function), expect.any(Function));
        expect(callback).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(orderedQueryError);

        unsubscribe();
        expect(primaryUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it('does not map a large raw fallback snapshot after an ordered inbox query error', () => {
        const callback = vi.fn();
        const onError = vi.fn();
        const primaryUnsubscribe = vi.fn();
        const largeRawFallbackSnapshot = {
            docs: Array.from({ length: 1000 }, (_, index) => ({
                id: `notification-${index}`,
                data: vi.fn(() => ({
                    category: 'team_message',
                    text: `Notification ${index}`,
                    createdAt: { seconds: index },
                    readAt: null
                }))
            }))
        };
        vi.mocked(collection).mockReturnValueOnce({ kind: 'inboxCollection' } as never);
        vi.mocked(query).mockReturnValueOnce({ kind: 'primaryInboxQuery' } as never);
        vi.mocked(onSnapshot).mockImplementationOnce((_query, _onNext, onSnapshotError) => {
            onSnapshotError?.(new Error('permission denied'));
            return primaryUnsubscribe;
        });

        subscribeToNotificationInbox('user-123', callback, onError);

        expect(onSnapshot).toHaveBeenCalledTimes(1);
        for (const docSnap of largeRawFallbackSnapshot.docs) {
            expect(docSnap.data).not.toHaveBeenCalled();
        }
        expect(callback).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
    });
});
