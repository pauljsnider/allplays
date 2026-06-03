import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('admin team deactivation access', () => {
    it('keeps team deactivation owner-only in the admin teams table', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminJs).toContain('function canCurrentUserDeactivateTeam(team) {');
        expect(adminJs).toContain('team.ownerId === currentUser.uid');
        expect(adminJs).toContain("team.ownerEmail.trim().toLowerCase() === currentUser.email.trim().toLowerCase()");
        expect(adminJs).toContain('>Owner only<');
        expect(adminJs).toContain('if (!canCurrentUserDeactivateTeam(team)) {');
        expect(adminJs).toContain('Team deactivation is only available to the team owner in the dashboard workflow.');
    });
});
