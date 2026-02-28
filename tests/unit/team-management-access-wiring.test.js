import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('team management page access wiring', () => {
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
});
