import { describe, expect, it } from 'vitest';
import { matchesUsableInvite } from '../../scripts/maintain-parent-coverage-invite.mjs';

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
});
