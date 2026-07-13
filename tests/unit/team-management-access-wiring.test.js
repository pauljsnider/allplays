import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('team management page access wiring', () => {
    it('loads all active teams for platform admins on the dashboard', () => {
        const html = readRepoFile('dashboard.html');
        expect(html).toContain('import { getTeams, getUserTeamsWithAccess');
        expect(html).toContain('const canManageAllTeams = user.isAdmin === true;');
        expect(html).toContain('canManageAllTeams\n                        ? getTeams({ includePrivate: true })\n                        : getUserTeamsWithAccess(user.uid, user.email || profile?.email)');
    });

    it('backs dashboard platform-admin access with protected Firestore admin state', () => {
        const rules = readRepoFile('firestore.rules');
        expect(rules).toContain('function isGlobalAdmin()');
        expect(rules).toContain('function isOwnerUserCreatePayloadValid(data)');
        expect(rules).toContain('function isOwnerUserUpdatePayloadValid()');
        expect(rules).toContain("data.get('isPlatformAdmin', false) != true");
        expect(rules).toContain("affectedKeys().hasAny(['isAdmin', 'isPlatformAdmin'])");
        expect(rules).toContain("(isOwner(userId) && isOwnerUserCreatePayloadValid(request.resource.data))");
        expect(rules).toContain("(isOwner(userId) && isOwnerUserUpdatePayloadValid())");
        expect(rules).toContain("(isOwner(userId) && resource.data.get('isAdmin', false) != true)");
        expect(rules).toContain('canReadTeamDocument(resource.data)');
    });

    it('prefers auth email before profile fallback when loading non-admin dashboard team access', () => {
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
        expect(html).toContain("from './js/team-access.js?v=4'");
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
        expect(html).toContain("from './js/edit-config-access.js?v=2'");
        expect(html).toContain('getEditConfigAccessDecision(');
    });
});
