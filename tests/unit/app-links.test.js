import { describe, expect, it } from 'vitest';
import {
    appendAppRouteParams,
    buildFirebaseSdkActionHref,
    buildAppUrl,
    normalizeFirebaseActionHref
} from '../../apps/app/src/lib/appLinks';

describe('canonical app links', () => {
    it('builds canonical hash URLs and encodes route parameters', () => {
        expect(buildAppUrl('/accept-invite', {
            code: 'ABCD1234',
            type: 'parent'
        }, 'https://preview.example/path')).toBe(
            'https://preview.example/app/#/accept-invite?code=ABCD1234&type=parent'
        );
        expect(appendAppRouteParams('/schedule/team-1/event-1?section=game', {
            childId: 'child one'
        })).toBe('/schedule/team-1/event-1?section=game&childId=child+one');
    });

    it('moves Firebase reset parameters from the outer query into the app hash', () => {
        const result = new URL(normalizeFirebaseActionHref(
            'https://allplays.ai/app/?mode=resetPassword&oobCode=one-time-code&apiKey=public-key&cb=1#/reset-password'
        ));

        expect(result.searchParams.get('cb')).toBe('1');
        expect(result.searchParams.has('oobCode')).toBe(false);
        expect(result.hash).toContain('#/reset-password?');
        const hashParams = new URLSearchParams(result.hash.split('?')[1]);
        expect(hashParams.get('mode')).toBe('resetPassword');
        expect(hashParams.get('oobCode')).toBe('one-time-code');
        expect(hashParams.get('apiKey')).toBe('public-key');
    });

    it('routes verification actions through the action handler and then verification status', () => {
        const result = new URL(normalizeFirebaseActionHref(
            'https://allplays.ai/app/?mode=verifyEmail&oobCode=verify-code#/verify-pending'
        ));
        const [hashPath, hashQuery] = result.hash.replace(/^#/, '').split('?');

        expect(hashPath).toBe('/reset-password');
        expect(new URLSearchParams(hashQuery).get('next')).toBe('/verify-pending');
    });

    it('recognizes Firebase action parameters already placed in the hash query', () => {
        const reset = new URL(normalizeFirebaseActionHref(
            'https://allplays.ai/app/#/auth?mode=resetPassword&oobCode=hash-reset&lang=en'
        ));
        expect(reset.hash).toContain('#/reset-password?');
        const resetParams = new URLSearchParams(reset.hash.split('?')[1]);
        expect(resetParams.get('mode')).toBe('resetPassword');
        expect(resetParams.get('oobCode')).toBe('hash-reset');
        expect(resetParams.get('lang')).toBe('en');

        const verification = new URL(normalizeFirebaseActionHref(
            'https://allplays.ai/app/#/verify-pending?mode=verifyEmail&oobCode=hash-verify'
        ));
        expect(verification.hash).toContain('#/reset-password?');
        const verificationParams = new URLSearchParams(verification.hash.split('?')[1]);
        expect(verificationParams.get('oobCode')).toBe('hash-verify');
        expect(verificationParams.get('next')).toBe('/verify-pending');

        const inviteSignIn = new URL(normalizeFirebaseActionHref(
            'https://allplays.ai/app/#/auth?code=HOME1234&type=household&mode=signIn&oobCode=hash-sign-in'
        ));
        expect(inviteSignIn.hash).toContain('#/accept-invite?');
        const inviteParams = new URLSearchParams(inviteSignIn.hash.split('?')[1]);
        expect(inviteParams.get('code')).toBe('HOME1234');
        expect(inviteParams.get('type')).toBe('household');
        expect(inviteParams.get('oobCode')).toBe('hash-sign-in');
    });

    it('recovers an invite route from a same-origin Firebase continue URL', () => {
        const continueUrl = encodeURIComponent('https://allplays.ai/app/#/accept-invite?code=HOME1234&type=household');
        const result = new URL(normalizeFirebaseActionHref(
            `https://allplays.ai/app/?mode=signIn&oobCode=sign-in-code&continueUrl=${continueUrl}`
        ));

        expect(result.hash).toContain('#/accept-invite?');
        const hashParams = new URLSearchParams(result.hash.split('?')[1]);
        expect(hashParams.get('code')).toBe('HOME1234');
        expect(hashParams.get('type')).toBe('household');
        expect(hashParams.get('mode')).toBe('signIn');
        expect(hashParams.get('oobCode')).toBe('sign-in-code');
    });

    it('reconstructs a Firebase SDK-compatible outer query without changing the canonical hash route', () => {
        const result = new URL(buildFirebaseSdkActionHref(
            'https://allplays.ai/app/#/accept-invite?code=HOME1234&type=household&mode=signIn&oobCode=sign-in-code&apiKey=public-key'
        ));

        expect(result.pathname).toBe('/app/');
        expect(result.searchParams.get('mode')).toBe('signIn');
        expect(result.searchParams.get('oobCode')).toBe('sign-in-code');
        expect(result.searchParams.get('apiKey')).toBe('public-key');
        expect(result.hash).toContain('#/accept-invite?code=HOME1234&type=household');
    });
});
