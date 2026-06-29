import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

describe('targeted team chat Firestore rules', () => {
    it('keeps full-team messages readable by existing team chat members', () => {
        expect(rules).toContain('function isFullTeamChatMessage(data)');
        expect(rules).toContain("data.get('targetType', 'full_team') == 'full_team'");
        expect(rules).toContain('hasEmptyChatRecipients(data)');
        expect(rules).toContain('isFullTeamChatMessage(data) ||');
    });

    it('keeps legacy team chat queries open for members while limiting stored docs to full-team messages', () => {
        expect(rules).toContain('allow list: if canAccessTeamChat(teamId);');
        expect(rules).toContain('allow get: if isFullTeamChatMessage(resource.data) &&');
        expect(rules).toContain('allow create: if canAccessTeamChat(teamId) &&');
        expect(rules).toContain('isFullTeamChatMessage(request.resource.data);');
        expect(rules).not.toContain('allow read: if canReadChatMessage(teamId, resource.data);');
    });

    it('keeps targeted conversation traffic under conversation-scoped rules', () => {
        expect(rules).toContain('match /chatConversations/{conversationId} {');
        expect(rules).toContain('match /chatMessages/{messageId} {');
        expect(rules).toContain('allow create: if canAccessChatConversation(teamId, conversationId, get(/databases/$(database)/documents/teams/$(teamId)/chatConversations/$(conversationId)).data) &&');
        expect(rules).toContain("request.resource.data.senderId == request.auth.uid;");
    });

    it('restricts staff/group messages to sender and team staff/admin roles', () => {
        expect(rules).toContain('function isStaffChatMessage(data)');
        expect(rules).toContain("data.get('targetRole', 'staff') == 'staff'");
        expect(rules).toContain('isTeamOwnerOrAdmin(teamId) ||');
        expect(rules).toContain('data.senderId == request.auth.uid');
    });

    it('restricts individual messages to sender, listed recipients, and staff/admins', () => {
        expect(rules).toContain('function isIndividualChatMessage(teamId, data)');
        expect(rules).toContain('function isCurrentChatRecipient(data)');
        expect(rules).toContain('request.auth.uid in data.recipientIds');
        expect(rules).toContain("('user:' + request.auth.uid) in data.recipientIds");
        expect(rules).toContain("('email:' + request.auth.token.email.lower()) in data.recipientIds");
        expect(rules).toContain('hasValidChatRecipientIds(teamId, data)');
    });

    it('rejects malformed or non-member recipient lists on targeted writes', () => {
        expect(rules).toContain('function teamChatRecipientIds(teamId)');
        expect(rules).toContain("data.get('chatMemberIds', [])");
        expect(rules).toContain('data.recipientIds is list');
        expect(rules).toContain('data.recipientIds.size() > 0');
        expect(rules).toContain('data.recipientIds.size() <= 50');
        expect(rules).toContain('data.recipientIds.hasOnly(teamChatRecipientIds(teamId))');
        expect(rules).toContain('isValidChatMessageTarget(teamId, data)');
    });

    it('rejects unauthorized senders by requiring senderId to match auth uid', () => {
        expect(rules).toContain('request.resource.data.senderId == request.auth.uid &&');
    });

    it('locks membership and naming changes to team staff while letting participants update benign metadata', () => {
        expect(rules).toContain('function isChatConversationParticipantMetadataUpdate()');
        expect(rules).toContain("request.resource.data.get('name', null) == resource.data.get('name', null)");
        expect(rules).toContain("request.resource.data.get('participantIds', []) == resource.data.get('participantIds', [])");
        expect(rules).toContain("request.resource.data.get('participantRoles', []) == resource.data.get('participantRoles', [])");
        expect(rules).toContain(".hasOnly(['lastMessageAt', 'mutedBy', 'updatedAt']);");
        expect(rules).toContain('function isTeamStaffChatConversationUpdate(teamId)');
        expect(rules).toContain('return isTeamOwnerOrAdmin(teamId) &&');
        expect(rules).toContain('(isTeamStaffChatConversationUpdate(teamId) ||');
        expect(rules).toContain('isChatConversationParticipantMetadataUpdate());');
    });

    it('requires team staff/admin access and server-derived members for the canonical staff conversation', () => {
        expect(rules).toContain("function isCanonicalStaffChatConversation(conversationId)");
        expect(rules).toContain("return conversationId == 'group_role%3Astaff';");
        expect(rules).toContain("function isCanonicalStaffChatConversationPayload(conversationId, data)");
        expect(rules).toContain("data.get('type', '') == 'group'");
        expect(rules).toContain("'staff' in data.get('participantRoles', [])");
        expect(rules).toContain("data.get('participantIds', []) == []");
        expect(rules).toContain('isCanonicalStaffChatConversation(conversationId) &&');
        expect(rules).toContain('isTeamOwnerOrAdmin(teamId) &&');
        expect(rules).toContain('isCanonicalStaffChatConversationPayload(conversationId, conversationData)');
    });

    it('does not authorize staff-role conversations through caller-controlled participantIds', () => {
        expect(rules).toContain('function isStaffRoleChatConversation(data)');
        expect(rules).toContain("data.get('participantRoles', []) is list &&");
        expect(rules).toContain("'staff' in data.get('participantRoles', [])");
        expect(rules).toContain('!isCanonicalStaffChatConversation(conversationId) &&');
        expect(rules).toContain('!isStaffRoleChatConversation(conversationData) &&');
        const accessHelperStart = rules.indexOf('function canAccessChatConversation(teamId, conversationId, conversationData)');
        const accessHelperEnd = rules.indexOf('function isChatConversationPayloadValid(data)');
        const accessHelper = rules.slice(accessHelperStart, accessHelperEnd);

        expect(accessHelper).toContain('request.auth.uid in participantIds');
        expect(accessHelper.indexOf('!isStaffRoleChatConversation(conversationData) &&'))
            .toBeLessThan(accessHelper.indexOf('request.auth.uid in participantIds'));
    });

    it('keeps conversation list authorization compatible with existing participant and moderator queries', () => {
        expect(rules).toContain('allow get: if canAccessChatConversation(teamId, conversationId, resource.data);');
        expect(rules).toContain('allow list: if canListChatConversation(teamId, conversationId, resource.data);');
        expect(rules).toContain('function canListChatConversation(teamId, conversationId, conversationData)');

        const listHelperStart = rules.indexOf('function canListChatConversation(teamId, conversationId, conversationData)');
        const listHelperEnd = rules.indexOf('function isCanonicalStaffChatConversationPayload(conversationId, data)');
        const listHelper = rules.slice(listHelperStart, listHelperEnd);

        expect(listHelper).toContain('isTeamOwnerOrAdmin(teamId) ||');
        expect(listHelper).toContain('request.auth.uid in participantIds');
        expect(listHelper).not.toContain('!isStaffRoleChatConversation(conversationData)');
    });
});
