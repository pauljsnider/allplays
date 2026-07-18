import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function collectVersionedSourceFiles(dir, root = dir) {
    const ignoredDirs = new Set(['.claude', '.git', '_temp', 'coverage', 'dist', 'docs', 'node_modules', 'spec', 'tests']);
    const files = [];

    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const relativePath = path.slice(root.length + 1);
        const stat = statSync(path);

        if (relativePath === 'apps/app/bundle-visualizer.html') {
            continue;
        }

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

        expect(authSource).toContain("import { executeEmailPasswordSignup } from './signup-flow.js?v=9';");
        expect(authSource).not.toContain("./signup-flow.js?v=7");
        expect(authSource).toContain("import { redeemAdminInviteAcceptance, redeemAdminInviteAtomically } from './admin-invite.js?v=6';");
        expect(authSource).toContain("from './db.js?v=102';");
        expect(authSource).not.toContain("from './db.js?v=93';");
        expect(authSource).toContain("from './accept-invite-flow.js?v=11';");
    });

    it('pins fresh invite acceptance module versions for admin invite redemption', () => {
        const acceptInviteSource = readFileSync(resolve(process.cwd(), 'accept-invite.html'), 'utf8');

        expect(acceptInviteSource).toContain(
            "import { validateAccessCode, redeemParentInvite, redeemHouseholdInvite, redeemCoParentInvite, redeemFriendInvite, updateUserProfile, updateTeam, getTeam, getUserProfile, markAccessCodeAsUsed } from './js/db.js?v=102';"
        );
        expect(acceptInviteSource).toContain(
            "import { redeemAdminInviteAtomically } from './js/admin-invite.js?v=6';"
        );
        expect(acceptInviteSource).toContain(
            "import { createInviteProcessor, getInviteDashboardUrl, isInviteAlreadyRedeemedError } from './js/accept-invite-flow.js?v=11';"
        );
    });

    it('bumps auth module consumers after signup flow changes', () => {
        const authConsumers = {
            'login.html': 'auth.js?v=51',
            'accept-invite.html': 'auth.js?v=51',
            'edit-team.html': 'auth.js?v=51',
            'js/admin.js': 'auth.js?v=51',
            'js/live-game.js': 'auth.js?v=51',
            'js/live-tracker.js': 'auth.js?v=51',
            'js/track-basketball.js': 'auth.js?v=51'
        };

        for (const [relativePath, expectedVersion] of Object.entries(authConsumers)) {
            const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
            expect(source).toContain(expectedVersion);
        }

        const editTeamSource = readFileSync(resolve(process.cwd(), 'edit-team.html'), 'utf8');
        expect(editTeamSource).toContain("import { checkAuth, sendInviteEmail } from './js/auth.js?v=51';");
        expect(editTeamSource).not.toContain("import { checkAuth, sendInviteEmail } from './js/auth.js?v=40';");
    });

    it('bumps the shared header logout import with auth.js consumers', () => {
        const utilsSource = readFileSync(resolve(process.cwd(), 'js/utils.js'), 'utf8');
        const logoutImportMatches = utilsSource.match(/const \{ logout \} = await import\('\.\/auth\.js\?v=51'\);/g) || [];

        expect(logoutImportMatches).toHaveLength(1);
        expect(utilsSource).not.toContain("const { logout } = await import('./auth.js?v=25');");
        expect(utilsSource).not.toContain("const { logout } = await import('./auth.js?v=41');");
    });

    it('pins every deployed auth consumer to v51 without stale auth or db wrappers', () => {
        const deployedSources = collectVersionedSourceFiles(process.cwd());
        const authConsumers = deployedSources.flatMap((relativePath) => {
            const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
            const authImports = source.match(/(?<![\w-])auth\.js\?v=\d+\b/g) || [];
            return authImports.map((importPath) => `${relativePath}: ${importPath}`);
        });
        const staleConsumers = deployedSources.flatMap((relativePath) => {
            const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
            const staleImports = source.match(/(?:(?<![\w-])auth\.js\?v=(?!51\b)\d+|(?<![\w-])utils\.js\?v=(?!15\b)\d+|db\.js\?v=(?:76|77|78))\b/g) || [];
            return staleImports.map((importPath) => `${relativePath}: ${importPath}`);
        });

        expect(authConsumers.length).toBeGreaterThan(50);
        expect(staleConsumers).toEqual([]);
    });
});
