import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function getRequireSyncedAuth() {
    const html = readRepoFile('dashboard.html');
    const match = html.match(/function requireSyncedAuth\(\) \{[\s\S]*?\n        \}\n\n        async function init/);
    if (!match) throw new Error('requireSyncedAuth not found');
    return match[0].replace(/\n\n        async function init$/, '');
}

function runRequireSyncedAuth(checkAuth, windowObject = { location: { href: '' } }) {
    const source = `${getRequireSyncedAuth()}; return requireSyncedAuth();`;
    return new Function('checkAuth', 'window', source)(checkAuth, windowObject);
}

describe('dashboard parent membership sync', () => {
    const html = readRepoFile('dashboard.html');

    it('uses the rich auth path before loading parent-linked teams', () => {
        expect(html).toContain("import { getTeams, getUserTeamsWithAccess, getParentTeams, deleteTeam, getUserProfile, getUnreadChatCounts } from './js/db.js?v=58';");
        expect(html).toContain("import { checkAuth } from './js/auth.js?v=29';");
        expect(html).toContain('function requireSyncedAuth()');
        expect(html).toContain('const user = await requireSyncedAuth();');
        expect(html).toContain('getParentTeams(user.uid)');
        expect(html).not.toContain('requireAuth as authRequireAuth');
    });

    it('unsubscribes when checkAuth invokes the user callback synchronously', async () => {
        const user = { uid: 'parent-1' };
        const unsubscribe = vi.fn();
        const checkAuth = vi.fn((callback) => {
            callback(user);
            return unsubscribe;
        });

        await expect(runRequireSyncedAuth(checkAuth)).resolves.toBe(user);

        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes and redirects when checkAuth synchronously reports no user', async () => {
        const unsubscribe = vi.fn();
        const windowObject = { location: { href: '' } };
        const checkAuth = vi.fn((callback) => {
            callback(null);
            return unsubscribe;
        });

        await expect(runRequireSyncedAuth(checkAuth, windowObject)).rejects.toBe('Not authenticated');

        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(windowObject.location.href).toBe('login.html');
    });

    it('ignores duplicate auth emissions after settling', async () => {
        const user = { uid: 'parent-1' };
        const unsubscribe = vi.fn();
        const checkAuth = vi.fn((callback) => {
            callback(user);
            callback({ uid: 'parent-2' });
            return unsubscribe;
        });

        await expect(runRequireSyncedAuth(checkAuth)).resolves.toBe(user);

        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('separates full-access teams from parent-only teams using distinct maps', () => {
        expect(html).toContain('fullAccessMap');
        expect(html).toContain('parentOnlyTeams');
        expect(html).toContain('fullAccessTeams');
    });

    it('does not merge parent-only teams into the primary full-access grid', () => {
        expect(html).toContain('full-access-teams-grid');
        expect(html).toContain('fullAccessTeams.map(team => renderTeamCard');
    });

    it('renders parent-only teams in a separate collapsed section for mixed-role users', () => {
        expect(html).toContain('parent-teams-section');
        expect(html).toContain('parent-teams-collapsible');
        expect(html).toContain('parent-teams-toggle');
        expect(html).toContain('parentOnlyTeams.map(team => renderTeamCard');
    });

    it('labels the collapsed parent section with "Parent view only"', () => {
        expect(html).toContain('Parent view only (${parentOnlyTeams.length})');
    });

    it('shows a parent-only notice and guidance for users with no full-access teams', () => {
        expect(html).toContain('parent-only-notice');
        expect(html).toContain('Parent view only');
        expect(html).toContain('parent-dashboard.html');
        expect(html).toContain('Parent Dashboard');
    });

    it('swaps the management-first header actions for a parent-dashboard CTA in the parent-only case', () => {
        expect(html).toContain('my-teams-subtitle');
        expect(html).toContain('create-team-cta');
        expect(html).toContain('parent-dashboard-cta');
        expect(html).toContain("subtitle.textContent = 'Parent-linked teams stay read-only here. Use Parent Dashboard for family tasks and quick team access.';");
        expect(html).toContain("createTeamCta?.classList.add('hidden');");
        expect(html).toContain("parentDashboardCta?.classList.remove('hidden');");
    });

    it('handles the parent-only case with a dedicated notice block before the parent teams grid', () => {
        expect(html).toContain('parent-only-teams-grid');
        expect(html).toContain('fullAccessTeams.length === 0 && parentOnlyTeams.length > 0');
    });

    it('deduplicates teams accessible as both coach and parent into the full-access list', () => {
        expect(html).toContain('if (fullAccessMap.has(t.id)) return;');
    });

    it('collapses the parent section by default via hidden class', () => {
        expect(html).toContain('"hidden mt-4 space-y-6"');
    });

    it('toggles aria-expanded on the parent section button', () => {
        expect(html).toContain('aria-expanded');
        expect(html).toContain("toggle.setAttribute('aria-expanded'");
    });
});
