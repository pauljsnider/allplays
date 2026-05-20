import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('admin invite signup cache busting', () => {
    function expectAuthCacheTokenAtLeast(source, minVersion) {
        const match = source.match(/auth\.js\?v=(\d+)/);
        expect(match).not.toBeNull();
        expect(Number(match[1])).toBeGreaterThanOrEqual(minVersion);
    }

    it('pins fresh module versions for the admin invite signup path', () => {
        const authSource = readFileSync(resolve(process.cwd(), 'js/auth.js'), 'utf8');

        expect(authSource).toContain("import { executeEmailPasswordSignup } from './signup-flow.js?v=3';");
        expect(authSource).toContain("import { redeemAdminInviteAcceptance } from './admin-invite.js?v=4';");
        expect(authSource).toContain("from './db.js?v=31';");
    });

    it('pins fresh invite acceptance module versions for admin invite redemption', () => {
        const acceptInviteSource = readFileSync(resolve(process.cwd(), 'accept-invite.html'), 'utf8');

        expect(acceptInviteSource).toContain(
            "import { validateAccessCode, redeemParentInvite, redeemHouseholdInvite, redeemAdminInviteAtomically, updateUserProfile, updateTeam, getTeam, getUserProfile, markAccessCodeAsUsed } from './js/db.js?v=49';"
        );
        expect(acceptInviteSource).toContain(
            "import { createInviteProcessor } from './js/accept-invite-flow.js?v=5';"
        );
    });

    it('bumps auth module consumers after signup flow changes', () => {
        const authConsumers = [
            'login.html',
            'accept-invite.html',
            'edit-team.html',
            'js/admin.js',
            'js/live-game.js',
            'js/live-tracker.js',
            'js/track-basketball.js',
            'js/utils.js'
        ];

        for (const relativePath of authConsumers) {
            const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
            expectAuthCacheTokenAtLeast(source, 15);
        }
    });
});
