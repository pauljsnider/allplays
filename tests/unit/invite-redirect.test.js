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

    it('preserves the admin invite type when redemption is requested', () => {
        expect(getPostAuthRedirectUrl('dashboard.html', 'abcd1234', true, 'Admin')).toBe('accept-invite.html?code=ABCD1234&type=admin');
    });

    it('preserves household invite redirects when redemption is requested', () => {
        expect(getPostAuthRedirectUrl('dashboard.html', 'abcd1234', true, 'household')).toBe('accept-invite.html?code=ABCD1234&type=household');
    });

    it('normalizes household_invite redirects to the household accept-invite route', () => {
        expect(getPostAuthRedirectUrl('dashboard.html', 'abcd1234', true, 'household_invite')).toBe('accept-invite.html?code=ABCD1234&type=household');
    });

    it('preserves standard and co-parent join-code redirects', () => {
        expect(getPostAuthRedirectUrl('dashboard.html', 'abcd1234', true, 'standard')).toBe('accept-invite.html?code=ABCD1234&type=standard');
        expect(getPostAuthRedirectUrl('dashboard.html', 'abcd1234', true, 'coparent_invite')).toBe('accept-invite.html?code=ABCD1234&type=coparent');
    });

    it('uses default redirect when no valid code exists', () => {
        expect(getPostAuthRedirectUrl('dashboard.html', '', true)).toBe('dashboard.html');
    });

    it('uses default redirect when redemption is not requested', () => {
        expect(getPostAuthRedirectUrl('dashboard.html', 'abcd1234', false)).toBe('dashboard.html');
    });
});
