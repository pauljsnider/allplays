import { describe, expect, it } from 'vitest';
import {
    buildAppAcceptInviteUrl,
    canonicalizeAppAcceptInviteUrl,
    normalizeAppInviteType
} from '../../apps/app/src/lib/inviteUrls';

describe('app join-code URLs', () => {
    it('uses the app accept route and the same type aliases as legacy', () => {
        expect(normalizeAppInviteType('parent_invite')).toBe('parent');
        expect(normalizeAppInviteType('admin_invite')).toBe('admin');
        expect(normalizeAppInviteType('household_invite')).toBe('household');
        expect(normalizeAppInviteType('coparent_invite')).toBe('coparent');
        expect(normalizeAppInviteType('friend_invite')).toBe('friend');
        expect(buildAppAcceptInviteUrl(' abcd1234 ', 'standard', 'https://allplays.ai')).toBe(
            'https://allplays.ai/app/#/accept-invite?code=ABCD1234&type=standard'
        );
    });

    it('translates legacy, app-hash, and code-only invite values to the canonical app route', () => {
        expect(canonicalizeAppAcceptInviteUrl(
            'accept-invite.html?code=home1234&type=household',
            '',
            '',
            'https://allplays.ai'
        )).toBe('https://allplays.ai/app/#/accept-invite?code=HOME1234&type=household');
        expect(canonicalizeAppAcceptInviteUrl(
            'https://allplays.ai/app/#/accept-invite?code=admin123&type=admin_invite',
            '',
            '',
            'https://allplays.ai'
        )).toBe('https://allplays.ai/app/#/accept-invite?code=ADMIN123&type=admin');
        expect(canonicalizeAppAcceptInviteUrl(
            '',
            'parent12',
            'parent_invite',
            'https://allplays.ai'
        )).toBe('https://allplays.ai/app/#/accept-invite?code=PARENT12&type=parent');
    });
});
