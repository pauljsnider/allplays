import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLegacyAuthRedirectUrl } from '../../js/app-redirect.js';

describe('legacy auth compatibility redirects', () => {
    it('translates login signup, invite context, and safe next routes', () => {
        expect(buildLegacyAuthRedirectUrl(
            'login',
            'https://allplays.ai/login.html?code=ABCD1234&type=parent&next=%2Fschedule%3FteamId%3Dteam-1#signup'
        )).toBe(
            'https://allplays.ai/app/#/auth?code=ABCD1234&type=parent&mode=signup&next=%2Fschedule%3FteamId%3Dteam-1'
        );
    });

    it('preserves invite and Firebase action parameters', () => {
        const destination = new URL(buildLegacyAuthRedirectUrl(
            'accept-invite',
            'https://allplays.ai/accept-invite.html?code=HOME1234&type=household&mode=signIn&oobCode=secret&apiKey=public'
        ));
        const params = new URLSearchParams(destination.hash.split('?')[1]);
        expect(destination.hash).toContain('#/accept-invite?');
        expect(params.get('code')).toBe('HOME1234');
        expect(params.get('type')).toBe('household');
        expect(params.get('mode')).toBe('signIn');
        expect(params.get('oobCode')).toBe('secret');
    });

    it('routes legacy reset and verification action links through the app handler', () => {
        expect(buildLegacyAuthRedirectUrl(
            'reset-password',
            'https://allplays.ai/reset-password.html?mode=resetPassword&oobCode=reset-code'
        )).toContain('/app/#/reset-password?');
        expect(buildLegacyAuthRedirectUrl(
            'verify-pending',
            'https://allplays.ai/verify-pending.html?mode=verifyEmail&oobCode=verify-code'
        )).toContain('/app/#/reset-password?');
    });

    it('does not forward external next destinations', () => {
        expect(buildLegacyAuthRedirectUrl(
            'login',
            'https://allplays.ai/login.html?next=https%3A%2F%2Fevil.example'
        )).toBe('https://allplays.ai/app/#/auth');
    });

    it.each(['login.html', 'accept-invite.html', 'reset-password.html', 'verify-pending.html'])(
        '%s installs the shared compatibility redirect before the legacy fallback',
        (file) => {
            const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
            expect(source).toContain("from './js/app-redirect.js?v=1'");
            expect(source.indexOf('redirectLegacyAuthPage')).toBeLessThan(source.indexOf('<body'));
        }
    );
});
