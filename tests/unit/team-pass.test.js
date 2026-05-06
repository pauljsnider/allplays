import { describe, expect, it } from 'vitest';
import { buildTeamPassMarkup, getTeamPassAccess } from '../../js/team-pass.js';

const TEAM = {
    id: 'team-1',
    name: 'Blue Jays',
    ownerId: 'owner-1',
    adminEmails: ['admin@example.com']
};

describe('team pass UI helpers', () => {
    it('allows coaches and admins to see the buy team pass entry point', () => {
        expect(getTeamPassAccess({ uid: 'coach-1', coachOf: ['team-1'] }, TEAM)).toMatchObject({
            isEligible: true,
            label: 'Coach/Admin access'
        });

        expect(getTeamPassAccess({ uid: 'admin-1', email: 'admin@example.com' }, TEAM)).toMatchObject({
            isEligible: true,
            label: 'Coach/Admin access'
        });
    });

    it('allows confirmed parents to see the buy team pass entry point', () => {
        expect(getTeamPassAccess({ uid: 'parent-1', parentOf: [{ teamId: 'team-1', playerId: 'p1' }] }, TEAM)).toMatchObject({
            isEligible: true,
            label: 'Confirmed parent access'
        });
    });

    it('keeps non-eligible users in read-only mode', () => {
        expect(getTeamPassAccess({ uid: 'fan-1', email: 'fan@example.com' }, TEAM)).toEqual({
            isEligible: false,
            label: 'Read-only preview',
            mode: 'readonly'
        });
    });

    it('renders plan options and disabled checkout messaging', () => {
        const markup = buildTeamPassMarkup({
            team: TEAM,
            access: { isEligible: true, label: 'Coach/Admin access' }
        });

        expect(markup).toContain('Buy Team Pass');
        expect(markup).toContain('Plus Team Pass');
        expect(markup).toContain('Premium Team Pass');
        expect(markup).toContain('Season-scoped coverage');
        expect(markup).toContain('disabled aria-disabled="true"');
        expect(markup).toContain('Checkout is not connected yet');
    });

    it('renders non-eligible users as unable to purchase', () => {
        const markup = buildTeamPassMarkup({
            team: TEAM,
            access: { isEligible: false, label: 'Read-only preview' }
        });

        expect(markup).toContain('Read-only preview');
        expect(markup).toContain('Purchase unavailable');
        expect(markup).toContain('coach, admin, or confirmed parent');
    });
});
