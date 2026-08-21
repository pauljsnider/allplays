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

const nativeRuntimeMocks = vi.hoisted(() => ({
    isNativePlatform: vi.fn(() => false)
}));

const authMocks = vi.hoisted(() => ({
    getNativeAuthIdToken: vi.fn()
}));

const appCheckMocks = vi.hoisted(() => ({
    getPrimaryAppCheckHeaders: vi.fn(async (headers) => headers)
}));

vi.mock('./adapters/legacyNotificationInboxDb', () => adapterMocks);
vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: nativeRuntimeMocks.isNativePlatform }
}));
vi.mock('./authService', () => ({
    firebaseAuth: { app: { options: { projectId: 'demo-allplays' } } },
    getNativeAuthIdToken: authMocks.getNativeAuthIdToken
}));
vi.mock('./adapters/legacyFirebaseAppCheck', () => appCheckMocks);

import {
    collection,
    db,
    limit,
    onSnapshot,
    orderBy,
    query,
    where
} from './adapters/legacyNotificationInboxDb';
import {
    markNotificationRead,
    subscribeToNotificationInbox,
    subscribeToUnreadNotificationCount
} from './notificationInboxService';

describe('notificationInboxService', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
        nativeRuntimeMocks.isNativePlatform.mockReturnValue(false);
        authMocks.getNativeAuthIdToken.mockResolvedValue('native-token');
        appCheckMocks.getPrimaryAppCheckHeaders.mockImplementation(async (headers) => headers);
        vi.mocked(collection).mockReturnValue({ kind: 'collection' } as never);
        vi.mocked(where).mockReturnValue({ kind: 'where' } as never);
        vi.mocked(orderBy).mockReturnValue({ kind: 'orderBy' } as never);
        vi.mocked(limit).mockReturnValue({ kind: 'limit' } as never);
        vi.mocked(query).mockReturnValue({ kind: 'query' } as never);
        vi.mocked(onSnapshot).mockReturnValue(vi.fn());
    });

    it('subscribes to a bounded server-filtered unread query', () => {
        const callback = vi.fn();
        vi.mocked(onSnapshot).mockImplementation((_query, onNext) => {
            onNext({ size: 3 } as never);
            return vi.fn();
        });

        subscribeToUnreadNotificationCount('user-123', callback);

        expect(collection).toHaveBeenCalledWith(db, 'users/user-123/notificationInbox');
        expect(where).toHaveBeenCalledWith('readAt', '==', null);
        expect(limit).toHaveBeenCalledWith(100);
        expect(query).toHaveBeenCalledWith({ kind: 'collection' }, { kind: 'where' }, { kind: 'limit' });
        expect(callback).toHaveBeenCalledWith(3);
    });

    it('counts older unread records even when more than 100 newer records are read', () => {
        const callback = vi.fn();
        vi.mocked(onSnapshot).mockImplementation((_query, onNext) => {
            // Firestore applies readAt == null before the limit, so newer read
            // records never consume the unread query window.
            onNext({ size: 4 } as never);
            return vi.fn();
        });

        subscribeToUnreadNotificationCount('user-123', callback);

        expect(where).toHaveBeenCalledWith('readAt', '==', null);
        expect(limit).toHaveBeenCalledWith(100);
        expect(callback).toHaveBeenCalledWith(4);
    });

    it('reports bounded unread query failures without attaching another listener', () => {
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

        expect(query).toHaveBeenCalledWith(primaryCollection, { kind: 'where' }, { kind: 'limit' });
        expect(onSnapshot).toHaveBeenCalledTimes(1);
        expect(onSnapshot).toHaveBeenNthCalledWith(1, primaryQuery, expect.any(Function), expect.any(Function));
        expect(collection).toHaveBeenCalledTimes(1);
        expect(orderBy).not.toHaveBeenCalled();
        expect(limit).toHaveBeenCalledWith(100);
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

    it.each([0, 1, 42, 99, 100])('polls the bounded native aggregation unread count (%s)', async (count) => {
        nativeRuntimeMocks.isNativePlatform.mockReturnValue(true);
        const callback = vi.fn();
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue([{ result: { aggregateFields: {
                notificationCount: { integerValue: String(count) }
            } } }])
        });
        vi.stubGlobal('fetch', fetchMock);

        const unsubscribe = subscribeToUnreadNotificationCount('user-123', callback);
        await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(count));

        expect(onSnapshot).not.toHaveBeenCalled();
        expect(authMocks.getNativeAuthIdToken).toHaveBeenCalledWith(true);
        expect(fetchMock.mock.calls[0][0]).toContain(':runAggregationQuery');
        const [, request] = fetchMock.mock.calls[0];
        const body = JSON.parse(String(request.body));
        expect(body.structuredAggregationQuery.structuredQuery.where.fieldFilter).toEqual({
            field: { fieldPath: 'readAt' },
            op: 'EQUAL',
            value: { nullValue: 'NULL_VALUE' }
        });
        expect(body.structuredAggregationQuery.structuredQuery.limit).toBe(100);
        expect(body.structuredAggregationQuery.aggregations).toEqual([
            { alias: 'notificationCount', count: {} }
        ]);
        unsubscribe();
    });

    it('reports malformed native aggregation responses', async () => {
        nativeRuntimeMocks.isNativePlatform.mockReturnValue(true);
        const onError = vi.fn();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue([{ result: { aggregateFields: {} } }])
        }));

        const unsubscribe = subscribeToUnreadNotificationCount('user-123', vi.fn(), onError);
        await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Native notification unread count response was invalid.' })
        ));
        unsubscribe();
    });

    it('reports native aggregation HTTP failures', async () => {
        nativeRuntimeMocks.isNativePlatform.mockReturnValue(true);
        const onError = vi.fn();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 503,
            json: vi.fn().mockResolvedValue({ error: { message: 'Firestore unavailable' } })
        }));

        const unsubscribe = subscribeToUnreadNotificationCount('user-123', vi.fn(), onError);
        await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Firestore unavailable' })
        ));
        unsubscribe();
    });

    it('aborts a native aggregation request at the existing timeout', async () => {
        nativeRuntimeMocks.isNativePlatform.mockReturnValue(true);
        vi.useFakeTimers();
        const onError = vi.fn();
        const fetchMock = vi.fn().mockImplementation((_url, request: RequestInit) => new Promise((_resolve, reject) => {
            request.signal?.addEventListener('abort', () => reject(new Error('request aborted')));
        }));
        vi.stubGlobal('fetch', fetchMock);

        const unsubscribe = subscribeToUnreadNotificationCount('user-123', vi.fn(), onError);
        await vi.advanceTimersByTimeAsync(8_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'request aborted' }));
        unsubscribe();
        vi.useRealTimers();
    });

    it('does not emit a native aggregation result after unsubscribe', async () => {
        nativeRuntimeMocks.isNativePlatform.mockReturnValue(true);
        let resolveResponse!: (response: Response) => void;
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((resolve) => {
            resolveResponse = resolve;
        })));

        const callback = vi.fn();
        const onError = vi.fn();
        const unsubscribe = subscribeToUnreadNotificationCount('user-123', callback, onError);
        unsubscribe();
        resolveResponse({
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue([{ result: { aggregateFields: {
                notificationCount: { integerValue: '7' }
            } } }])
        } as never);

        await Promise.resolve();
        await Promise.resolve();
        expect(callback).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });

    it('loads and maps the ordered native inbox without emitting an empty result on permission failure', async () => {
        nativeRuntimeMocks.isNativePlatform.mockReturnValue(true);
        const callback = vi.fn();
        const onError = vi.fn();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue([{
                    document: {
                        name: 'projects/demo-allplays/databases/(default)/documents/users/user-123/notificationInbox/newest',
                        fields: {
                            category: { stringValue: 'schedule' },
                            title: { stringValue: 'Game updated' },
                            body: { stringValue: 'Field changed' },
                            readAt: { nullValue: 'NULL_VALUE' },
                            createdAt: { timestampValue: '2026-08-11T12:00:00.000Z' }
                        }
                    }
                }])
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 403,
                json: vi.fn().mockResolvedValue({ error: { message: 'Missing or insufficient permissions.' } })
            });
        vi.stubGlobal('fetch', fetchMock);

        const firstUnsubscribe = subscribeToNotificationInbox('user-123', callback, onError);
        await vi.waitFor(() => expect(callback).toHaveBeenCalledWith([
            expect.objectContaining({ id: 'newest', text: 'Game updated: Field changed', readAt: null })
        ]));
        firstUnsubscribe();

        const failedCallback = vi.fn();
        const failedUnsubscribe = subscribeToNotificationInbox('user-123', failedCallback, onError);
        await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Missing or insufficient permissions.' })));
        expect(failedCallback).not.toHaveBeenCalled();
        failedUnsubscribe();
    });

    it('marks one notification read through the existing server callable', async () => {
        const callable = vi.fn().mockResolvedValue({ data: { status: 'success', updatedCount: 1 } });
        adapterMocks.httpsCallable.mockReturnValue(callable);

        await markNotificationRead('user-123', 'item-1');

        expect(adapterMocks.httpsCallable).toHaveBeenCalledWith(
            adapterMocks.functions,
            'markNotificationInboxItemRead'
        );
        expect(callable).toHaveBeenCalledWith({ itemId: 'item-1' });
        expect(adapterMocks.updateDoc).not.toHaveBeenCalled();
    });
});
