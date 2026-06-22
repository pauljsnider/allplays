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
    onSnapshot,
    query,
    where
} from './adapters/legacyNotificationInboxDb';
import { subscribeToUnreadNotificationCount } from './notificationInboxService';

describe('notificationInboxService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(collection).mockReturnValue({ kind: 'collection' } as never);
        vi.mocked(where).mockReturnValue({ kind: 'where' } as never);
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
});
