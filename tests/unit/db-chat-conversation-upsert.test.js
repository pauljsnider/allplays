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

describe('upsertChatConversation', () => {
    it('creates a new targeted conversation with participant membership on first write', async () => {
        const now = { seconds: 123 };
        const getDoc = vi.fn().mockResolvedValue(makeSnapshot(null));
        const setDoc = vi.fn().mockResolvedValue(undefined);
        const conversationRef = { path: 'teams/team-1/chatConversations/direct-user-1-user-2' };
        const upsertChatConversation = buildUpsertChatConversation({
            normalizeConversationType: vi.fn((value) => value),
            normalizeConversationParticipantIds: vi.fn((ids) => [...ids].sort()),
            buildConversationId: vi.fn(() => 'direct-user-1-user-2'),
            Timestamp: { now: vi.fn(() => now) },
            doc: vi.fn(() => conversationRef),
            db: {},
            getDoc,
            setDoc
        });

        const result = await upsertChatConversation('team-1', {
            type: 'direct',
            participantIds: ['user-2', 'user-1'],
            participantRoles: ['staff', 'staff'],
            mutedBy: ['user-1', 'user-1'],
            name: 'Private chat'
        });

        expect(setDoc).toHaveBeenCalledWith(conversationRef, {
            type: 'direct',
            participantIds: ['user-1', 'user-2'],
            participantRoles: ['staff'],
            mutedBy: ['user-1'],
            name: 'Private chat',
            updatedAt: now,
            createdAt: now
        }, { merge: true });
        expect(result).toEqual({
            id: 'direct-user-1-user-2',
            type: 'direct',
            participantIds: ['user-1', 'user-2'],
            participantRoles: ['staff'],
            mutedBy: ['user-1'],
            name: 'Private chat',
            updatedAt: now,
            createdAt: now
        });
    });

    it('persists mutable metadata for an existing conversation without rewriting immutable membership fields', async () => {
        const now = { seconds: 999 };
        const conversationRef = { path: 'teams/team-1/chatConversations/group-user-1-user-2' };
        const getDoc = vi.fn().mockResolvedValue(makeSnapshot({
            type: 'group',
            participantIds: ['user-1', 'user-2'],
            participantRoles: [],
            mutedBy: ['user-2'],
            name: 'Existing chat',
            createdAt: { seconds: 1 },
            updatedAt: { seconds: 2 }
        }));
        const setDoc = vi.fn().mockResolvedValue(undefined);
        const upsertChatConversation = buildUpsertChatConversation({
            normalizeConversationType: vi.fn((value) => value),
            normalizeConversationParticipantIds: vi.fn((ids) => [...ids].sort()),
            buildConversationId: vi.fn(() => 'group-user-1-user-2'),
            Timestamp: { now: vi.fn(() => now) },
            doc: vi.fn(() => conversationRef),
            db: {},
            getDoc,
            setDoc
        });

        const result = await upsertChatConversation('team-1', {
            type: 'group',
            participantIds: ['user-2', 'user-1', 'user-3'],
            participantRoles: ['staff'],
            mutedBy: [],
            name: 'Renamed by participant'
        });

        expect(setDoc).toHaveBeenCalledWith(conversationRef, {
            mutedBy: [],
            updatedAt: now
        }, { merge: true });
        expect(result).toEqual({
            id: 'group-user-1-user-2',
            type: 'group',
            participantIds: ['user-1', 'user-2'],
            participantRoles: [],
            mutedBy: [],
            name: 'Existing chat',
            createdAt: { seconds: 1 },
            updatedAt: now
        });
    });

    it('backfills a missing display name on an existing targeted conversation', async () => {
        const now = { seconds: 321 };
        const conversationRef = { path: 'teams/team-1/chatConversations/direct-user-1-user-2' };
        const getDoc = vi.fn().mockResolvedValue(makeSnapshot({
            type: 'direct',
            participantIds: ['user-1', 'user-2'],
            participantRoles: [],
            mutedBy: [],
            createdAt: { seconds: 1 },
            updatedAt: { seconds: 2 }
        }));
        const setDoc = vi.fn().mockResolvedValue(undefined);
        const upsertChatConversation = buildUpsertChatConversation({
            normalizeConversationType: vi.fn((value) => value),
            normalizeConversationParticipantIds: vi.fn((ids) => [...ids].sort()),
            buildConversationId: vi.fn(() => 'direct-user-1-user-2'),
            Timestamp: { now: vi.fn(() => now) },
            doc: vi.fn(() => conversationRef),
            db: {},
            getDoc,
            setDoc
        });

        const result = await upsertChatConversation('team-1', {
            type: 'direct',
            participantIds: ['user-2', 'user-1'],
            participantRoles: [],
            name: 'Avery Parent'
        });

        expect(setDoc).toHaveBeenCalledWith(conversationRef, {
            name: 'Avery Parent',
            updatedAt: now
        }, { merge: true });
        expect(result).toEqual({
            id: 'direct-user-1-user-2',
            type: 'direct',
            participantIds: ['user-1', 'user-2'],
            participantRoles: [],
            mutedBy: [],
            name: 'Avery Parent',
            createdAt: { seconds: 1 },
            updatedAt: now
        });
    });

    it('builds one stable conversation id for staff-only role conversations', async () => {
        const now = { seconds: 456 };
        const getDoc = vi.fn().mockResolvedValue(makeSnapshot(null));
        const setDoc = vi.fn().mockResolvedValue(undefined);
        const conversationRef = { path: 'teams/team-1/chatConversations/group_role%3Astaff' };
        const buildConversationId = vi.fn(() => 'group_role%3Astaff');
        const upsertChatConversation = buildUpsertChatConversation({
            normalizeConversationType: vi.fn((value) => value),
            normalizeConversationParticipantIds: vi.fn(() => []),
            buildConversationId,
            Timestamp: { now: vi.fn(() => now) },
            doc: vi.fn(() => conversationRef),
            db: {},
            getDoc,
            setDoc
        });

        const result = await upsertChatConversation('team-1', {
            type: 'group',
            participantIds: ['coach-2'],
            participantRoles: ['staff'],
            mutedBy: [],
            name: 'Staff only'
        });

        expect(buildConversationId).toHaveBeenCalledWith('group', [], ['staff']);
        expect(setDoc).toHaveBeenCalledWith(conversationRef, {
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
});
