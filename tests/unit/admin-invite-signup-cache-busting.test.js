import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('admin invite signup cache busting', () => {
    it('pins fresh module versions for the admin invite signup path', () => {
        const authSource = readFileSync(resolve(process.cwd(), 'js/auth.js'), 'utf8');

        expect(authSource).toContain("import { executeEmailPasswordSignup } from './signup-flow.js?v=5';");
        expect(authSource).toContain("import { redeemAdminInviteAcceptance } from './admin-invite.js?v=5';");
        expect(authSource).toContain("from './db.js?v=64';");
    });

    it('pins fresh invite acceptance module versions for admin invite redemption', () => {
        const acceptInviteSource = readFileSync(resolve(process.cwd(), 'accept-invite.html'), 'utf8');

        expect(acceptInviteSource).toContain(
            "import { validateAccessCode, redeemParentInvite, redeemHouseholdInvite, redeemAdminInviteAtomically, updateUserProfile, updateTeam, getTeam, getUserProfile, markAccessCodeAsUsed } from './js/db.js?v=64';"
        );
        expect(acceptInviteSource).toContain(
            "import { createInviteProcessor, getInviteDashboardUrl, isInviteAlreadyRedeemedError } from './js/accept-invite-flow.js?v=7';"
        );
    });

    it('bumps auth module consumers after signup flow changes', () => {
        const authConsumers = {
            'login.html': 'auth.js?v=33',
            'accept-invite.html': 'auth.js?v=33',
            'edit-team.html': 'auth.js?v=33',
            'js/admin.js': 'auth.js?v=33',
            'js/live-game.js': 'auth.js?v=33',
            'js/live-tracker.js': 'auth.js?v=33',
            'js/track-basketball.js': 'auth.js?v=33'
        };

        for (const [relativePath, expectedVersion] of Object.entries(authConsumers)) {
            const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
            expect(source).toContain(expectedVersion);
        }
    });

    it('keeps the shared header logout import pinned to auth.js v22', () => {
        const utilsSource = readFileSync(resolve(process.cwd(), 'js/utils.js'), 'utf8');
        const logoutImportMatches = utilsSource.match(/const \{ logout \} = await import\('\.\/auth\.js\?v=22'\);/g) || [];

        expect(logoutImportMatches).toHaveLength(1);
        expect(utilsSource).not.toContain("const { logout } = await import('./auth.js?v=33');");
        expect(utilsSource).not.toContain("const { logout } = await import('./auth.js?v=33');");
    });
});
