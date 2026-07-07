import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function collectVersionedSourceFiles(dir, root = dir) {
    const ignoredDirs = new Set(['.git', 'coverage', 'dist', 'docs', 'node_modules', 'spec', 'tests']);
    const files = [];

    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const relativePath = path.slice(root.length + 1);
        const stat = statSync(path);

        if (stat.isDirectory()) {
            if (!ignoredDirs.has(entry)) {
                files.push(...collectVersionedSourceFiles(path, root));
            }
            continue;
        }

        if (/\.(html|js|mjs)$/.test(entry)) {
            files.push(relativePath);
        }
    }

    return files;
}

describe('admin invite signup cache busting', () => {
    it('pins fresh module versions for the admin invite signup path', () => {
        const authSource = readFileSync(resolve(process.cwd(), 'js/auth.js'), 'utf8');

        expect(authSource).toContain("import { executeEmailPasswordSignup } from './signup-flow.js?v=6';");
        expect(authSource).toContain("import { redeemAdminInviteAcceptance } from './admin-invite.js?v=6';");
        expect(authSource).toContain("from './db.js?v=81';");
    });

    it('pins fresh invite acceptance module versions for admin invite redemption', () => {
        const acceptInviteSource = readFileSync(resolve(process.cwd(), 'accept-invite.html'), 'utf8');

        expect(acceptInviteSource).toContain(
            "import { validateAccessCode, redeemParentInvite, redeemHouseholdInvite, redeemCoParentInvite, updateUserProfile, updateTeam, getTeam, getUserProfile, markAccessCodeAsUsed } from './js/db.js?v=81';"
        );
        expect(acceptInviteSource).toContain(
            "import { redeemAdminInviteAtomically } from './js/admin-invite.js?v=6';"
        );
        expect(acceptInviteSource).toContain(
            "import { createInviteProcessor, getInviteDashboardUrl, isInviteAlreadyRedeemedError } from './js/accept-invite-flow.js?v=8';"
        );
    });

    it('bumps auth module consumers after signup flow changes', () => {
        const authConsumers = {
            'login.html': 'auth.js?v=42',
            'accept-invite.html': 'auth.js?v=42',
            'edit-team.html': 'auth.js?v=42',
            'js/admin.js': 'auth.js?v=42',
            'js/live-game.js': 'auth.js?v=42',
            'js/live-tracker.js': 'auth.js?v=42',
            'js/track-basketball.js': 'auth.js?v=42'
        };

        for (const [relativePath, expectedVersion] of Object.entries(authConsumers)) {
            const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
            expect(source).toContain(expectedVersion);
        }

        const editTeamSource = readFileSync(resolve(process.cwd(), 'edit-team.html'), 'utf8');
        expect(editTeamSource).toContain("import { checkAuth, sendInviteEmail } from './js/auth.js?v=42';");
        expect(editTeamSource).not.toContain("import { checkAuth, sendInviteEmail } from './js/auth.js?v=39';");
    });

    it('bumps the shared header logout import with auth.js consumers', () => {
        const utilsSource = readFileSync(resolve(process.cwd(), 'js/utils.js'), 'utf8');
        const logoutImportMatches = utilsSource.match(/const \{ logout \} = await import\('\.\/auth\.js\?v=40'\);/g) || [];

        expect(logoutImportMatches).toHaveLength(1);
        expect(utilsSource).not.toContain("const { logout } = await import('./auth.js?v=24');");
        expect(utilsSource).not.toContain("const { logout } = await import('./auth.js?v=40');");
    });

    it('does not leave deployed source consumers pinned to stale auth or db wrappers', () => {
        const staleConsumers = collectVersionedSourceFiles(process.cwd()).flatMap((relativePath) => {
            const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
            const staleImports = source.match(/\b(?:auth\.js\?v=(?:22|38|39)|db\.js\?v=(?:76|77|78))\b/g) || [];
            return staleImports.map((importPath) => `${relativePath}: ${importPath}`);
        });

        expect(staleConsumers).toEqual([]);
    });
});
