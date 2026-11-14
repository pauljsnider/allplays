import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Only production invitation/auth-email factories are registered. No provider
// delivery, production triggers, credentials or live project configuration.
const root = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'allplays-invitation-emulators-'));
const projectId = 'demo-allplays-invitation';
try {
  symlinkSync(join(root, 'functions/node_modules'), join(dir, 'node_modules'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ main: 'index.cjs', engines: { node: '22' }, dependencies: { 'firebase-admin': '12.7.0', 'firebase-functions': '5.1.1' } }));
  writeFileSync(join(dir, 'index.cjs'), `
require(${JSON.stringify(join(root, 'functions/test/resource-packets-network-guard.cjs'))});
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('node:crypto');
if (process.env.GCLOUD_PROJECT !== '${projectId}' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8380' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9399') throw new Error('Isolated invitation emulators required');
admin.initializeApp({ projectId: '${projectId}', credential: { getAccessToken: async () => ({ access_token: 'local-emulator-only', expires_in: 3600 }) } });
const { Firestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const firestore = new Firestore({ projectId: '${projectId}' });
const { createAccessCodeValidationHandler } = require(${JSON.stringify(join(root, 'functions/access-code-validation.cjs'))});
const { createFriendInviteRedemptionTransaction, createFriendInviteRedemptionCallableHandler } = require(${JSON.stringify(join(root, 'functions/friend-invite-redemption-core.cjs'))});
exports.validateAccessCodeForAcceptance = functions.https.onCall(createAccessCodeValidationHandler({ firestore, auth: admin.auth(), HttpsError: functions.https.HttpsError }));
exports.redeemFriendInvite = functions.https.onCall(createFriendInviteRedemptionCallableHandler({ redeemTransaction: createFriendInviteRedemptionTransaction({ firestore, Timestamp, HttpsError: functions.https.HttpsError, logger: functions.logger }), HttpsError: functions.https.HttpsError }));
const core = require(${JSON.stringify(join(root, 'functions/auth-email-core.cjs'))});
const { createAuthEmailDeliveryStore } = require(${JSON.stringify(join(root, 'functions/auth-email-delivery-store.cjs'))});
const { createAuthEmailCallableHandlers } = require(${JSON.stringify(join(root, 'functions/auth-email-callables.cjs'))});
// Production's supported mail-collection transport is the local inbox. Omitting
// sendDelivery deliberately disables Resend; this is not provider-delivery evidence.
const store = createAuthEmailDeliveryStore({ firestore, Timestamp, FieldValue, logger: functions.logger, cooldownMs: 60000, buildRateLimitId: core.buildAuthEmailRateLimitId, buildMailDocId: core.buildAuthEmailMailDocId, buildMailJob: core.buildAuthEmailMailJob, normalizeEmail: core.normalizeAuthEmail, hashRecipient: value => crypto.createHash('sha256').update(value).digest('hex') });
const emailHandlers = createAuthEmailCallableHandlers({ auth: admin.auth(), HttpsError: functions.https.HttpsError, logger: functions.logger, types: core.AUTH_EMAIL_TYPES, normalizeEmail: core.normalizeAuthEmail, isValidEmail: core.isValidAuthEmail, reserveDelivery: store.reserve, releaseDelivery: store.release, queueDelivery: store.queue, getActionSettings: core.getAuthEmailActionSettings, canonicalizeActionUrl: core.buildCanonicalAuthActionUrl, normalizeVerificationNextRoute: core.normalizeVerificationNextRoute });
exports.queueEmailVerification = functions.https.onCall(emailHandlers.queueEmailVerification);
// This unrelated optional profile projection is intentionally unavailable, not
// replaced with synthetic success. Production callers already handle that case.
exports.syncPublicUserProfileProjection = functions.https.onCall(() => { throw new functions.https.HttpsError('unavailable', 'Outside the isolated invitation fixture.'); });
`);
  writeFileSync(join(dir, 'firebase.json'), JSON.stringify({ functions: { source: '.', ignore: ['node_modules', 'firebase.json'] }, firestore: { rules: join(root, 'firestore.rules') }, emulators: { auth: { host: '127.0.0.1', port: 9399 }, firestore: { host: '127.0.0.1', port: 8380 }, functions: { host: '127.0.0.1', port: 5301 }, ui: { enabled: false }, singleProjectMode: true } }));
  const env = { ...process.env, GCLOUD_PROJECT: projectId, FIREBASE_CLI_DISABLE_TELEMETRY: '1' };
  delete env.GOOGLE_APPLICATION_CREDENTIALS;
  delete env.RESEND_API_KEY;
  delete env.RESEND_WEBHOOK_SECRET;
  const result = spawnSync(join(root, 'node_modules/.bin/firebase'), ['emulators:exec', '--config', join(dir, 'firebase.json'), '--project', projectId, '--only', 'auth,firestore,functions', `node ${JSON.stringify(join(root, 'scripts/test-invitation-browser.mjs'))}`], { cwd: root, stdio: 'inherit', env });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
