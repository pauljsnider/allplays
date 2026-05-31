import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('admin officials directory modal', () => {
    it('wires the admin teams tab to manage team officials in a modal', () => {
        const adminHtml = fs.readFileSync('admin.html', 'utf8');
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminHtml).toContain('officials-admin-modal');
        expect(adminHtml).toContain('officials-admin-team-name');
        expect(adminHtml).toContain('officials-admin-list');
        expect(adminHtml).toContain('officials-admin-form');
        expect(adminHtml).toContain('officials-admin-name');
        expect(adminHtml).toContain('officials-admin-email');
        expect(adminHtml).toContain('officials-admin-phone');
        expect(adminHtml).toContain('officials-admin-roles');
        expect(adminHtml).toContain('officials-admin-tags');
        expect(adminHtml).toContain('Manage the saved officials directory used by edit-schedule.html for this team.');

        expect(adminJs).toContain('window.openOfficialsAdmin');
        expect(adminJs).toContain('window.closeOfficialsAdmin');
        expect(adminJs).toContain('window.startOfficialsAdminEdit');
        expect(adminJs).toContain('loadOfficialsForActiveTeam()');
        expect(adminJs).toContain('const officials = await getOfficials(teamId);');
        expect(adminJs).toContain('if (activeOfficialsTeam?.id !== teamId) return;');
        expect(adminJs).toContain('activeOfficials = officials;');
        expect(adminJs).toContain('await addOfficial(teamId, draft);');
        expect(adminJs).toContain('await updateOfficial(teamId, officialId, draft);');
        expect(adminJs).toContain('await deleteOfficial(activeOfficialsTeam.id, deleteId);');
        expect(adminJs).toContain('window.openOfficialsAdmin(${inlineJsString(team.id)})');
        expect(adminJs).toContain('No officials saved for this team yet.');
    });
});
