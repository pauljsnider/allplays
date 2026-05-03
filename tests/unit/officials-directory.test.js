import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readSource(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('officials directory workflow', () => {
    it('adds officials persistence helpers on the team officials subcollection', () => {
        const source = readSource('js/db.js');

        expect(source).toContain('export function normalizeOfficialDraft');
        expect(source).toContain('export async function getOfficials(teamId)');
        expect(source).toContain('collection(db, `teams/${teamId}/officials`)');
        expect(source).toContain('export async function addOfficial(teamId, officialData)');
        expect(source).toContain('export async function updateOfficial(teamId, officialId, officialData)');
        expect(source).toContain('export async function deleteOfficial(teamId, officialId)');
        expect(source).toContain("throw new Error('Official email or phone is required')");
        expect(source).toContain("throw new Error('At least one officiating role is required')");
    });

    it('wires the edit schedule admin UI separately from game assignments', () => {
        const source = readSource('edit-schedule.html');

        expect(source).toContain('id="tab-officials"');
        expect(source).toContain('id="content-officials"');
        expect(source).toContain('Officials Directory');
        expect(source).toContain('This directory is separate from team members, parents, coaches, and the generic game assignments list.');
        expect(source).toContain('loadOfficialsDirectory();');
        expect(source).toContain('await addOfficial(currentTeamId, draft);');
        expect(source).toContain('await updateOfficial(currentTeamId, officialId, draft);');
        expect(source).toContain('await deleteOfficial(currentTeamId, deleteId);');
    });

    it('limits officials directory access to team owners and admins', () => {
        const rules = readSource('firestore.rules');

        expect(rules).toContain('match /officials/{officialId}');
        expect(rules).toContain('allow read: if isTeamOwnerOrAdmin(teamId);');
        expect(rules).toContain('allow create, update, delete: if isTeamOwnerOrAdmin(teamId);');
    });

    it('documents how officials differ from team members and assignments', () => {
        const help = readSource('help-team-operations.html');

        expect(help).toContain('Maintain an officials directory');
        expect(help).toContain('Officials are separate from roster members, parents, coaches, and generic game assignments.');
    });
});
