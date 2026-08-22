import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('team management page access wiring', () => {
    it('loads dashboard staff and parent teams through one bounded server-authoritative request', () => {
        const html = readRepoFile('dashboard.html');
        expect(html).toContain("import { loadDashboardTeams } from './js/dashboard-team-load.js?v=1';");
        expect(html).toContain('const { fullAccessTeams: coachTeams, parentTeams } = await loadDashboardTeams({');
        expect(html).toContain('includeAllTeams: user.isAdmin === true,');
        expect(html).toContain('timeoutMs: 10000');
        expect(html).not.toContain('getTeams({ includePrivate: true })');
        expect(html).not.toContain('getParentTeams(user.uid');
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
        expect(rules).toContain('canReadTeamDocument(teamId, resource.data)');
    });

    it('does not restore dashboard team access from a mutable profile email', () => {
        const html = readRepoFile('dashboard.html');
        expect(html).not.toContain('getUserTeamsWithAccess(');
        expect(html).not.toContain('getUserTeamsWithAccess(user.uid, user.email || profile?.email)');
    });

    it('uses only the authenticated email for calendar team discovery and admin checks', () => {
        const html = readRepoFile('calendar.html');
        expect(html).toContain('const email = user.email || null;');
        expect(html).toContain('getUserTeamsWithAccess(user.uid, email)');
        expect(html).not.toContain('const email = user.email || profile?.email;');
    });

    it('uses shared full-access helper in edit roster page', () => {
        const html = readRepoFile('edit-roster.html');
        expect(html).toContain("from './js/team-access.js?v=44338'");
        expect(html).toContain('hasFullTeamAccess(');
    });

    it('uses shared full-access helper in edit team page', () => {
        const html = readRepoFile('edit-team.html');
        expect(html).toContain("from './js/team-access.js?v=44338'");
        expect(html).toContain('hasFullTeamAccess(');
    });

    it('guards edit mode when team id resolves to no team', () => {
        const html = readRepoFile('edit-team.html');
        expect(html).toContain('if (!team)');
        expect(html).toContain('window.location.href = \'dashboard.html\'');
        expect(html).toContain('Team not found or no longer active');
    });

    it('loads inactive teams before applying edit access authorization', () => {
        const html = readRepoFile('edit-team.html');
        const loadTeamIndex = html.indexOf('getTeam(initialTeamId, { includeInactive: true })');
        const authorizeTeamIndex = html.indexOf('hasFullTeamAccess(currentUser, { ...team');

        expect(loadTeamIndex).toBeGreaterThan(-1);
        expect(authorizeTeamIndex).toBeGreaterThan(loadTeamIndex);
    });

    it('uses shared full-access helper in edit config page', () => {
        const html = readRepoFile('edit-config.html');
        expect(html).toContain("from './js/edit-config-access.js?v=44335'");
        expect(html).toContain('getEditConfigAccessDecision(');
    });
});
