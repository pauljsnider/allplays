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
        expect(rules).toContain('isValidChatMessageTarget(teamId, request.resource.data)');
    });

    it('rejects unauthorized senders by requiring senderId to match auth uid', () => {
        expect(rules).toContain('request.resource.data.senderId == request.auth.uid &&');
    });
});
