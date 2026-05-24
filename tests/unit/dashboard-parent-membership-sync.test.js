import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('dashboard parent membership sync', () => {
    it('uses the rich auth path before loading parent-linked teams', () => {
        const html = readRepoFile('dashboard.html');

        expect(html).toContain("import { checkAuth } from './js/auth.js?v=15';");
        expect(html).toContain('function requireSyncedAuth()');
        expect(html).toContain('const user = await requireSyncedAuth();');
        expect(html).toContain('getParentTeams(user.uid)');
        expect(html).not.toContain('requireAuth as authRequireAuth');
    });
});
