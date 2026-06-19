import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('team email draft composer', () => {
    it('pins the fresh db cache-busting version for team chat draft helpers', () => {
        const html = readRepoFile('team-chat.html');

        expect(html).toContain("from './js/db.js?v=52';");
    });

    it('wires coach/admin email drafts into team chat', () => {
        const html = readRepoFile('team-chat.html');

        expect(html).toContain('id="email-drafts-btn"');
        expect(html).toContain('getTeamEmailDrafts');
        expect(html).toContain('saveTeamEmailDraft');
        expect(html).toContain('openEmailDraftModal');
    });

    it('wires reusable email templates into the composer and draft modal', () => {
        const html = readRepoFile('team-chat.html');

        expect(html).toContain('id="email-template-picker"');
        expect(html).toContain('id="email-draft-template-picker"');
        expect(html).toContain('getTeamEmailTemplates');
        expect(html).toContain('saveTeamEmailTemplate');
        expect(html).toContain('deleteTeamEmailTemplate');
        expect(html).toContain('Templates prefill subject and body only. They do not change recipients or send email.');
        expect(html).toContain('Template applied. Recipients were not changed.');
    });

    it('filters the recipient picker to usable email-enabled roster contacts', () => {
        const html = readRepoFile('team-chat.html');

        expect(html).toContain('function buildEligibleEmailRecipientsFromPlayers');
        expect(html).toContain('isUsableEmail(email)');
        expect(html).toContain('isEmailMessagingEnabled(contact)');
        expect(html).toContain('No roster contacts have usable email addresses with email messaging enabled.');
    });

    it('requires recipients, subject, and body before saving', () => {
        const html = readRepoFile('team-chat.html');
        const db = readRepoFile('js/db.js');

        expect(html).toContain('Choose at least one recipient, a subject, and a body before saving.');
        expect(html).toContain('saveBtn.disabled = selectedEmailRecipientKeys.size === 0 || !hasSubject || !hasBody;');
        expect(db).toContain("if (recipientIds.length === 0) throw new Error('Choose at least one recipient before saving.');");
        expect(db).toContain("if (!subject) throw new Error('Enter a subject before saving.');");
        expect(db).toContain("if (!body) throw new Error('Enter a body before saving.');");
    });

    it('stores drafts under the team and restricts rules to team managers', () => {
        const db = readRepoFile('js/db.js');
        const rules = readRepoFile('firestore.rules');

        expect(db).toContain("collection(db, 'teams', teamId, 'emailDrafts')");
        expect(rules).toContain('match /emailDrafts/{draftId}');
        expect(rules).toContain('allow read: if isTeamOwnerOrAdmin(teamId);');
        expect(rules).toContain('allow create, update: if isTeamOwnerOrAdmin(teamId)');
    });

    it('stores reusable templates under the team and restricts rules to team managers', () => {
        const db = readRepoFile('js/db.js');
        const rules = readRepoFile('firestore.rules');

        expect(db).toContain("collection(db, 'teams', teamId, 'emailTemplates')");
        expect(db).toContain("if (!name) throw new Error('Enter a template name before saving.');");
        expect(db).toContain('export async function deleteTeamEmailTemplate');
        expect(rules).toContain('match /emailTemplates/{templateId}');
        expect(rules).toContain("request.resource.data.keys().hasAll(['name', 'subject', 'body', 'updatedAt'])");
        expect(rules).toContain("request.resource.data.keys().hasOnly([");
    });
});
