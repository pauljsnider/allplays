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

function buildGetUnreadChatCount({ db, getDoc, doc, collection, query, where, orderBy, limit, getDocs, getCountFromServer, DEFAULT_TEAM_CONVERSATION_ID = 'team', isDefaultTeamConversation = (conversationId) => conversationId === 'team' }) {
    const functionSource = getFunctionSource('getUnreadChatCount')
        .replace('export async function getUnreadChatCount', 'return async function getUnreadChatCount');

    return new Function(
        'db',
        'getDoc',
        'doc',
        'collection',
        'query',
        'where',
        'orderBy',
        'limit',
        'getDocs',
        'getCountFromServer',
        'DEFAULT_TEAM_CONVERSATION_ID',
        'isDefaultTeamConversation',
        functionSource
    )(
        db,
        getDoc,
        doc,
        collection,
        query,
        where,
        orderBy,
        limit,
        getDocs,
        getCountFromServer,
        DEFAULT_TEAM_CONVERSATION_ID,
        isDefaultTeamConversation
    );
}

function buildGetUnreadChatCounts({ db, getDoc, doc, getUnreadChatCount, getChatConversations, console, DEFAULT_TEAM_CONVERSATION_ID = 'team', isDefaultTeamConversation = (conversationId) => conversationId === 'team' }) {
    const functionSource = getFunctionSource('getUnreadChatCounts')
        .replace('export async function getUnreadChatCounts', 'return async function getUnreadChatCounts');

    return new Function(
        'db',
        'getDoc',
        'doc',
        'getUnreadChatCount',
        'getChatConversations',
        'console',
        'DEFAULT_TEAM_CONVERSATION_ID',
        'isDefaultTeamConversation',
        functionSource
    )(
        db,
        getDoc,
        doc,
        getUnreadChatCount,
        getChatConversations,
        console,
        DEFAULT_TEAM_CONVERSATION_ID,
        isDefaultTeamConversation
    );
}

