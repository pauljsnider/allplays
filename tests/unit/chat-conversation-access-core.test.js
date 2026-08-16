import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    buildCanonicalConversationId,
    canProjectChatConversation,
    resolveCanonicalConversationParticipants,
    serializeChatConversationProjection
} = require('../../functions/chat-conversation-access-core.cjs');

describe('chat conversation participant canonicalization', () => {
    const authUsers = {
        'parent-1': { uid: 'parent-1', email: 'parent@example.test' },
        'friend-1': { uid: 'friend-1', email: 'friend@example.test' },
        'member-3': { uid: 'member-3', email: 'member3@example.test' }
    };
    const resolveUserByUid = async (uid) => authUsers[uid] || null;
    const resolveUserByEmail = async (email) => Object.values(authUsers)
        .find((user) => user.email === email) || null;

    it.each([
        {
            label: 'classifies two canonical users as direct',
            selectors: ['user:friend-1'],
            type: 'direct',
            ids: ['friend-1', 'parent-1']
        },
        {
            label: 'deduplicates UID and email aliases for one recipient',
            selectors: ['user:friend-1', 'email:friend@example.test'],
            type: 'direct',
            ids: ['friend-1', 'parent-1']
        },
        {
            label: 'classifies three canonical users as a group',
            selectors: ['friend-1', 'email:member3@example.test'],
            type: 'group',
            ids: ['friend-1', 'member-3', 'parent-1']
        }
    ])('$label', async ({ selectors, type, ids }) => {
        const result = await resolveCanonicalConversationParticipants({
            callerUid: 'parent-1',
            participantSelectors: selectors,
            resolveUserByUid,
            resolveUserByEmail
        });

        expect(result.type).toBe(type);
        expect(result.participantIds).toEqual(ids);
        expect(buildCanonicalConversationId(result.type, result.participantIds)).toBe(
            `${type}_${ids.map(encodeURIComponent).join('__')}`
        );
    });

    it('fails closed when aliases collapse to only the caller', async () => {
        await expect(resolveCanonicalConversationParticipants({
            callerUid: 'parent-1',
            participantSelectors: ['email:parent@example.test'],
            resolveUserByUid,
            resolveUserByEmail
        })).rejects.toThrow(/between 2 and 50/i);
    });
});

function canProject(overrides = {}) {
    return canProjectChatConversation({
        callerUid: 'parent-1',
        callerEmail: 'parent@example.com',
        canManageTeam: false,
        hasTeamChatAccess: true,
        conversationId: 'team',
        conversation: { type: 'team' },
        ...overrides
    });
}

describe('chat conversation callable projection access', () => {
    it('projects full-team and explicitly selected conversations for parents', () => {
        expect(canProject()).toBe(true);
        expect(canProject({
            conversationId: 'selected-group',
            conversation: { type: 'group', participantIds: ['coach-1', 'user:parent-1'] }
        })).toBe(true);
        expect(canProject({
            conversationId: 'email-group',
            conversation: { type: 'group', participantIds: ['email:parent@example.com'] }
        })).toBe(true);
    });

    it('does not expose another principal\'s accepted-friend or participant-only conversation', () => {
        expect(canProject({
            conversationId: 'direct-other-users',
            conversation: {
                type: 'direct',
                directAccess: 'accepted_friend',
                participantIds: ['user-2', 'user-3'],
                directUserIds: ['user-2', 'user-3']
            }
        })).toBe(false);
        expect(canProject({
            conversationId: 'selected-other-users',
            conversation: { type: 'group', participantIds: ['user-2', 'user-3'] }
        })).toBe(false);
    });

    it('does not repair a whitespace-distinct caller UID into another participant', () => {
        expect(canProject({
            callerUid: 'parent-1 ',
            conversationId: 'selected-parent',
            conversation: { type: 'group', participantIds: ['parent-1'] }
        })).toBe(false);
        expect(canProject({
            callerUid: 'parent-1 ',
            conversationId: 'direct-parent',
            conversation: {
                type: 'direct',
                directAccess: 'accepted_friend',
                participantIds: ['parent-1', 'friend-1'],
                directUserIds: ['parent-1', 'friend-1']
            }
        })).toBe(false);
    });

    it('keeps accepted-friend projections participant-only even for team administrators', () => {
        expect(canProject({
            canManageTeam: true,
            conversationId: 'direct-other-users',
            conversation: {
                type: 'direct',
                directAccess: 'accepted_friend',
                participantIds: ['user-2', 'user-3'],
                directUserIds: ['user-2', 'user-3']
            }
        })).toBe(false);
        expect(canProject({
            canManageTeam: true,
            conversationId: 'direct-parent',
            conversation: {
                type: 'direct',
                directAccess: 'accepted_friend',
                participantIds: ['parent-1', 'user-2'],
                directUserIds: ['parent-1', 'user-2']
            }
        })).toBe(true);
    });

    it('restricts staff conversations to canonical valid records and current managers', () => {
        const canonical = {
            conversationId: 'group_role%3Astaff',
            conversation: { type: 'group', participantIds: [], participantRoles: ['staff'] }
        };
        expect(canProject(canonical)).toBe(false);
        expect(canProject({ ...canonical, canManageTeam: true })).toBe(true);
        expect(canProject({
            canManageTeam: true,
            conversationId: 'legacy-staff',
            conversation: { type: 'group', participantIds: [], participantRoles: ['staff'] }
        })).toBe(false);
    });

    it('fails closed without verified team chat access', () => {
        expect(canProject({ hasTeamChatAccess: false })).toBe(false);
    });
});

describe('chat conversation callable projection serialization', () => {
    it('returns only bounded fields needed to hydrate an authorized thread', () => {
        const projection = serializeChatConversationProjection('direct-1', {
            type: 'direct',
            name: 'Parents',
            participantIds: ['user-1', 'user:friend-1', 'user-1'],
            participantRoles: ['parent'],
            directAccess: 'accepted_friend',
            directUserIds: ['user-1', 'friend-1'],
            friendshipId: 'friend-1__user-1',
            initiatedBy: 'user-1',
            mutedBy: ['private-other-user'],
            lastMessagePreview: 'private preview',
            updatedAt: '2026-08-11T12:00:00.000Z',
            lastMessageAt: '2026-08-11T12:01:00.000Z'
        });

        expect(projection).toEqual({
            id: 'direct-1',
            type: 'direct',
            name: 'Parents',
            participantIds: ['user-1', 'user:friend-1'],
            participantRoles: ['parent'],
            directAccess: 'accepted_friend',
            directUserIds: ['user-1', 'friend-1'],
            friendshipId: 'friend-1__user-1',
            initiatedBy: 'user-1',
            updatedAt: '2026-08-11T12:00:00.000Z',
            lastMessageAt: '2026-08-11T12:01:00.000Z',
            isDefault: false,
            isLegacy: false
        });
        expect(projection).not.toHaveProperty('mutedBy');
        expect(projection).not.toHaveProperty('lastMessagePreview');
    });

    it('rejects document-unsafe conversation IDs', () => {
        expect(serializeChatConversationProjection('group/unsafe', {})).toBeNull();
    });
});
