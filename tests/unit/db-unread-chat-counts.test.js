import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function getFunctionSource(functionName) {
    const start = dbSource.indexOf(`export async function ${functionName}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextExport = dbSource.indexOf('\nexport ', start + 1);
    const nextImport = dbSource.indexOf('\nimport ', start + 1);
    const candidates = [nextExport, nextImport].filter((value) => value !== -1);
    const end = candidates.length > 0 ? Math.min(...candidates) : dbSource.length;
    return dbSource.slice(start, end);
}

function buildGetUnreadChatCount({ db, getDoc, doc, collection, query, where, getCountFromServer }) {
    const functionSource = getFunctionSource('getUnreadChatCount')
        .replace('export async function getUnreadChatCount', 'return async function getUnreadChatCount');

    return new Function(
        'db',
        'getDoc',
        'doc',
        'collection',
        'query',
        'where',
        'getCountFromServer',
        functionSource
    )(
        db,
        getDoc,
        doc,
        collection,
        query,
        where,
        getCountFromServer
    );
}

function buildGetUnreadChatCounts({ getUnreadChatCount, console }) {
    const functionSource = getFunctionSource('getUnreadChatCounts')
        .replace('export async function getUnreadChatCounts', 'return async function getUnreadChatCounts');

    return new Function(
        'getUnreadChatCount',
        'console',
        functionSource
    )(
        getUnreadChatCount,
        console
    );
}

function makeCountSnapshot(count) {
    return {
        data: () => ({ count })
    };
}

describe('chat unread count helpers', () => {
    it('uses aggregate counts after lastRead and subtracts the current user messages', async () => {
        const lastRead = { seconds: 123 };
        const getDoc = vi.fn().mockResolvedValue({
            data: () => ({
                chatLastRead: {
                    'team-1': lastRead
                }
            })
        });
        const doc = vi.fn(() => ({ path: 'users/user-1' }));
        const messagesRef = { path: 'teams/team-1/chatMessages' };
        const collection = vi.fn(() => messagesRef);
        const where = vi.fn((field, op, value) => ({ field, op, value }));
        const query = vi.fn((ref, ...constraints) => ({ ref, constraints }));
        const getCountFromServer = vi.fn()
            .mockResolvedValueOnce(makeCountSnapshot(7))
            .mockResolvedValueOnce(makeCountSnapshot(2));

        const getUnreadChatCount = buildGetUnreadChatCount({
            db: {},
            getDoc,
            doc,
            collection,
            query,
            where,
            getCountFromServer
        });

        await expect(getUnreadChatCount('user-1', 'team-1')).resolves.toBe(5);
        expect(getCountFromServer).toHaveBeenCalledTimes(2);
        expect(query).toHaveBeenNthCalledWith(1, messagesRef,
            { field: 'createdAt', op: '>', value: lastRead }
        );
        expect(query).toHaveBeenNthCalledWith(2, messagesRef,
            { field: 'createdAt', op: '>', value: lastRead },
            { field: 'senderId', op: '==', value: 'user-1' }
        );
    });

    it('uses aggregate counts for never-read users without falling back to getDocs', async () => {
        const getDoc = vi.fn().mockResolvedValue({
            data: () => ({})
        });
        const doc = vi.fn(() => ({ path: 'users/user-2' }));
        const messagesRef = { path: 'teams/team-9/chatMessages' };
        const collection = vi.fn(() => messagesRef);
        const where = vi.fn((field, op, value) => ({ field, op, value }));
        const query = vi.fn((ref, ...constraints) => ({ ref, constraints }));
        const getCountFromServer = vi.fn()
            .mockResolvedValueOnce(makeCountSnapshot(4))
            .mockResolvedValueOnce(makeCountSnapshot(1));

        const getUnreadChatCount = buildGetUnreadChatCount({
            db: {},
            getDoc,
            doc,
            collection,
            query,
            where,
            getCountFromServer
        });

        await expect(getUnreadChatCount('user-2', 'team-9')).resolves.toBe(3);
        expect(query).toHaveBeenNthCalledWith(1, messagesRef);
        expect(query).toHaveBeenNthCalledWith(2, messagesRef,
            { field: 'senderId', op: '==', value: 'user-2' }
        );
        expect(getCountFromServer).toHaveBeenCalledTimes(2);
    });

    it('keeps multi-team unread counts on the aggregate helper path', async () => {
        const getUnreadChatCount = vi.fn()
            .mockResolvedValueOnce(3)
            .mockRejectedValueOnce(new Error('index pending'));
        const warn = vi.fn();
        const getUnreadChatCounts = buildGetUnreadChatCounts({
            getUnreadChatCount,
            console: { warn }
        });

        await expect(getUnreadChatCounts('user-3', ['team-a', 'team-b'])).resolves.toEqual({
            'team-a': 3,
            'team-b': 0
        });
        expect(getUnreadChatCount).toHaveBeenCalledTimes(2);
        expect(getUnreadChatCount).toHaveBeenNthCalledWith(1, 'user-3', 'team-a');
        expect(getUnreadChatCount).toHaveBeenNthCalledWith(2, 'user-3', 'team-b');
        expect(warn).toHaveBeenCalledWith('Failed to get unread count for team team-b:', expect.any(Error));
    });
});
