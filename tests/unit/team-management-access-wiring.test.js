import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('team management page access wiring', () => {
    it('prefers auth email before profile fallback when loading dashboard team access', () => {
        const html = readRepoFile('dashboard.html');
        expect(html).toContain('getUserTeamsWithAccess(user.uid, user.email || profile?.email)');
    });

    it('uses shared full-access helper in edit roster page', () => {
        const html = readRepoFile('edit-roster.html');
        expect(html).toContain("from './js/team-access.js'");
        expect(html).toContain('hasFullTeamAccess(');
    });

    it('uses shared full-access helper in edit team page', () => {
        const html = readRepoFile('edit-team.html');
        expect(html).toContain("from './js/team-access.js'");
        expect(html).toContain('hasFullTeamAccess(');
    });

    it('guards edit mode when team id resolves to no team', () => {
        const html = readRepoFile('edit-team.html');
        expect(html).toContain('if (!team)');
        expect(html).toContain('window.location.href = \'dashboard.html\'');
        expect(html).toContain('Team not found or no longer active');
    });

    it('uses shared full-access helper in edit config page', () => {
        const html = readRepoFile('edit-config.html');
        expect(html).toContain("from './js/edit-config-access.js'");
        expect(html).toContain('getEditConfigAccessDecision(');
    });
});
