import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('parent dashboard rideshare access sync', () => {
    it('ensures team access is synchronized before saving a ride offer', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toMatch(/async\s+function\s+submitRideOfferFromForm\(teamId,\s*gameId,\s*eventKey\)\s*\{[\s\S]*await\s+ensureParentTeamAccess\(currentUserId,\s*\[teamId\],\s*\{\s*strict:\s*true\s*\}\);[\s\S]*await\s+createRideOffer\(/);
    });

    it('supports strict mode so access sync errors can be propagated', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toMatch(/async\s+function\s+ensureParentTeamAccess\(userId,\s*teamIds,\s*options\s*=\s*\{\}\)/);
        expect(html).toMatch(/if\s*\(strict\)\s*\{\s*throw\s+err;\s*\}/);
    });
});
