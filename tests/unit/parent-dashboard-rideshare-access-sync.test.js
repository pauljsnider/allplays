import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('parent dashboard rideshare access sync', () => {
    it('ensures team access is synchronized before saving a ride offer', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toMatch(/async\s+function\s+submitRideOfferFromForm\(teamId,\s*gameId,\s*legacyGameId,\s*eventKey\)\s*\{[\s\S]*await\s+ensureParentTeamAccess\(currentUserId,\s*\[teamId\],\s*\{\s*strict:\s*true\s*\}\);[\s\S]*await\s+createRideOffer\(teamId,\s*gameId,\s*\{[\s\S]*\},\s*\{\s*fallbackGameIds:\s*legacyGameId\s*\?\s*\[legacyGameId\]\s*:\s*\[\]\s*\}\);/);
    });

    it('preserves legacy rideshare ids when refreshing recurring calendar events', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toMatch(/function\s+getLegacyRideEventId\(event\)\s*\{[\s\S]*event\?\.calendarEventUid[\s\S]*legacyEventId === eventId[\s\S]*return legacyEventId;/);
        expect(html).toMatch(/async\s+function\s+refreshRideshareForEvent\(teamId,\s*gameId,\s*legacyGameId\s*=\s*''\)\s*\{[\s\S]*await\s+listRideOffersForEvent\(teamId,\s*gameId,\s*\{\s*fallbackGameIds:\s*legacyGameId\s*\?\s*\[legacyGameId\]\s*:\s*\[\],[\s\S]*requesterUserId:\s*currentUserId,[\s\S]*childIds:\s*resolveChildChoices\(teamId\)\.map\(\(child\)\s*=>\s*child\.childId\),[\s\S]*canManageTeamRequests:/);
    });

    it('passes only deterministic household request scope while retaining manager request lists', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toContain('requesterUserId: currentUserId');
        expect(html).toContain('childIds: resolveChildChoices(teamId).map((child) => child.childId)');
        expect(html).toContain('canManageTeamRequests: currentUser?.isAdmin === true || matchingEvents.some((event) => event.isTeamAdmin === true)');
        expect(html).toContain("offer.driverUserId === currentUserId || event.isTeamAdmin === true || currentUser?.isAdmin === true");
    });

    it('supports strict mode so access sync errors can be propagated', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toMatch(/async\s+function\s+ensureParentTeamAccess\(userId,\s*teamIds,\s*options\s*=\s*\{\}\)/);
        expect(html).toMatch(/if\s*\(strict\)\s*\{\s*throw\s+err;\s*\}/);
    });
});
