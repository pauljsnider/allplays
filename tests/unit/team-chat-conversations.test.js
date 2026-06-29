import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    DEFAULT_TEAM_CONVERSATION_ID,
    buildConversationId,
    buildDefaultTeamConversation,
    getConversationDisplayName,
    isDefaultTeamConversation,
    isUserInConversation,
    normalizeConversationParticipantIds
} from '../../js/team-chat-conversations.js';

function readRepoFile(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('team chat conversations', () => {
    it('keeps the default team channel as the legacy compatibility conversation', () => {
        const conversation = buildDefaultTeamConversation({ name: 'U12 Tigers' });

        expect(conversation).toMatchObject({
            id: DEFAULT_TEAM_CONVERSATION_ID,
            type: 'team',
            isDefault: true,
            isLegacy: true,
            name: 'U12 Tigers Team Chat'
        });
        expect(isDefaultTeamConversation(null)).toBe(true);
        expect(isDefaultTeamConversation(DEFAULT_TEAM_CONVERSATION_ID)).toBe(true);
        expect(getConversationDisplayName(conversation)).toBe('U12 Tigers Team Chat');
    });

    it('normalizes targeted participant IDs and produces stable direct/group ids', () => {
        expect(normalizeConversationParticipantIds(['user:b', '', 'user:a', 'user:b'])).toEqual(['user:a', 'user:b']);
        expect(normalizeConversationParticipantIds(['email:Parent@Example.com'])).toEqual(['email:parent@example.com']);
        expect(buildConversationId('direct', ['user:b', 'user:a'])).toBe('direct_user%3Aa__user%3Ab');
        expect(buildConversationId('group', ['player:42', 'email:parent@example.com'])).toBe('group_email%3Aparent%40example.com__player%3A42');
        expect(buildConversationId('group', ['coach-a'], ['staff'])).toBe('group_role%3Astaff');
        expect(buildConversationId('group', ['coach-b'], ['staff'])).toBe('group_role%3Astaff');
    });

    it('recognizes user, email, role, moderator, and team conversation participation', () => {
        const user = { uid: 'u1', email: 'parent@example.com' };

        expect(isUserInConversation({ id: 'group-1', type: 'group', participantIds: ['user:u1'] }, user)).toBe(true);
        expect(isUserInConversation({ id: 'group-2', type: 'group', participantIds: ['email:parent@example.com'] }, user)).toBe(true);
        const mixedCaseUser = { uid: 'u2', email: 'Parent@Example.com' };
        expect(isUserInConversation({ id: 'group-4', type: 'group', participantIds: ['email:parent@example.com'] }, mixedCaseUser)).toBe(true);
        expect(isUserInConversation({ id: 'group-3', type: 'group', participantIds: [] }, user)).toBe(false);
        expect(isUserInConversation({ id: 'group-5', type: 'group', participantIds: [], participantRoles: ['team'] }, user)).toBe(false);
        expect(isUserInConversation({ id: 'direct-1', type: 'direct', participantIds: [], participantRoles: ['team'] }, user)).toBe(false);
        expect(isUserInConversation({ id: 'group-3', type: 'group', participantIds: [] }, user, { canModerate: true })).toBe(true);
        expect(isUserInConversation({ id: DEFAULT_TEAM_CONVERSATION_ID, type: 'team' }, user)).toBe(true);
    });

    it('keeps Firestore conversation reads participant-scoped and client queries participant-aware', () => {
        const rules = readRepoFile('firestore.rules');
        const db = readRepoFile('js/db.js');

        expect(rules).toContain('allow get: if canAccessChatConversation(teamId, conversationId, resource.data);');
        expect(rules).toContain('allow list: if canListChatConversation(teamId, conversationId, resource.data);');
        expect(rules).toContain('canAccessChatConversation(teamId, conversationId, request.resource.data) &&');
        expect(rules).toContain("allow read: if canAccessChatConversation(teamId, conversationId, get(/databases/$(database)/documents/teams/$(teamId)/chatConversations/$(conversationId)).data);");
        expect(db).toContain("where('participantIds', 'array-contains', user.uid)");
        expect(db).toContain("where('participantIds', 'array-contains', `user:${user.uid}`)");
        expect(db).toContain("where('participantIds', 'array-contains', `email:${normalizedEmail}`)");
        expect(db).not.toContain("where('participantRoles', 'array-contains', 'team')");
        expect(rules).not.toContain("'team' in participantRoles");
    });
});
