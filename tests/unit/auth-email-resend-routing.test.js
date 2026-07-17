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

    it('generates action links on the server and sends auth email through tracked Resend delivery', () => {
        const functionsSource = read('functions/index.js');
        const authEmailCoreSource = read('functions/auth-email-core.cjs');
        const callablesSource = read('functions/auth-email-callables.cjs');
        const passwordResetWorkerSource = read('functions/auth-email-password-reset-worker.cjs');
        const passwordResetSweeperSource = read('functions/auth-email-password-reset-sweeper.cjs');
        const deliveryStoreSource = read('functions/auth-email-delivery-store.cjs');
        const resendDeliverySource = read('functions/resend-auth-email-delivery.cjs');
        const resetCallableStart = callablesSource.indexOf('async function queuePasswordResetEmail');
        const resetCallableEnd = callablesSource.indexOf('\n  async function resolveVerificationUser', resetCallableStart);
        const resetCallableSource = callablesSource.slice(resetCallableStart, resetCallableEnd);

        expect(resetCallableSource).toContain('enqueuePasswordResetRequest');
        expect(resetCallableSource).not.toContain('getUserByEmail');
        expect(passwordResetWorkerSource).toContain('generatePasswordResetLink');
        expect(passwordResetWorkerSource).not.toContain('releaseDelivery');
        expect(callablesSource).toContain('generateEmailVerificationLink');
        expect(callablesSource).toContain('generateSignInWithEmailLink');
        expect(deliveryStoreSource).toContain('await sendDelivery({ deliveryId: resolvedDeliveryId, job });');
        expect(resendDeliverySource).toContain('await resend.emails.send(payload, {');
        expect(resendDeliverySource).toContain('idempotencyKey: delivery.idempotencyKey');
        expect(resendDeliverySource).toContain('resend.webhooks.verify({');
        expect(resendDeliverySource).toContain('accounts:sendOobCode?key=');
        expect(resendDeliverySource).toContain('message: FieldValue.delete()');
        expect(resendDeliverySource).toContain("error.code = 'delivery-mapping-pending'");
        expect(resendDeliverySource).toContain('expiresAt: new Date(now().getTime() + DELIVERY_RETENTION_MS)');
        const indexesSource = read('firestore.indexes.json');
        expect(indexesSource).toMatch(/"collectionGroup": "authEmailDeliveries"[\s\S]*?"fieldPath": "expiresAt"[\s\S]*?"ttl": true/);
        expect(functionsSource).toContain('createAuthEmailCallableHandlers');
        expect(functionsSource).toContain('createAuthEmailDeliveryStore');
        expect(functionsSource).toContain(".runWith({ failurePolicy: true, secrets: ['RESEND_API_KEY'] })");
        expect(functionsSource).toContain("secrets: ['RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET']");
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
        for (const collection of [
            'authEmailDeliveries',
            'resendEmailMessages',
            'resendWebhookEvents',
            'emailDeliveryAlerts'
        ]) {
            expect(rulesSource).toContain(`match /${collection}/{`);
        }
    });

    it('runs extracted authentication email behavior tests in PR and production CI', () => {
        const packageSource = read('package.json');
        const ciSource = read('.github/workflows/ci.yml');
        const previewSource = read('.github/workflows/deploy-preview.yml');
        const productionSource = read('.github/workflows/deploy-prod.yml');

        expect(packageSource).toContain('test:functions:auth-email');
        for (const workflowSource of [ciSource, previewSource, productionSource]) {
            expect(workflowSource).toContain('npm run test:functions:auth-email');
            const unitJobStart = workflowSource.indexOf('  unit-tests:');
            const unitTestCommand = workflowSource.indexOf('run: npm run test:unit:ci', unitJobStart);
            const functionsInstall = workflowSource.indexOf('run: npm ci --prefix functions', unitJobStart);

            expect(unitJobStart).toBeGreaterThan(-1);
            expect(functionsInstall).toBeGreaterThan(unitJobStart);
            expect(functionsInstall).toBeLessThan(unitTestCommand);
        }
    });

    it('bounds the normal non-destructive production deploy to three attempts', () => {
        const productionSource = read('.github/workflows/deploy-prod.yml');
        const firebaseDeployCommands = productionSource
            .split('\n')
            .map(line => line.trim())
            .filter(line => /^(run: )?npx firebase-tools@14\.25\.0 deploy/.test(line));

        expect(firebaseDeployCommands).toEqual([
            'npx firebase-tools@14.25.0 deploy --only storage --project game-flow-c6311 --config "$FIREBASE_PROD_CONFIG" --non-interactive 2>&1 | tee "$storage_log"',
            'npx firebase-tools@14.25.0 deploy --only hosting,firestore:rules,firestore:indexes,functions --project game-flow-c6311 --config "$FIREBASE_PROD_CONFIG" --non-interactive 2>&1 | tee "$deploy_log"'
        ]);
        expect(productionSource).toContain('[[ "$STORAGE_RULES_CHANGED" != "true" ]]');
        expect(productionSource).toContain('exit "$storage_status"');
        expect(productionSource.match(/--force/g) ?? []).toHaveLength(0);
        expect(productionSource).toContain('max_attempts=3');
        expect(productionSource).toContain('for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do');
        expect(productionSource).toContain('if (( attempt == max_attempts )); then');
        expect(productionSource).toContain('retry_delay_seconds=$((15 * (2 ** (attempt - 1))))');
    });

    it('retries only transient production deploy failures and fails fast otherwise', () => {
        const productionSource = read('.github/workflows/deploy-prod.yml');
        const deployStepStart = productionSource.indexOf('      - name: Deploy Firebase production');
        const deployStep = productionSource.slice(deployStepStart);
        const transientGuard = 'if ! grep -Eiq "$transient_pattern" "$deploy_log"; then';
        const attemptLimitGuard = 'if (( attempt == max_attempts )); then';
        const retryDelay = 'retry_delay_seconds=$((15 * (2 ** (attempt - 1))))';
        const nonTransientBranch = deployStep.slice(
            deployStep.indexOf(transientGuard),
            deployStep.indexOf(attemptLimitGuard)
        );

        expect(deployStepStart).toBeGreaterThan(-1);
        expect(deployStep).toContain("transient_pattern='(^|[^[:alnum:]])(429|500|502|503|504)([^[:alnum:]]|$)|service[[:space:]_-]+unavailable|econnreset|connection[[:space:]_-]+reset|network[[:space:]_-]+reset|etimedout|timed[[:space:]_-]+out|timeout'");
        expect(deployStep).toContain('2>&1 | tee "$deploy_log"');
        expect(deployStep).toContain('deploy_status="${PIPESTATUS[0]}"');
        expect(deployStep).toContain(transientGuard);
        expect(deployStep.indexOf(transientGuard)).toBeLessThan(deployStep.indexOf(attemptLimitGuard));
        expect(deployStep.indexOf(attemptLimitGuard)).toBeLessThan(deployStep.indexOf(retryDelay));
        expect(nonTransientBranch).toContain('failed with a non-transient error; not retrying.');
        expect(nonTransientBranch).toContain('exit "$deploy_status"');
    });
});
