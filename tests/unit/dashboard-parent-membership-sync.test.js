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
    it('uses the rich auth path before loading parent-linked teams', () => {
        const html = readRepoFile('dashboard.html');

        expect(html).toContain("import { getTeams, getUserTeamsWithAccess, getParentTeams, deleteTeam, getUserProfile, getUnreadChatCounts } from './js/db.js?v=49';");
        expect(html).toContain("import { checkAuth } from './js/auth.js?v=23';");
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
});
