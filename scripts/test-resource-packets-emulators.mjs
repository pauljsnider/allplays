import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// This disposable wrapper loads only the exact feature core, never production
// triggers, provider credentials or production Firebase configuration.
const root = resolve(import.meta.dirname, '..');
const portOffset = Number.parseInt(process.env.RESOURCE_PACKETS_EMULATOR_PORT_OFFSET || '0', 10);
if (!Number.isSafeInteger(portOffset) || portOffset < 0 || portOffset > 1000) throw new Error('Choose a port offset from 0 to 1000.');
const ports = { auth: 9299 + portOffset, firestore: 8280 + portOffset, functions: 5201 + portOffset };
const dir = mkdtempSync(join(tmpdir(), 'allplays-resource-emulators-'));
try {
  symlinkSync(join(root, 'functions/node_modules'), join(dir, 'node_modules'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ main: 'index.cjs', engines: { node: '22' }, dependencies: { 'firebase-admin': '12.7.0', 'firebase-functions': '5.1.1' } }));
  writeFileSync(join(dir, 'index.cjs'), `
require(${JSON.stringify(join(root, 'functions/test/resource-packets-network-guard.cjs'))});
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
if (process.env.GCLOUD_PROJECT !== 'demo-allplays-resource' || !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Isolated emulators required');
// Firestore trigger snapshots require a recognized SDK credential class. This
// ephemeral key has no cloud account, is never saved, and is used only locally.
const privateKey = require('node:crypto').generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const credential = admin.credential.cert({ projectId: 'demo-allplays-resource', clientEmail: 'fixture@demo-allplays-resource.iam.gserviceaccount.com', privateKey });
credential.getAccessToken = async () => ({ access_token: 'local-emulator-only', expires_in: 3600 });
credential.getProjectId = async () => 'demo-allplays-resource';
admin.initializeApp({ projectId: 'demo-allplays-resource', credential });
const { createResourcePacketHandlers } = require(${JSON.stringify(join(root, 'functions/resource-packets-handlers.cjs'))});
const db = new (require('firebase-admin/firestore').Firestore)({ projectId: 'demo-allplays-resource' });
const handlers = createResourcePacketHandlers({ functions, db, auth: admin.auth(), enabled: () => true });
Object.assign(exports, handlers, { resourcePacketsCommand: handlers.command, resourcePacketsQuery: handlers.query });
if (${JSON.stringify(process.argv.includes('--browser'))}) {
 // Full-shell Auth attempts this unrelated projection service. Explicitly fail
 // through the callable protocol (including CORS) rather than a missing-route
 // browser transport error. Never fake a successful projection or deploy it.
 exports.syncPublicUserProfileProjection = functions.https.onCall(() => {
   throw new functions.https.HttpsError('unavailable', 'Profile projection is outside this isolated feature fixture.');
 });
}
if (${JSON.stringify(process.argv.includes('--triggers'))}) {
 const { createResourcePacketTriggers } = require(${JSON.stringify(join(root, 'functions/resource-packets-triggers.cjs'))});
 const triggers = createResourcePacketTriggers({ functions, db, auth: admin.auth(), enabled: () => true,
  resolveTargets: async (_team, uids) => {
   const docs = await Promise.all(uids.map(uid => db.doc('users/' + uid).get()));
   return docs.filter(doc => doc.data()?.notifications?.enabled !== false).map(doc => ({ uid: doc.id }));
  },
  dispatch: async ({ deliveryId, targets, beforeEffects }) => {
   const grant = await beforeEffects(); if (!grant) return null;
   const batch = db.batch();
   for (const target of targets.filter(target => grant.allowedUserIds.includes(target.uid))) batch.set(db.doc('resourcePacketTestSink/' + deliveryId + '/recipients/' + target.uid), { uid: target.uid });
   await batch.commit(); return { failureCount: 0 };
  }
 });
 exports.packetPublished = triggers.published; exports.packetAccountDeleted = triggers.accountDeleted;
}

`);
  writeFileSync(join(dir, 'firebase.json'), JSON.stringify({
    functions: { source: '.', ignore: ['node_modules', 'firebase.json'] },
    firestore: { rules: join(root, 'firestore.rules') },
    emulators: { auth: { host: '127.0.0.1', port: ports.auth }, firestore: { host: '127.0.0.1', port: ports.firestore }, functions: { host: '127.0.0.1', port: ports.functions }, ui: { enabled: false }, singleProjectMode: true }
  }));
  const testCommand = process.argv.includes('--browser')
    ? `node ${JSON.stringify(join(root, 'scripts/test-resource-packets-browser.mjs'))}`
    : `node --test ${JSON.stringify(join(root, process.argv.includes('--triggers') ? 'functions/test/resource-packets.trigger.cjs' : 'functions/test/resource-packets.emulator.cjs'))}`;
  const result = spawnSync(join(root, 'node_modules/.bin/firebase'), ['emulators:exec', '--config', join(dir, 'firebase.json'), '--project', 'demo-allplays-resource', '--only', 'auth,firestore,functions', testCommand], { cwd: root, stdio: 'inherit', env: { ...process.env, GCLOUD_PROJECT: 'demo-allplays-resource', FIREBASE_CLI_DISABLE_TELEMETRY: '1', RESOURCE_PACKETS_FUNCTIONS_PORT: String(ports.functions), RESOURCE_PACKETS_APP_PORT: String(4179 + portOffset) } });
  process.exitCode = result.status ?? 1;
} finally { rmSync(dir, { recursive: true, force: true }); }
