import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

describe('team media page wiring', () => {
    it('links the dashboard to the team media library', () => {
        const dashboard = fs.readFileSync(path.join(repoRoot, 'dashboard.html'), 'utf8');
        expect(dashboard).toContain('team-media.html#teamId=${team.id}');
    });

    it('loads the team media module and cache-busted db dependency', () => {
        const page = fs.readFileSync(path.join(repoRoot, 'team-media.html'), 'utf8');
        const source = fs.readFileSync(path.join(repoRoot, 'js/team-media.js'), 'utf8');

        expect(page).toContain('src="js/team-media.js?v=1"');
        expect(source).toContain("from './db.js?v=12'");
        expect(source).toContain("import { checkAuth } from './auth.js?v=13';");
        expect(source).toContain('checkAuth(async (user) => {');
        expect(source).toContain('team.html#teamId=${encodeURIComponent(state.teamId)}');
    });

    it('keeps media reads member-scoped and writes admin-scoped', () => {
        const rules = fs.readFileSync(path.join(repoRoot, 'firestore.rules'), 'utf8');
        expect(rules).toContain('match /mediaFolders/{folderId}');
        expect(rules).toContain('allow read: if canAccessTeamChat(teamId);');
        expect(rules).toContain('allow create, update, delete: if isTeamOwnerOrAdmin(teamId);');
    });
});
