import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('co-parent invite workflow regression', () => {
    it('surfaces a shareable co-parent invite link on the parent dashboard', () => {
        const dashboardSource = readFileSync(resolve(process.cwd(), 'parent-dashboard.html'), 'utf8');

        expect(dashboardSource).toContain('const invite = await inviteCoParentToAthlete');
        expect(dashboardSource).toContain('accept-invite.html?code=');
        expect(dashboardSource).toContain('type=coparent_invite');
        expect(dashboardSource).toContain('Co-parent invite created. Share this link');
        expect(dashboardSource).not.toContain("await inviteCoParentToAthlete(currentUserId, teamId, playerId, coParentEmail, playerName);\n\n                if (statusEl) {\n                    statusEl.textContent = 'Invitation sent successfully!';");
    });

    it('wires co-parent invite redemption through the accept-invite page', () => {
        const acceptInviteSource = readFileSync(resolve(process.cwd(), 'accept-invite.html'), 'utf8');

        expect(acceptInviteSource).toContain('redeemCoParentInvite');
        expect(acceptInviteSource).toContain("./js/db.js?v=77");
        expect(acceptInviteSource).toContain("./js/accept-invite-flow.js?v=8");
    });

    it('exports a dedicated co-parent redemption handler from db.js', () => {
        const dbSource = readFileSync(resolve(process.cwd(), 'js/db.js'), 'utf8');

        expect(dbSource).toContain('export async function redeemCoParentInvite');
        expect(dbSource).toContain("latestCodeData.type !== 'coparent_invite'");
        expect(dbSource).toContain("relation = codeData.relation || 'Co-parent'");
    });
});
