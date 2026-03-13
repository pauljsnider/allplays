import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('parent membership request wiring', () => {
    it('adds self-serve request access controls to the parent dashboard', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toContain('Request Team Access');
        expect(html).toContain('request-team-select');
        expect(html).toContain('request-player-select');
        expect(html).toContain('submit-parent-access-request-btn');
        expect(html).toContain('createParentMembershipRequest');
        expect(html).toContain('listMyParentMembershipRequests');
        expect(html).toContain('Failed to load parent membership requests');
        expect(html).toContain('Unable to load your access requests right now.');
    });

    it('adds roster approval controls for pending parent membership requests', () => {
        const html = readRepoFile('edit-roster.html');

        expect(html).toContain('Pending Access Requests');
        expect(html).toContain('approve-parent-request-btn');
        expect(html).toContain('deny-parent-request-btn');
        expect(html).toContain('listTeamParentMembershipRequests');
        expect(html).toContain('approveParentMembershipRequest');
        expect(html).toContain('denyParentMembershipRequest');
    });

    it('protects membership request writes in firestore rules', () => {
        const rules = readRepoFile('firestore.rules');

        expect(rules).toContain('match /membershipRequests/{requestId}');
        expect(rules).toContain('match /{path=**}/membershipRequests/{requestId}');
        expect(rules).toContain("request.resource.data.status == 'pending'");
        expect(rules).toContain("request.resource.data.requesterUserId == request.auth.uid");
        expect(rules).toContain("request.resource.data.status in ['approved', 'denied']");
        expect(rules).toContain('isTeamOwnerOrAdmin(teamId)');
    });
});
