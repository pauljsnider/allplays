import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('team email attachments', () => {
    it('enforces the combined 20 MB limit before drafts are persisted', () => {
        const source = readRepoFile('js/team-email-attachments.js');

        expect(source).toContain('TEAM_EMAIL_ATTACHMENT_LIMIT_BYTES = 20 * 1024 * 1024');
        expect(source).toContain('assertTeamEmailAttachmentLimit(normalized);');
        expect(source).toContain('Number.isFinite(size) && size > 0 ? size : 0');
        expect(source).toContain('attachmentTotalBytes: getTeamEmailAttachmentTotalBytes(attachments)');
        expect(source).toContain('saveTeamEmailDraft');
        expect(source).not.toContain('queueTeamEmailSend');
        expect(source).not.toContain("collection(db, 'teams', cleanTeamId, 'emailSends')");
    });

    it('checks manager access before attachment and draft operations', () => {
        const source = readRepoFile('js/team-email-attachments.js');

        expect(source).toContain('async function assertTeamEmailManagerAccess(teamId, user = auth.currentUser)');
        expect(source).toContain('await assertTeamEmailManagerAccess(teamId, user)');
        expect(source).toContain('await assertTeamEmailManagerAccess(teamId)');
        expect(source).toContain("console.error('Error uploading team email attachment:', error);");
        expect(source).toContain("console.error('Error deleting team email attachment:', error);");
        expect(source).toContain('isTeamEmailAttachmentPathForTeam(teamId, path)');
    });

    it('validates same-team attachment references in the callable delivery path', () => {
        const source = readRepoFile('functions/index.js');

        expect(source).toContain('exports.sendTeamEmail = functions.https.onCall');
        expect(source).not.toContain('exports.queueTeamEmailDelivery');
        expect(source).not.toContain("document('teams/{teamId}/emailSends/{sendId}')");
        expect(source).toContain('findUnknownTeamEmailRecipientIds({ recipientIds, players })');
        expect(source.indexOf('findUnknownTeamEmailRecipientIds({ recipientIds, players })'))
            .toBeLessThan(source.indexOf('const recipients = resolveTeamEmailRecipients'));
        expect(source).toContain('Team email is limited to 400 eligible recipients.');
        expect(source).toContain('normalizeTeamEmailAttachmentsForDelivery(teamId, requestedAttachments)');
        expect(source).toContain('attachments: attachmentSummary.attachments');
        expect(source).toContain('attachmentTotalBytes: attachmentSummary.totalBytes');
        expect(source).toContain('function isTeamEmailAttachmentPathForTeam(teamId, storagePath)');
        expect(source).toContain('TEAM_EMAIL_ATTACHMENT_LIMIT_COUNT = 10');

        const coreSource = readRepoFile('functions/team-email-core.cjs');
        expect(coreSource).toContain("type: 'team_email'");
    });

    it('limits draft/send docs and attachment files to team coaches and admins', () => {
        const firestoreRules = readRepoFile('firestore.rules');
        const storageRules = readRepoFile('storage.rules');

        expect(firestoreRules).toContain('match /emailDrafts/{draftId}');
        expect(firestoreRules).toContain('match /emailSends/{sendId}');
        expect(firestoreRules).toContain("'authorName', 'status', 'createdAt', 'updatedAt', 'attachments', 'attachmentTotalBytes'");
        expect(firestoreRules).toContain("request.resource.data.attachments is list");
        expect(firestoreRules).toContain("request.resource.data.attachmentTotalBytes is number");
        expect(firestoreRules).toContain('allow create, update, delete: if false;');
        expect(storageRules).toContain('match /team-email-attachments/{teamId}/{draftId}/{userId}/{fileName}');
        expect(storageRules).toContain('allow get: if isTeamOwnerOrAdmin(teamId);');
        expect(storageRules).toContain('request.resource.size <= 20 * 1024 * 1024');
    });
});
