import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('authentication email delivery routing', () => {
    it('keeps Firebase direct-delivery APIs out of production auth flows', () => {
        const productionAuthSources = [
            'js/auth.js',
            'js/signup-flow.js',
            'js/firebase.js',
            'apps/app/src/lib/authService.ts',
            'apps/app/src/lib/firebaseAuthRuntime.ts',
            'apps/app/src/lib/adapters/legacyFirebaseAuthSdk.ts'
        ].map(read).join('\n');

        expect(productionAuthSources).not.toMatch(/sendPasswordResetEmail/);
        expect(productionAuthSources).not.toMatch(/sendEmailVerification/);
        expect(productionAuthSources).not.toMatch(/sendSignInLinkToEmail/);
        expect(productionAuthSources).not.toMatch(/accounts:sendOobCode/);
    });

    it('generates action links on the server and queues every auth email through mail', () => {
        const functionsSource = read('functions/index.js');
        const authEmailCoreSource = read('functions/auth-email-core.cjs');
        const callablesSource = read('functions/auth-email-callables.cjs');
        const deliveryStoreSource = read('functions/auth-email-delivery-store.cjs');

        expect(callablesSource).toContain('generatePasswordResetLink');
        expect(callablesSource).toContain('generateEmailVerificationLink');
        expect(callablesSource).toContain('generateSignInWithEmailLink');
        expect(deliveryStoreSource).toContain("firestore.collection('mail').doc(buildMailDocId");
        expect(functionsSource).toContain('createAuthEmailCallableHandlers');
        expect(functionsSource).toContain('createAuthEmailDeliveryStore');
        expect(authEmailCoreSource).toContain("provider: 'resend'");
    });

    it('does not report a rate-limited invite as sent when no mail job was created', () => {
        const callablesSource = read('functions/auth-email-callables.cjs');
        const callableStart = callablesSource.indexOf('async function queueInviteSignInEmail');
        const callableEnd = callablesSource.indexOf('\n  return {', callableStart);
        const inviteCallable = callablesSource.slice(callableStart, callableEnd);
        const cooldownStart = inviteCallable.indexOf('if (!reserved)');
        const cooldownEnd = inviteCallable.indexOf('\n    try {', cooldownStart);
        const cooldownBranch = inviteCallable.slice(cooldownStart, cooldownEnd);

        expect(cooldownBranch).toContain('return { queued: false, existingUser };');
        expect(cooldownBranch).not.toContain('queued: true');
    });
});
