import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('admin team deactivation access', () => {
    it('keeps team deactivation owner-only in the admin teams table', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminJs).toContain('function canCurrentUserDeactivateTeam(team) {');
        expect(adminJs).toContain("const ownerId = String(team.ownerId || '').trim();");
        expect(adminJs).toContain('ownerId === currentUser.uid');
        expect(adminJs).toContain('ownerEmails.length === 1 && currentUser.email');
        expect(adminJs).toContain("ownerEmails[0] === currentUser.email.trim().toLowerCase()");
        expect(adminJs).toContain('>Owner only<');
        expect(adminJs).toContain('if (!canCurrentUserDeactivateTeam(team)) {');
        expect(adminJs).toContain('Team deactivation is only available to the team owner in the dashboard workflow.');
    });
});