function buildChatStateUpdater(functionName, dependencies) {
    const functionSource = getFunctionSource(functionName)
        .replace(`export async function ${functionName}`, `return async function ${functionName}`);

    return new Function(
        'db',
        'doc',
        'updateDoc',
        'setDoc',
        'Timestamp',
        'deleteField',
        'DEFAULT_TEAM_CONVERSATION_ID',
        'isDefaultTeamConversation',
        functionSource
    )(
        dependencies.db,
        dependencies.doc,
        dependencies.updateDoc,
        dependencies.setDoc,
        dependencies.Timestamp,
        dependencies.deleteField,
        dependencies.DEFAULT_TEAM_CONVERSATION_ID,
        dependencies.isDefaultTeamConversation
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
        const orderBy = vi.fn((field, direction) => ({ field, direction }));
        const limit = vi.fn((value) => ({ limit: value }));
        const query = vi.fn((ref, ...constraints) => ({ ref, constraints }));
        const getDocs = vi.fn().mockResolvedValue({
            docs: [{ data: () => ({ createdAt: { seconds: 200 } }) }]
        });
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
            orderBy,
            limit,
            getDocs,
            getCountFromServer
        });

        await expect(getUnreadChatCount('user-1', 'team-1')).resolves.toBe(5);
        expect(getCountFromServer).toHaveBeenCalledTimes(2);
        expect(query).toHaveBeenNthCalledWith(1, messagesRef,
            { field: 'createdAt', direction: 'desc' },
            { limit: 1 }
        );
        expect(query).toHaveBeenNthCalledWith(2, messagesRef,
            { field: 'createdAt', op: '>', value: lastRead }
        );
        expect(query).toHaveBeenNthCalledWith(3, messagesRef,
            { field: 'createdAt', op: '>', value: lastRead },
            { field: 'senderId', op: '==', value: 'user-1' }
        );
        expect(where).not.toHaveBeenCalledWith('targetType', '==', 'full_team');
        expect(where).not.toHaveBeenCalledWith('recipientIds', '==', []);
    });

    it('uses aggregate counts for never-read users without falling back to getDocs', async () => {
        const getDoc = vi.fn().mockResolvedValue({
            data: () => ({})
        });
        const doc = vi.fn(() => ({ path: 'users/user-2' }));
        const messagesRef = { path: 'teams/team-9/chatMessages' };
        const collection = vi.fn(() => messagesRef);
        const where = vi.fn((field, op, value) => ({ field, op, value }));
        const orderBy = vi.fn((field, direction) => ({ field, direction }));
        const limit = vi.fn((value) => ({ limit: value }));
        const query = vi.fn((ref, ...constraints) => ({ ref, constraints }));
        const getDocs = vi.fn().mockResolvedValue({
            docs: [{ data: () => ({ createdAt: { seconds: 200 } }) }]
        });
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
            orderBy,
            limit,
            getDocs,
            getCountFromServer
        });

        await expect(getUnreadChatCount('user-2', 'team-9')).resolves.toBe(3);
        expect(query).toHaveBeenNthCalledWith(1, messagesRef,
            { field: 'createdAt', direction: 'desc' },
            { limit: 1 }
        );
        expect(query).toHaveBeenNthCalledWith(2, messagesRef);
        expect(query).toHaveBeenNthCalledWith(3, messagesRef,
            { field: 'senderId', op: '==', value: 'user-2' }
        );
        expect(getCountFromServer).toHaveBeenCalledTimes(2);
        expect(where).not.toHaveBeenCalledWith('targetType', '==', 'full_team');
        expect(where).not.toHaveBeenCalledWith('recipientIds', '==', []);
    });

    it('skips count queries when the latest team message is already read', async () => {
        const lastRead = { seconds: 300 };
        const getDoc = vi.fn();
        const doc = vi.fn();
        const messagesRef = { path: 'teams/team-1/chatMessages' };
        const collection = vi.fn(() => messagesRef);
        const where = vi.fn((field, op, value) => ({ field, op, value }));
        const orderBy = vi.fn((field, direction) => ({ field, direction }));
        const limit = vi.fn((value) => ({ limit: value }));
        const query = vi.fn((ref, ...constraints) => ({ ref, constraints }));
        const getDocs = vi.fn().mockResolvedValue({
            docs: [{ data: () => ({ createdAt: { seconds: 200 } }) }]
        });
        const getCountFromServer = vi.fn();

        const getUnreadChatCount = buildGetUnreadChatCount({
            db: {},
            getDoc,
            doc,
            collection,
            query,
            where,
            orderBy,
            limit,
            getDocs,
            getCountFromServer
        });

        await expect(getUnreadChatCount('user-1', 'team-1', {
            userData: {
                teamChatState: {
                    'team-1': {
                        lastReadAt: lastRead
                    }
                }
            }
        })).resolves.toBe(0);
        expect(getCountFromServer).not.toHaveBeenCalled();
    });

    it('uses supplied latest-message timestamps without probing the latest message', async () => {
        const getDoc = vi.fn();
        const doc = vi.fn();
        const messagesRef = { path: 'teams/team-1/chatMessages' };
        const collection = vi.fn(() => messagesRef);
        const where = vi.fn((field, op, value) => ({ field, op, value }));
        const orderBy = vi.fn((field, direction) => ({ field, direction }));
        const limit = vi.fn((value) => ({ limit: value }));
        const query = vi.fn((ref, ...constraints) => ({ ref, constraints }));
        const getDocs = vi.fn();
        const getCountFromServer = vi.fn()
            .mockResolvedValueOnce(makeCountSnapshot(6))
            .mockResolvedValueOnce(makeCountSnapshot(2));

        const getUnreadChatCount = buildGetUnreadChatCount({
            db: {},
            getDoc,
            doc,
            collection,
            query,
            where,
            orderBy,
            limit,
            getDocs,
            getCountFromServer
        });

        await expect(getUnreadChatCount('user-1', 'team-1', {
            userData: {},
            latestMessageAt: { seconds: 500 }
        })).resolves.toBe(4);
        expect(getDocs).not.toHaveBeenCalled();
        expect(orderBy).not.toHaveBeenCalled();
        expect(limit).not.toHaveBeenCalled();
        expect(getCountFromServer).toHaveBeenCalledTimes(2);
    });

    it('uses conversation-scoped last-read state for non-default conversations', async () => {
        const lastRead = { seconds: 300 };
        const getDoc = vi.fn();
        const doc = vi.fn();
        const messagesRef = { path: 'teams/team-1/chatConversations/staff-conversation/chatMessages' };
        const collection = vi.fn(() => messagesRef);
        const where = vi.fn((field, op, value) => ({ field, op, value }));
        const orderBy = vi.fn((field, direction) => ({ field, direction }));
        const limit = vi.fn((value) => ({ limit: value }));
        const query = vi.fn((ref, ...constraints) => ({ ref, constraints }));
        const getDocs = vi.fn().mockResolvedValue({
            docs: [{ data: () => ({ createdAt: { seconds: 200 } }) }]
        });
        const getCountFromServer = vi.fn();

        const getUnreadChatCount = buildGetUnreadChatCount({
            db: {},
            getDoc,
            doc,
            collection,
            query,
            where,
            orderBy,
            limit,
            getDocs,
            getCountFromServer
        });

        await expect(getUnreadChatCount('user-1', 'team-1', {
            conversationId: 'staff-conversation',
            userData: {
                teamChatState: {
                    'team-1': {
                        lastReadByConversation: {
                            'staff-conversation': lastRead
                        }
                    }
                }
            }
        })).resolves.toBe(0);
        expect(collection).toHaveBeenCalledWith({}, 'teams', 'team-1', 'chatConversations', 'staff-conversation', 'chatMessages');
        expect(getCountFromServer).not.toHaveBeenCalled();
    });

    it('reuses one user profile read and passes latest-message hints across teams', async () => {
        const getUnreadChatCount = vi.fn()
            .mockResolvedValueOnce(3)
            .mockRejectedValueOnce(new Error('index pending'));
        const getChatConversations = vi.fn().mockResolvedValue([]);
        const getDoc = vi.fn().mockResolvedValue({
            data: () => ({ teamChatState: { 'team-a': { lastReadAt: { seconds: 100 } } } })
        });
        const doc = vi.fn(() => ({ path: 'users/user-3' }));
        const warn = vi.fn();
        const getUnreadChatCounts = buildGetUnreadChatCounts({
            db: {},
            getDoc,
            doc,
            getUnreadChatCount,
            getChatConversations,
            console: { warn }
        });

        await expect(getUnreadChatCounts('user-3', ['team-a', 'team-b'], {
            latestMessageAtByTeam: {
                'team-a': { seconds: 150 },
                'team-b': { seconds: 250 }
            }
        })).resolves.toEqual({
            'team-a': 3,
            'team-b': 0
        });
        expect(getDoc).toHaveBeenCalledTimes(1);
        expect(getUnreadChatCount).toHaveBeenCalledTimes(2);
        expect(getUnreadChatCount).toHaveBeenNthCalledWith(1, 'user-3', 'team-a', expect.objectContaining({
            userData: { teamChatState: { 'team-a': { lastReadAt: { seconds: 100 } } } },
            conversationId: 'team',
            latestMessageAt: { seconds: 150 }
        }));
        expect(getUnreadChatCount).toHaveBeenNthCalledWith(2, 'user-3', 'team-b', expect.objectContaining({
            userData: { teamChatState: { 'team-a': { lastReadAt: { seconds: 100 } } } },
            conversationId: 'team',
            latestMessageAt: { seconds: 250 }
        }));
        expect(warn).toHaveBeenCalledWith('Failed to get unread count for team team-b conversation team:', expect.any(Error));
    });

    it('keeps fast inbox unread counts on the default conversation only', async () => {
        const getUnreadChatCount = vi.fn()
            .mockResolvedValueOnce(1);
        const getChatConversations = vi.fn();
        const getDoc = vi.fn().mockResolvedValue({
            data: () => ({ teamChatState: {} })
        });
        const doc = vi.fn(() => ({ path: 'users/user-5' }));
        const warn = vi.fn();
        const getUnreadChatCounts = buildGetUnreadChatCounts({
            db: {},
            getDoc,
            doc,
            getUnreadChatCount,
            getChatConversations,
            console: { warn }
        });
        const lookupUser = { uid: 'user-5', email: 'staff@example.com' };
        const lookupTeam = { id: 'team-a', name: 'Bears' };

        await expect(getUnreadChatCounts('user-5', ['team-a'], {
            defaultConversationOnly: true,
            latestMessageAtByTeam: {
                'team-a': { seconds: 250 }
            },
            conversationLookupByTeam: {
                'team-a': {
                    user: lookupUser,
                    team: lookupTeam,
                    canModerate: true
                }
            }
        })).resolves.toEqual({
            'team-a': 1
        });

        expect(getChatConversations).not.toHaveBeenCalled();
        expect(getUnreadChatCount).toHaveBeenCalledTimes(1);
        expect(getUnreadChatCount).toHaveBeenNthCalledWith(1, 'user-5', 'team-a', expect.objectContaining({
            conversationId: 'team',
            latestMessageAt: { seconds: 250 }
        }));
        expect(warn).not.toHaveBeenCalled();
    });

    it('aggregates unread counts across sibling conversations when ids are already loaded', async () => {
        const getUnreadChatCount = vi.fn()
            .mockResolvedValueOnce(1)
            .mockResolvedValueOnce(2)
            .mockResolvedValueOnce(0);
        const getChatConversations = vi.fn();
        const getDoc = vi.fn().mockResolvedValue({
            data: () => ({ teamChatState: {} })
        });
        const doc = vi.fn(() => ({ path: 'users/user-5' }));
        const warn = vi.fn();
        const getUnreadChatCounts = buildGetUnreadChatCounts({
            db: {},
            getDoc,
            doc,
            getUnreadChatCount,
            getChatConversations,
            console: { warn }
        });

        await expect(getUnreadChatCounts('user-5', ['team-a'], {
            defaultConversationOnly: true,
            latestMessageAtByTeam: {
                'team-a': { seconds: 250 }
            },
            latestMessageAtByConversationByTeam: {
                'team-a': {
                    'staff-conversation': { seconds: 240 },
                    'direct-conversation': { seconds: 230 }
                }
            },
            conversationIdsByTeam: {
                'team-a': ['team', 'staff-conversation', 'direct-conversation']
            }
        })).resolves.toEqual({
            'team-a': 3
        });

        expect(getChatConversations).not.toHaveBeenCalled();
        expect(getUnreadChatCount).toHaveBeenNthCalledWith(1, 'user-5', 'team-a', expect.objectContaining({
            conversationId: 'team',
            latestMessageAt: { seconds: 250 }
        }));
        expect(getUnreadChatCount).toHaveBeenNthCalledWith(2, 'user-5', 'team-a', expect.objectContaining({
            conversationId: 'staff-conversation',
            latestMessageAt: { seconds: 240 }
        }));
        expect(getUnreadChatCount).toHaveBeenNthCalledWith(3, 'user-5', 'team-a', expect.objectContaining({
            conversationId: 'direct-conversation',
            latestMessageAt: { seconds: 230 }
        }));
        expect(warn).not.toHaveBeenCalled();
    });

    it('returns zero counts when the shared user profile read fails', async () => {
        const getUnreadChatCount = vi.fn();
        const getChatConversations = vi.fn();
        const getDoc = vi.fn().mockRejectedValue(new Error('permission denied'));
        const doc = vi.fn(() => ({ path: 'users/user-4' }));
        const warn = vi.fn();
        const getUnreadChatCounts = buildGetUnreadChatCounts({
            db: {},
            getDoc,
            doc,
            getUnreadChatCount,
            getChatConversations,
            console: { warn }
        });

        await expect(getUnreadChatCounts('user-4', ['team-a', 'team-b'])).resolves.toEqual({
            'team-a': 0,
            'team-b': 0
        });
        expect(getUnreadChatCount).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith('Failed to load chat state for user user-4:', expect.any(Error));
    });
});

