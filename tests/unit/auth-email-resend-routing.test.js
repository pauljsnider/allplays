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

        expect(functionsSource).toContain('generatePasswordResetLink');
        expect(functionsSource).toContain('generateEmailVerificationLink');
        expect(functionsSource).toContain('generateSignInWithEmailLink');
        expect(functionsSource).toContain("firestore.collection('mail').doc(buildAuthEmailMailDocId");
        expect(authEmailCoreSource).toContain("provider: 'resend'");
    });

    it('does not report a rate-limited invite as sent when no mail job was created', () => {
        const functionsSource = read('functions/index.js');
        const callableStart = functionsSource.indexOf('exports.queueInviteSignInEmail');
        const callableEnd = functionsSource.indexOf('exports.queueInviteEmail =', callableStart + 1);
        const inviteCallable = functionsSource.slice(callableStart, callableEnd);
        const cooldownStart = inviteCallable.indexOf('if (!reserved)');
        const cooldownEnd = inviteCallable.indexOf('\n  try {', cooldownStart);
        const cooldownBranch = inviteCallable.slice(cooldownStart, cooldownEnd);

        expect(cooldownBranch).toContain('return { queued: false, existingUser };');
        expect(cooldownBranch).not.toContain('queued: true');
    });
});
