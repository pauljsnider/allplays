import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('co-parent invite workflow regression', () => {
    it('surfaces a shareable co-parent invite link on the parent dashboard', () => {
        const dashboardSource = readFileSync(resolve(process.cwd(), 'parent-dashboard.html'), 'utf8');

        expect(dashboardSource).toContain('const invite = await inviteCoParentToAthlete');
        expect(dashboardSource).toContain("buildLegacyJoinUrl(inviteCode, 'coparent'");
        expect(dashboardSource).toContain('Co-parent invite created and queued');
        expect(dashboardSource).not.toContain("await inviteCoParentToAthlete(currentUserId, teamId, playerId, coParentEmail, playerName);\n\n                if (statusEl) {\n                    statusEl.textContent = 'Invitation sent successfully!';");
    });

    it('wires co-parent invite redemption through the accept-invite page', () => {
        const acceptInviteSource = readFileSync(resolve(process.cwd(), 'accept-invite.html'), 'utf8');

        expect(acceptInviteSource).toContain('redeemCoParentInvite');
        expect(acceptInviteSource).toContain("./js/db.js?v=91");
        expect(acceptInviteSource).toContain("./js/accept-invite-flow.js?v=9");
    });

    it('routes co-parent membership grants through a callable instead of browser membership writes', () => {
        const dbSource = readFileSync(resolve(process.cwd(), 'js/db.js'), 'utf8');
        const handlerIndex = dbSource.indexOf('export async function redeemCoParentInvite');
        expect(handlerIndex).toBeGreaterThanOrEqual(0);

        const handlerSource = dbSource.slice(handlerIndex, handlerIndex + 1400);
        expect(handlerSource).toContain("httpsCallable(functions, 'redeemCoParentInvite')");
        expect(handlerSource).toContain('await syncPublicUserProfile(userId);');
        expect(handlerSource).not.toContain('parentOf: arrayUnion');
        expect(handlerSource).not.toContain('parentTeamIds: arrayUnion');
        expect(handlerSource).not.toContain('parentPlayerKeys: arrayUnion');
    });

    it('privileged callable links the co-parent, private profile, and invite atomically', () => {
        const functionsSource = readFileSync(resolve(process.cwd(), 'functions/index.js'), 'utf8');
        const handlerIndex = functionsSource.indexOf('exports.redeemCoParentInvite');
        expect(handlerIndex).toBeGreaterThanOrEqual(0);

        const handlerSource = functionsSource.slice(handlerIndex, handlerIndex + 5200);
        expect(handlerSource).toContain('firestore.runTransaction(async (transaction) =>');
        expect(handlerSource).toContain("codeData.type !== 'coparent_invite'");
        expect(handlerSource).toContain('userId !== context.auth.uid');
        expect(handlerSource).toContain('parentOf: appendUniqueParentLink');
        expect(handlerSource).toContain('parentTeamIds: appendUniqueValue');
        expect(handlerSource).toContain('parentPlayerKeys: appendUniqueValue');
        expect(handlerSource).toContain('admin.firestore.FieldValue.arrayUnion');
        expect(handlerSource).toContain("status: 'accepted'");
    });
});