describe('chat user state persistence helpers', () => {
    it('stores last-read in the team chat state while preserving legacy reads', async () => {
        const lastReadAt = { seconds: 456 };
        const doc = vi.fn(() => ({ path: 'users/user-1' }));
        const updateDoc = vi.fn().mockResolvedValue(undefined);
        const updateChatLastRead = buildChatStateUpdater('updateChatLastRead', {
            db: {},
            doc,
            updateDoc,
            Timestamp: { now: () => lastReadAt },
            deleteField: vi.fn(),
            DEFAULT_TEAM_CONVERSATION_ID: 'team',
            isDefaultTeamConversation: (conversationId) => conversationId === 'team'
        });

        await updateChatLastRead('user-1', 'team-1');

        expect(updateDoc).toHaveBeenCalledWith({ path: 'users/user-1' }, {
            'chatLastRead.team-1': lastReadAt,
            'teamChatState.team-1.lastReadAt': lastReadAt
        });
    });

    it('stores conversation-scoped last-read state without flattening the whole team', async () => {
        const lastReadAt = { seconds: 654 };
        const doc = vi.fn(() => ({ path: 'users/user-1' }));
        const setDoc = vi.fn().mockResolvedValue(undefined);
        const updateChatLastRead = buildChatStateUpdater('updateChatLastRead', {
            db: {},
            doc,
            updateDoc: vi.fn(),
            setDoc,
            Timestamp: { now: () => lastReadAt },
            deleteField: vi.fn(),
            DEFAULT_TEAM_CONVERSATION_ID: 'team',
            isDefaultTeamConversation: (conversationId) => conversationId === 'team'
        });

        await updateChatLastRead('user-1', 'team-1', 'staff-conversation');

        expect(setDoc).toHaveBeenCalledWith({ path: 'users/user-1' }, {
            teamChatState: {
                'team-1': {
                    lastReadByConversation: {
                        'staff-conversation': lastReadAt
                    }
                }
            }
        }, { merge: true });
    });

    it('stores per-conversation mute state in the team chat state map', async () => {
        const mutedAt = { seconds: 789 };
        const doc = vi.fn(() => ({ path: 'users/user-1' }));
        const setDoc = vi.fn().mockResolvedValue(undefined);
        const updateChatMuted = buildChatStateUpdater('updateChatMuted', {
            db: {},
            doc,
            updateDoc: vi.fn(),
            setDoc,
            Timestamp: { now: () => mutedAt },
            deleteField: vi.fn(),
            DEFAULT_TEAM_CONVERSATION_ID: 'team',
            isDefaultTeamConversation: (conversationId) => conversationId === 'team'
        });

        await updateChatMuted('user-1', 'team-1', 'staff-conversation');

        expect(setDoc).toHaveBeenCalledWith({ path: 'users/user-1' }, {
            teamChatState: {
                'team-1': {
                    mutedConversations: {
                        'staff-conversation': mutedAt
                    }
                }
            }
        }, { merge: true });
    });

    it('stores literal conversation ids when muting email threads with dots in the key', async () => {
        const mutedAt = { seconds: 654 };
        const doc = vi.fn(() => ({ path: 'users/user-1' }));
        const setDoc = vi.fn().mockResolvedValue(undefined);
        const updateChatMuted = buildChatStateUpdater('updateChatMuted', {
            db: {},
            doc,
            updateDoc: vi.fn(),
            setDoc,
            Timestamp: { now: () => mutedAt },
            deleteField: vi.fn(),
            DEFAULT_TEAM_CONVERSATION_ID: 'team',
            isDefaultTeamConversation: (conversationId) => conversationId === 'team'
        });

        await updateChatMuted('user-1', 'team-1', 'group_email%3Apat%40example.com');

        expect(setDoc).toHaveBeenCalledWith({ path: 'users/user-1' }, {
            teamChatState: {
                'team-1': {
                    mutedConversations: {
                        'group_email%3Apat%40example.com': mutedAt
                    }
                }
            }
        }, { merge: true });
    });

    it('preserves legacy team chat mute state for the default conversation only', async () => {
        const mutedAt = { seconds: 987 };
        const doc = vi.fn(() => ({ path: 'users/user-1' }));
        const setDoc = vi.fn().mockResolvedValue(undefined);
        const updateChatMuted = buildChatStateUpdater('updateChatMuted', {
            db: {},
            doc,
            updateDoc: vi.fn(),
            setDoc,
            Timestamp: { now: () => mutedAt },
            deleteField: vi.fn(),
            DEFAULT_TEAM_CONVERSATION_ID: 'team',
            isDefaultTeamConversation: (conversationId) => conversationId === 'team'
        });

        await updateChatMuted('user-1', 'team-1', 'team');

        expect(setDoc).toHaveBeenCalledWith({ path: 'users/user-1' }, {
            teamChatState: {
                'team-1': {
                    mutedConversations: {
                        team: mutedAt
                    }
                }
            },
            chatMuted: {
                'team-1': mutedAt
            }
        }, { merge: true });
    });

    it('clears only the selected conversation mute from team chat state', async () => {
        const deleted = Symbol('deleteField');
        const doc = vi.fn(() => ({ path: 'users/user-1' }));
        const setDoc = vi.fn().mockResolvedValue(undefined);
        const clearChatMuted = buildChatStateUpdater('clearChatMuted', {
            db: {},
            doc,
            updateDoc: vi.fn(),
            setDoc,
            Timestamp: { now: vi.fn() },
            deleteField: vi.fn(() => deleted),
            DEFAULT_TEAM_CONVERSATION_ID: 'team',
            isDefaultTeamConversation: (conversationId) => conversationId === 'team'
        });

        await clearChatMuted('user-1', 'team-1', 'staff-conversation');

        expect(setDoc).toHaveBeenCalledWith({ path: 'users/user-1' }, {
            teamChatState: {
                'team-1': {
                    mutedConversations: {
                        'staff-conversation': deleted
                    }
                }
            }
        }, { merge: true });
    });
});
