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
        const passwordResetWorkerSource = read('functions/auth-email-password-reset-worker.cjs');
        const deliveryStoreSource = read('functions/auth-email-delivery-store.cjs');
        const resetCallableStart = callablesSource.indexOf('async function queuePasswordResetEmail');
        const resetCallableEnd = callablesSource.indexOf('\n  async function resolveVerificationUser', resetCallableStart);
        const resetCallableSource = callablesSource.slice(resetCallableStart, resetCallableEnd);

        expect(resetCallableSource).toContain('enqueuePasswordResetRequest');
        expect(resetCallableSource).not.toContain('getUserByEmail');
        expect(passwordResetWorkerSource).toContain('generatePasswordResetLink');
        expect(passwordResetWorkerSource).not.toContain('releaseDelivery');
        expect(callablesSource).toContain('generateEmailVerificationLink');
        expect(callablesSource).toContain('generateSignInWithEmailLink');
        expect(deliveryStoreSource).toContain("firestore.collection('mail').doc(deliveryId || buildMailDocId");
        expect(functionsSource).toContain('createAuthEmailCallableHandlers');
        expect(functionsSource).toContain('createAuthEmailDeliveryStore');
        expect(functionsSource).toContain('.runWith({ failurePolicy: true })');
        expect(functionsSource).toContain(".schedule('every 5 minutes')");
        expect(functionsSource).toContain('runWithConcurrencyLimit(snapshot.docs, 5');
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

    it('keeps deferred password-reset requests server-only', () => {
        const rulesSource = read('firestore.rules');
        const requestRuleStart = rulesSource.indexOf('match /authEmailRequests/{requestId}');
        const requestRuleEnd = rulesSource.indexOf('\n    }', requestRuleStart);
        const requestRule = rulesSource.slice(requestRuleStart, requestRuleEnd);

        expect(requestRuleStart).toBeGreaterThan(-1);
        expect(requestRule).toContain('allow read, write: if false;');
    });

    it('runs extracted authentication email behavior tests in PR and production CI', () => {
        const packageSource = read('package.json');
        const ciSource = read('.github/workflows/ci.yml');
        const previewSource = read('.github/workflows/deploy-preview.yml');
        const productionSource = read('.github/workflows/deploy-prod.yml');

        expect(packageSource).toContain('test:functions:auth-email');
        for (const workflowSource of [ciSource, previewSource, productionSource]) {
            expect(workflowSource).toContain('npm run test:functions:auth-email');
        }
    });
});
