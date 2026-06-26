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

    it('falls back to counting unread items from the full inbox when the unread query fails', () => {
        const callback = vi.fn();
        const primaryUnsubscribe = vi.fn();
        const fallbackUnsubscribe = vi.fn();
        const primaryCollection = { kind: 'primaryCollection' };
        const fallbackCollection = { kind: 'fallbackCollection' };
        const primaryQuery = { kind: 'primaryQuery' };
        vi.mocked(collection)
            .mockReturnValueOnce(primaryCollection as never)
            .mockReturnValueOnce(fallbackCollection as never);
        vi.mocked(query).mockReturnValueOnce(primaryQuery as never);
        vi.mocked(onSnapshot)
            .mockImplementationOnce((_query, _onNext, onError) => {
                onError?.(new Error('The query requires an index.'));
                return primaryUnsubscribe;
            })
            .mockImplementationOnce((_query, onNext) => {
                onNext({
                    docs: [
                        {
                            id: 'notif-1',
                            data: () => ({ title: 'Unread', readAt: null, createdAt: null })
                        },
                        {
                            id: 'notif-2',
                            data: () => ({ title: 'Read', readAt: { seconds: 1 }, createdAt: null })
                        }
                    ]
                } as never);
                return fallbackUnsubscribe;
            });

        const unsubscribe = subscribeToUnreadNotificationCount('user-123', callback);

        expect(query).toHaveBeenCalledWith(primaryCollection, { kind: 'where' });
        expect(onSnapshot).toHaveBeenNthCalledWith(1, primaryQuery, expect.any(Function), expect.any(Function));
        expect(onSnapshot).toHaveBeenNthCalledWith(2, fallbackCollection, expect.any(Function), expect.any(Function));
        expect(orderBy).not.toHaveBeenCalled();
        expect(limit).not.toHaveBeenCalled();
        expect(callback).toHaveBeenCalledWith(1);

        unsubscribe();
        expect(primaryUnsubscribe).toHaveBeenCalledTimes(1);
        expect(fallbackUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it('falls back to the full inbox snapshot when the ordered inbox query fails', () => {
        const callback = vi.fn();
        const primaryUnsubscribe = vi.fn();
        const fallbackUnsubscribe = vi.fn();
        const inboxCollection = { kind: 'inboxCollection' };
        const primaryQuery = { kind: 'primaryInboxQuery' };
        vi.mocked(collection).mockReturnValueOnce(inboxCollection as never);
        vi.mocked(query).mockReturnValueOnce(primaryQuery as never);
        vi.mocked(onSnapshot)
            .mockImplementationOnce((_query, _onNext, onError) => {
                onError?.(new Error('The query requires an index.'));
                return primaryUnsubscribe;
            })
            .mockImplementationOnce((_query, onNext) => {
                onNext({
                    docs: [
                        {
                            id: 'older',
                            data: () => ({
                                category: 'schedule',
                                title: 'Older update',
                                body: 'Earlier item',
                                createdAt: { seconds: 10 },
                                readAt: null
                            })
                        },
                        {
                            id: 'newer',
                            data: () => ({
                                type: 'team_message',
                                text: 'Fresh message',
                                createdAt: { toDate: () => new Date('2026-06-26T12:00:00Z') },
                                readAt: null
                            })
                        }
                    ]
                } as never);
                return fallbackUnsubscribe;
            });

        const unsubscribe = subscribeToNotificationInbox('user-123', callback);

        expect(collection).toHaveBeenCalledWith(db, 'users/user-123/notificationInbox');
        expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc');
        expect(limit).toHaveBeenCalledWith(50);
        expect(query).toHaveBeenCalledWith(inboxCollection, { kind: 'orderBy' }, { kind: 'limit' });
        expect(onSnapshot).toHaveBeenNthCalledWith(1, primaryQuery, expect.any(Function), expect.any(Function));
        expect(onSnapshot).toHaveBeenNthCalledWith(2, inboxCollection, expect.any(Function), expect.any(Function));
        expect(callback).toHaveBeenCalledWith([
            expect.objectContaining({ id: 'newer', text: 'Fresh message' }),
            expect.objectContaining({ id: 'older', text: 'Older update: Earlier item' })
        ]);

        unsubscribe();
        expect(primaryUnsubscribe).toHaveBeenCalledTimes(1);
        expect(fallbackUnsubscribe).toHaveBeenCalledTimes(1);
    });
});
