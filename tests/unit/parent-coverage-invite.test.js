import { describe, expect, it } from 'vitest';
import {
    buildRedemptionPlayerFields,
    buildRedemptionTeamFields,
    inspectRedemptionFixture,
    matchesUsableInvite,
    redemptionFixtureMarker
} from '../../scripts/maintain-parent-coverage-invite.mjs';

function invite(overrides = {}) {
    return {
        fields: {
            type: { stringValue: 'parent_invite' },
            email: { stringValue: 'lifecycle@example.com' },
            relation: { stringValue: 'Parent census signup' },
            teamId: { stringValue: 'signup-team' },
            playerId: { stringValue: 'signup-player' },
            used: { booleanValue: false },
            expiresAt: { timestampValue: '2026-08-10T00:00:00.000Z' },
            ...overrides
        }
    };
}

describe('parent coverage lifecycle invite selection', () => {
    it('accepts only a matching unused invite with useful remaining lifetime', () => {
        const now = Date.parse('2026-08-02T00:00:00.000Z');
        const matches = (document, recipient = 'lifecycle@example.com', purpose = 'signup') =>
            matchesUsableInvite(document, recipient, purpose, 'signup-team', 'signup-player', now);
        expect(matches(invite())).toBe(true);
        expect(matches(invite({ used: { booleanValue: true } }))).toBe(false);
        expect(matches(invite(), 'someone-else@example.com')).toBe(false);
        expect(matches(invite(), 'lifecycle@example.com', 'team-redemption')).toBe(false);
        expect(matches(invite({ teamId: { stringValue: 'stale-team' } }))).toBe(false);
        expect(matches(invite({ playerId: { stringValue: 'stale-player' } }))).toBe(false);
        expect(matchesUsableInvite(invite({
            expiresAt: { timestampValue: '2026-08-02T00:30:00.000Z' }
        }), 'lifecycle@example.com', 'signup', 'signup-team', 'signup-player', now)).toBe(false);
    });

    it('builds an isolated non-public redemption fixture owned by protected staff', () => {
        const now = new Date('2026-08-02T00:00:00.000Z');
        const team = buildRedemptionTeamFields({
            staffUid: 'staff-uid',
            staffEmail: 'Staff@Example.com',
            now
        });
        const player = buildRedemptionPlayerFields('allplays-smoke-redemption-team', now);

        expect(team.ownerId.stringValue).toBe('staff-uid');
        expect(team.adminEmails.arrayValue.values).toEqual([{ stringValue: 'staff@example.com' }]);
        expect(team.isPublic.booleanValue).toBe(false);
        expect(team.fixtureType.stringValue).toBe(redemptionFixtureMarker);
        expect(player.teamId.stringValue).toBe('allplays-smoke-redemption-team');
        expect(player.fixtureType.stringValue).toBe(redemptionFixtureMarker);
    });

    it('accepts only the exact active purpose-marked redemption fixture', () => {
        const teamId = 'allplays-smoke-redemption-team';
        const team = { fields: buildRedemptionTeamFields({ staffUid: 'staff-uid', staffEmail: 'staff@example.com' }) };
        const player = { fields: buildRedemptionPlayerFields(teamId) };
        const inspect = (teamDocument = team, playerDocument = player) => inspectRedemptionFixture(
            teamDocument,
            playerDocument,
            { staffUid: 'staff-uid', teamId }
        );

        expect(inspect().ready).toBe(true);
        expect(inspect({ fields: { ...team.fields, ownerId: { stringValue: 'other' } } }).ready).toBe(false);
        expect(inspect(team, { fields: { ...player.fields, teamId: { stringValue: 'other' } } }).ready).toBe(false);
        expect(inspect(team, { fields: { ...player.fields, fixtureType: { stringValue: 'other' } } }).ready).toBe(false);
        expect(inspect(null, player).ready).toBe(false);
    });
});
