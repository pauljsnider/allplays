import { describe, expect, it } from 'vitest';
import { buildAppAcceptInviteUrl, normalizeAppInviteType } from '../../apps/app/src/lib/inviteUrls';

describe('app join-code URLs', () => {
    it('uses the app accept route and the same type aliases as legacy', () => {
        expect(normalizeAppInviteType('parent_invite')).toBe('parent');
        expect(normalizeAppInviteType('admin_invite')).toBe('admin');
        expect(normalizeAppInviteType('household_invite')).toBe('household');
        expect(normalizeAppInviteType('coparent_invite')).toBe('coparent');
        expect(buildAppAcceptInviteUrl(' abcd1234 ', 'standard', 'https://allplays.ai')).toBe(
            'https://allplays.ai/app#/accept-invite?code=ABCD1234&type=standard'
        );
    });
});
