import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('player profile edit access wiring', () => {
    it('reuses full team access rules instead of granting edit access from coachOf alone', () => {
        const html = readRepoFile('player.html');

        expect(html).toContain("import { hasFullTeamAccess } from './js/team-access.js';");
        expect(html).toContain('const hasFullAccess = hasFullTeamAccess(currentUser, currentTeam);');
        expect(html).toContain('const canEdit = hasFullAccess || isParent;');
        expect(html).not.toContain('const isCoachForTeam = Array.isArray(currentUser.coachOf) && currentUser.coachOf.includes(currentTeamId);');
        expect(html).not.toContain('const canEdit = currentUser.isAdmin || isParent || isCoachForTeam;');
    });
});
