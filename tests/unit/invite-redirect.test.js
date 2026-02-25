import { describe, it, expect } from 'vitest';
import { normalizeInviteCode, getPostAuthRedirectUrl } from '../../js/invite-redirect.js';

describe('invite redirect helper', () => {
    it('normalizes valid invite codes', () => {
        expect(normalizeInviteCode(' abcd1234 ')).toBe('ABCD1234');
    });

    it('returns null for malformed invite codes', () => {
        expect(normalizeInviteCode('short')).toBe(null);
    });

    it('routes login to invite acceptance when redemption is requested', () => {
        expect(getPostAuthRedirectUrl('dashboard.html', 'abcd1234', true)).toBe('accept-invite.html?code=ABCD1234');
    });

    it('uses default redirect when no valid code exists', () => {
        expect(getPostAuthRedirectUrl('dashboard.html', '', true)).toBe('dashboard.html');
    });

    it('uses default redirect when redemption is not requested', () => {
        expect(getPostAuthRedirectUrl('dashboard.html', 'abcd1234', false)).toBe('dashboard.html');
    });
});
