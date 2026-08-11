import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    canProjectChatConversation,
    serializeChatConversationProjection
} = require('../../functions/chat-conversation-access-core.cjs');

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
