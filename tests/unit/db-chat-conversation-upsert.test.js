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

function buildUpsertChatConversation({
    normalizeConversationType,
    normalizeConversationParticipantIds,
    buildConversationId,
    createAuthorizedChatConversation,
    Timestamp,
    doc,
    db,
    getDoc,
    setDoc
}) {
    const functionSource = getFunctionSource('upsertChatConversation')
        .replace('export async function upsertChatConversation', 'return async function upsertChatConversation');

    return new Function(
        'normalizeConversationType',
        'normalizeConversationParticipantIds',
        'buildConversationId',
        'createAuthorizedChatConversation',
        'Timestamp',
        'doc',
        'db',
        'getDoc',
        'setDoc',
        functionSource
    )(
        normalizeConversationType,
        normalizeConversationParticipantIds,
        buildConversationId,
        createAuthorizedChatConversation,
        Timestamp,
        doc,
        db,
        getDoc,
        setDoc
    );
}

function makeSnapshot(data) {
    return {
        exists: () => Boolean(data),
        data: () => data
    };
}

function buildDependencies(overrides = {}) {
    return {
        normalizeConversationType: vi.fn((value) => value),
        normalizeConversationParticipantIds: vi.fn((ids) => [...ids].sort()),
        buildConversationId: vi.fn(() => 'group_role%3Astaff'),
        createAuthorizedChatConversation: vi.fn(),
        Timestamp: { now: vi.fn(() => ({ seconds: 456 })) },
        doc: vi.fn(() => ({ path: 'teams/team-1/chatConversations/group_role%3Astaff' })),
        db: {},
        getDoc: vi.fn().mockResolvedValue(makeSnapshot(null)),
        setDoc: vi.fn().mockResolvedValue(undefined),
        ...overrides
    };
}

describe('upsertChatConversation', () => {
    it('routes participant-scoped creation to the server without forwarding a client classification', async () => {
        const serverConversation = {
            id: 'direct_friend-1__user-1',
            type: 'direct',
            participantIds: ['friend-1', 'user-1'],
            directAccess: 'accepted_friend'
        };
        const dependencies = buildDependencies({
            createAuthorizedChatConversation: vi.fn().mockResolvedValue(serverConversation)
        });
        const upsertChatConversation = buildUpsertChatConversation(dependencies);

        const result = await upsertChatConversation('team-1', {
            type: 'group',
            participantIds: ['user:user-1', 'email:friend@example.test'],
            directAccess: 'forged-client-value',
            name: 'Parents'
        });

        expect(dependencies.createAuthorizedChatConversation).toHaveBeenCalledWith(
            'team-1',
            ['email:friend@example.test', 'user:user-1'],
            { name: 'Parents' }
        );
        expect(dependencies.buildConversationId).not.toHaveBeenCalled();
        expect(dependencies.setDoc).not.toHaveBeenCalled();
        expect(result).toEqual(serverConversation);
    });

    it('fails closed when the server-authoritative participant create is denied', async () => {
        const denied = new Error('not authorized');
        const dependencies = buildDependencies({
            createAuthorizedChatConversation: vi.fn().mockRejectedValue(denied)
        });
        const upsertChatConversation = buildUpsertChatConversation(dependencies);

        await expect(upsertChatConversation('team-1', {
            type: 'direct',
            participantIds: ['user-1', 'user-2']
        })).rejects.toBe(denied);
        expect(dependencies.getDoc).not.toHaveBeenCalled();
        expect(dependencies.setDoc).not.toHaveBeenCalled();
    });

    it('builds one stable conversation id for staff-only role conversations', async () => {
        const now = { seconds: 456 };
        const conversationRef = { path: 'teams/team-1/chatConversations/group_role%3Astaff' };
        const dependencies = buildDependencies({
            normalizeConversationParticipantIds: vi.fn(() => []),
            Timestamp: { now: vi.fn(() => now) },
            doc: vi.fn(() => conversationRef)
        });
        const upsertChatConversation = buildUpsertChatConversation(dependencies);

        const result = await upsertChatConversation('team-1', {
            type: 'group',
            participantIds: ['coach-2'],
            participantRoles: ['staff'],
            mutedBy: [],
            name: 'Staff only'
        });

        expect(dependencies.createAuthorizedChatConversation).not.toHaveBeenCalled();
        expect(dependencies.buildConversationId).toHaveBeenCalledWith('group', [], ['staff']);
        expect(dependencies.setDoc).toHaveBeenCalledWith(conversationRef, {
            type: 'group',
            participantIds: [],
            participantRoles: ['staff'],
            mutedBy: [],
            updatedAt: now,
            name: 'Staff only',
            createdAt: now
        }, { merge: true });
        expect(result).toEqual({
            id: 'group_role%3Astaff',
            type: 'group',
            participantIds: [],
            participantRoles: ['staff'],
            mutedBy: [],
            updatedAt: now,
            name: 'Staff only',
            createdAt: now
        });
    });

    it('repairs legacy participant-scoped data on the canonical staff conversation', async () => {
        const now = { seconds: 789 };
        const conversationRef = { path: 'teams/team-1/chatConversations/group_role%3Astaff' };
        const dependencies = buildDependencies({
            normalizeConversationParticipantIds: vi.fn(() => []),
            Timestamp: { now: vi.fn(() => now) },
            doc: vi.fn(() => conversationRef),
            getDoc: vi.fn().mockResolvedValue(makeSnapshot({
                type: 'group',
                participantIds: ['coach-1'],
                participantRoles: ['staff', 'coach'],
                mutedBy: ['coach-2'],
                name: 'Staff only',
                createdAt: { seconds: 1 },
                updatedAt: { seconds: 2 }
            }))
        });
        const upsertChatConversation = buildUpsertChatConversation(dependencies);

        const result = await upsertChatConversation('team-1', {
            type: 'group',
            participantIds: [],
            participantRoles: ['staff'],
            name: 'Staff only'
        });

        expect(dependencies.setDoc).toHaveBeenCalledWith(conversationRef, {
            type: 'group',
            participantIds: [],
            participantRoles: ['staff'],
            updatedAt: now
        }, { merge: true });
        expect(result).toEqual({
            id: 'group_role%3Astaff',
            type: 'group',
            participantIds: [],
            participantRoles: ['staff'],
            mutedBy: ['coach-2'],
            name: 'Staff only',
            createdAt: { seconds: 1 },
            updatedAt: now
        });
    });
});
