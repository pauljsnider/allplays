import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
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
        const passwordResetSweeperSource = read('functions/auth-email-password-reset-sweeper.cjs');
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
        expect(functionsSource).toContain('createPasswordResetEmailSweeper');
        expect(passwordResetSweeperSource).toContain('Password-reset backlog request remains queued for retry.');
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

    it('enables the password-reset retry policy before the non-destructive production deploy', () => {
        const productionSource = read('.github/workflows/deploy-prod.yml');
        const firebaseDeployCommands = productionSource
            .split('\n')
            .map(line => line.trim())
            .filter(line => /^(run: )?npx firebase-tools@14\.25\.0 deploy/.test(line));

        expect(firebaseDeployCommands).toEqual([
            'npx firebase-tools@14.25.0 deploy --only functions:processPasswordResetEmailRequest --project game-flow-c6311 --config "$FIREBASE_PROD_CONFIG" --non-interactive --force',
            'run: npx firebase-tools@14.25.0 deploy --only hosting,firestore:rules,firestore:indexes,functions --project game-flow-c6311 --config "$FIREBASE_PROD_CONFIG" --non-interactive'
        ]);
        expect(productionSource).toContain('npx firebase-tools@14.25.0 functions:list');
        expect(productionSource).toContain('.eventTrigger.retry == true');
        expect(productionSource).toContain('jq -e \'\.functions == {"source":"functions"}\' "$FIREBASE_PROD_CONFIG"');
        expect(productionSource).toContain('Refusing retry-policy migration for an unexpected Functions deploy source.');
        expect(productionSource).toContain('expected_functions_hash="102aad7b6547759d0fa8e5c85d06d2a704cd3768690ce889649efb34600b56a8"');
        expect(productionSource).toContain('elif [[ "$functions_hash" == "$expected_functions_hash" ]]');
        expect(productionSource).toContain('Refusing forced retry-policy migration for unreviewed Functions source.');
        expect(productionSource.match(/--force/g)).toHaveLength(1);
    });

    it('pins the forced migration to the reviewed tracked Functions tree', () => {
        const productionSource = read('.github/workflows/deploy-prod.yml');
        const approvedHash = productionSource.match(/expected_functions_hash="([a-f0-9]{64})"/)?.[1];
        const trackedFunctionFiles = execFileSync('git', ['ls-files', 'functions'], { encoding: 'utf8' })
            .trim()
            .split('\n')
            .filter(Boolean)
            .sort();
        const functionsManifest = trackedFunctionFiles
            .map(path => `${sha256(readFileSync(resolve(process.cwd(), path)))}  ${path}\n`)
            .join('');

        expect(trackedFunctionFiles).not.toHaveLength(0);
        expect(approvedHash).toBe(sha256(functionsManifest));
    });
});
