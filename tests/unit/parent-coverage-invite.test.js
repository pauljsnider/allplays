import { describe, expect, it } from 'vitest';
import { matchesUsableInvite } from '../../scripts/maintain-parent-coverage-invite.mjs';

function invite(overrides = {}) {
    return {
        fields: {
            type: { stringValue: 'parent_invite' },
            email: { stringValue: 'lifecycle@example.com' },
            relation: { stringValue: 'Parent census signup' },
            used: { booleanValue: false },
            expiresAt: { timestampValue: '2026-08-10T00:00:00.000Z' },
            ...overrides
        }
    };
}

describe('parent coverage lifecycle invite selection', () => {
    it('accepts only a matching unused invite with useful remaining lifetime', () => {
        const now = Date.parse('2026-08-02T00:00:00.000Z');
        expect(matchesUsableInvite(invite(), 'lifecycle@example.com', 'signup', now)).toBe(true);
        expect(matchesUsableInvite(invite({ used: { booleanValue: true } }), 'lifecycle@example.com', 'signup', now)).toBe(false);
        expect(matchesUsableInvite(invite(), 'someone-else@example.com', 'signup', now)).toBe(false);
        expect(matchesUsableInvite(invite(), 'lifecycle@example.com', 'team-redemption', now)).toBe(false);
        expect(matchesUsableInvite(invite({
            expiresAt: { timestampValue: '2026-08-02T00:30:00.000Z' }
        }), 'lifecycle@example.com', 'signup', now)).toBe(false);
    });
});
