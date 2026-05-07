import { describe, it, expect } from 'vitest';
import {
    DEFAULT_TEAM_CONVERSATION_ID,
    buildConversationId,
    buildDefaultTeamConversation,
    getConversationDisplayName,
    isDefaultTeamConversation,
    isUserInConversation,
    normalizeConversationParticipantIds
} from '../../js/team-chat-conversations.js';

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
        expect(buildConversationId('direct', ['user:b', 'user:a'])).toBe('direct_user%3Aa__user%3Ab');
        expect(buildConversationId('group', ['player:42', 'email:parent@example.com'])).toBe('group_email%3Aparent%40example.com__player%3A42');
    });

    it('recognizes user, email, role, moderator, and team conversation participation', () => {
        const user = { uid: 'u1', email: 'parent@example.com' };

        expect(isUserInConversation({ id: 'group-1', type: 'group', participantIds: ['user:u1'] }, user)).toBe(true);
        expect(isUserInConversation({ id: 'group-2', type: 'group', participantIds: ['email:parent@example.com'] }, user)).toBe(true);
        expect(isUserInConversation({ id: 'group-3', type: 'group', participantIds: [] }, user)).toBe(false);
        expect(isUserInConversation({ id: 'group-3', type: 'group', participantIds: [] }, user, { canModerate: true })).toBe(true);
        expect(isUserInConversation({ id: DEFAULT_TEAM_CONVERSATION_ID, type: 'team' }, user)).toBe(true);
    });
});
