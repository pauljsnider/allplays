import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('team email attachments', () => {
    it('enforces the combined 20 MB limit before drafts or sends are persisted', () => {
        const source = readRepoFile('js/team-email-attachments.js');

        expect(source).toContain('TEAM_EMAIL_ATTACHMENT_LIMIT_BYTES = 20 * 1024 * 1024');
        expect(source).toContain('assertTeamEmailAttachmentLimit(normalized);');
        expect(source).toContain('Number.isFinite(size) && size > 0 ? size : 0');
        expect(source).toContain('attachmentTotalBytes: getTeamEmailAttachmentTotalBytes(attachments)');
        expect(source).toContain('saveTeamEmailDraft');
        expect(source).toContain('queueTeamEmailSend');
    });

    it('checks manager access before attachment draft and send operations', () => {
        const source = readRepoFile('js/team-email-attachments.js');

        expect(source).toContain('async function assertTeamEmailManagerAccess(teamId, user = auth.currentUser)');
        expect(source).toContain('await assertTeamEmailManagerAccess(teamId, user)');
        expect(source).toContain('await assertTeamEmailManagerAccess(teamId)');
        expect(source).toContain("console.error('Error uploading team email attachment:', error);");
        expect(source).toContain("console.error('Error deleting team email attachment:', error);");
        expect(source).toContain('isTeamEmailAttachmentPathForTeam(teamId, path)');
    });

    it('carries storage metadata into delivery jobs and sent history', () => {
        const source = readRepoFile('functions/index.js');

        expect(source).toContain("document('teams/{teamId}/emailSends/{sendId}')");
        expect(source).toContain("type: 'team_email'");
        expect(source).toContain('attachments,');
        expect(source).toContain('attachmentTotalBytes: totalBytes');
        expect(source).toContain('function isTeamEmailAttachmentPathForTeam(teamId, storagePath)');
        expect(source).toContain('buildTeamEmailMailDocId(teamId, sendId)');
        expect(source).toContain('mailJobId: mailRef.id');
    });

    it('limits draft/send docs and attachment files to team coaches and admins', () => {
        const firestoreRules = readRepoFile('firestore.rules');
        const storageRules = readRepoFile('storage.rules');

        expect(firestoreRules).toContain('match /emailDrafts/{draftId}');
        expect(firestoreRules).toContain('match /emailSends/{sendId}');
        expect(firestoreRules).toContain('allow read, create, update, delete: if isTeamOwnerOrAdmin(teamId);');
        expect(firestoreRules).toContain('request.resource.data.teamId == teamId');
        expect(firestoreRules).toContain('request.resource.data.createdBy == request.auth.uid');
        expect(storageRules).toContain('match /team-email-attachments/{teamId}/{draftId}/{userId}/{fileName}');
        expect(storageRules).toContain('allow get: if isTeamOwnerOrAdmin(teamId);');
        expect(storageRules).toContain('request.resource.size <= 20 * 1024 * 1024');
    });
});
