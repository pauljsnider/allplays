import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from '../apps/app/node_modules/vite/dist/node/index.js';
const require = createRequire(import.meta.url);
require('../functions/test/resource-packets-network-guard.cjs');
const projectId = 'demo-allplays-invitation';
if (process.env.GCLOUD_PROJECT !== projectId || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8380' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9399') throw new Error('Isolated invitation stack required');
const functionsRequire = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = functionsRequire('firebase-admin');
admin.initializeApp({ projectId, credential: { getAccessToken: async () => ({ access_token: 'local-only', expires_in: 3600 }) } });
const { Firestore } = functionsRequire('firebase-admin/firestore');
const db = new Firestore({ projectId });
const root = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(root, 'apps/app/.invitation-browser-'));
const origin = 'http://127.0.0.1:4189';
const password = 'LocalInvitationFixture-123!';
const inviterEmail = 'inviter@example.invalid';
const recipientEmail = 'recipient@example.invalid';
let server; let browser; let lastPage;
const errors = [];
try {
  // Seed only the established inviter; the recipient must be created by the UI.
  await admin.auth().createUser({ uid: 'synthetic-inviter', email: inviterEmail, password, emailVerified: true });
  await db.doc('users/synthetic-inviter').set({ email: inviterEmail, fullName: 'Synthetic Inviter', active: true });
  writeFileSync(join(dir, 'firebase.ts'), `
import { initializeApp } from 'firebase/app';
import { initializeAuth, browserLocalPersistence, connectAuthEmulator } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore';
export * from 'firebase/functions'; export * from 'firebase/auth'; export * from 'firebase/firestore'; export * from 'firebase/app'; export * from 'firebase/storage';
import { getStorage } from 'firebase/storage';
const app = initializeApp({ projectId: '${projectId}', apiKey: 'local-only', authDomain: 'localhost' });
export const appCheckReady = Promise.resolve(); export const storage = getStorage(app);
export const auth = initializeAuth(app, { persistence: browserLocalPersistence }); connectAuthEmulator(auth, 'http://127.0.0.1:9399', { disableWarnings: true });
export const functions = getFunctions(app); connectFunctionsEmulator(functions, '127.0.0.1', 5301);
export const db = initializeFirestore(app, { experimentalForceLongPolling: true, useFetchStreams: false }); connectFirestoreEmulator(db, '127.0.0.1', 8380);
`);
  writeFileSync(join(dir, 'auth-sdk.ts'), `import './firebase'; export * from 'firebase/app'; export * from 'firebase/auth'; export const resolvePrimaryFirebaseConfig = async () => ({ projectId: '${projectId}', apiKey: 'local-only', authDomain: 'localhost' }); export const initializePrimaryAppCheck = async () => null;`);
  writeFileSync(join(dir, 'app-check.ts'), `export const initializePrimaryAppCheck = async () => null; export const getPrimaryAppCheckToken = async () => null; export const getPrimaryAppCheckHeaders = async (headers = {}) => headers;`);
  writeFileSync(join(dir, 'images.ts'), `import { storage } from './firebase'; export const imageStorage = storage; export const ensureImageAuth = async () => null; export const requireImageAuth = async () => null;`);
  writeFileSync(join(dir, 'index.html'), '<html><head><title>Isolated invitation QA</title></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
  writeFileSync(join(dir, 'entry.tsx'), "import '../src/main';");
  // Serve the unchanged legacy page and shared modules through the same local
  // SDK transport mapping; the profile generation handler is production code.
  writeFileSync(join(dir, 'profile.html'), readFileSync(join(root, 'profile.html')));
  for (const directory of ['js', 'css', 'img']) symlinkSync(join(root, directory), join(dir, directory));
  server = await createServer({ configFile: false, root: dir, esbuild: { jsx: 'automatic' }, resolve: { alias: { '@legacy': join(root, 'js') }, dedupe: ['react', 'react-dom'] }, plugins: [{ name: 'invitation-emulator-transport', enforce: 'pre', transform(source, id) {
    if (id.includes('push-notifications.js')) return source.replace('https://www.gstatic.com/firebasejs/12.6.0/firebase-messaging.js', 'firebase/messaging');
  }, async resolveId(id) {
    if (/\/adapters\/legacyFirebaseAuthSdk$/.test(id)) return join(dir, 'auth-sdk.ts');
    if (/(?:^|\/)firebase\.js(?:\?|$)/.test(id)) return join(dir, 'firebase.ts');
    if (/(?:^|\/)firebase-app-check(?:-rest)?\.js(?:\?|$)/.test(id)) return join(dir, 'app-check.ts');
    if (/(?:^|\/)firebase-images\.js(?:\?|$)/.test(id)) return join(dir, 'images.ts');
    const sdk = id.match(/vendor\/firebase-(app|auth|firestore|functions|storage)\.js(?:\?|$)/);
    if (sdk) return this.resolve('firebase/' + sdk[1], join(dir, 'firebase.ts'), { skipSelf: true });
  } }], server: { host: '127.0.0.1', port: 4189, strictPort: true, fs: { allow: [root] } } });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  async function session() {
    const context = await browser.newContext({ serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
    // The legacy page configures CDN Tailwind. External styling is blocked in
    // this offline fixture; this object only accepts its presentation config.
    await context.addInitScript(() => { window.tailwind = {}; });
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const page = await context.newPage(); lastPage = page;
    page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    return { context, page };
  }
  const inviter = await session();
  await inviter.page.goto(`${origin}/#/auth`);
  await inviter.page.getByLabel('Email', { exact: true }).fill(inviterEmail);
  await inviter.page.getByLabel('Password', { exact: true }).fill(password);
  await inviter.page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(inviter.page).not.toHaveURL(/#\/auth/);
  await inviter.page.goto(`${origin}/#/profile/settings?section=invites`);
  await inviter.page.getByLabel('Recipient email', { exact: true }).fill(recipientEmail);
  await inviter.page.getByRole('button', { name: 'Create invite', exact: true }).click();
  await expect(inviter.page.getByText('Invite code generated.', { exact: true })).toBeVisible({ timeout: 30000 });
  const codes = await db.collection('accessCodes').where('generatedBy', '==', 'synthetic-inviter').get();
  assert.equal(codes.size, 1, 'real inviter UI creates one code');
  const invite = codes.docs[0];
  assert.equal(invite.data().type, 'friend_invite');
  assert.equal(invite.data().email, recipientEmail);
  assert.equal(invite.data().used, false);
  const code = invite.data().code;
  async function acceptInvitation(recipientEmail, invite, invitationUrl, previousFriendships, exercisePartialSignupRecovery = false) {
    let recipient = await session();
    await recipient.page.goto(invitationUrl);
    await recipient.page.getByRole('link', { name: 'Create account with code', exact: true }).click();
    await recipient.page.getByLabel('Email', { exact: true }).fill(recipientEmail);
    await recipient.page.getByLabel('Password', { exact: true }).fill(password);
    await recipient.page.getByLabel('Confirm password', { exact: true }).fill(password);
    await recipient.page.getByRole('checkbox', { name: /I agree to the/ }).check();
    await recipient.page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(recipient.page).toHaveURL(/#\/verify-pending/, { timeout: 30000 });
    const createdRecipient = await admin.auth().getUserByEmail(recipientEmail);
    assert.equal(createdRecipient.emailVerified, false);
    assert.equal((await invite.ref.get()).data().used, false, 'signup must leave invite unconsumed until verified');
    assert.equal((await db.collection('friendships').get()).size, previousFriendships);
    await expect.poll(async () => (await db.collection('mail').where('metadata.authUserId', '==', createdRecipient.uid).get()).size).toBe(1);
    if (exercisePartialSignupRecovery) {
      await recipient.context.close();
      recipient = await session();
      await recipient.page.goto(invitationUrl);
      await recipient.page.getByRole('link', { name: 'Create account with code', exact: true }).click();
      await recipient.page.getByLabel('Email', { exact: true }).fill(recipientEmail);
      await recipient.page.getByLabel('Password', { exact: true }).fill(password);
      await recipient.page.getByLabel('Confirm password', { exact: true }).fill(password);
      await recipient.page.getByRole('checkbox', { name: /I agree to the/ }).check();
      await recipient.page.getByRole('button', { name: 'Create account', exact: true }).click();
      await expect(recipient.page.getByText(/An account already exists for this email/)).toBeVisible();
      await expect(recipient.page).toHaveURL(new RegExp(`code=${invite.data().code}.*mode=login`));
      await recipient.page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(recipient.page).toHaveURL(/#\/verify-pending/, { timeout: 30000 });
      assert.equal((await admin.auth().getUserByEmail(recipientEmail)).uid, createdRecipient.uid);
      assert.equal((await invite.ref.get()).data().used, false);
    }
    const mail = (await db.collection('mail').where('metadata.authUserId', '==', createdRecipient.uid).get()).docs[0].data();
    assert.deepEqual(mail.to, [recipientEmail]);
    const actionUrl = new URL(mail.message.text.match(/https:\/\/[^\s]+/)[0]);
    const outbox = await (await fetch(`http://127.0.0.1:9399/emulator/v1/projects/${projectId}/oobCodes`)).json();
    assert.ok(outbox.oobCodes.some(item => item.email === recipientEmail && item.oobCode === new URLSearchParams(actionUrl.hash.split('?')[1]).get('oobCode')), 'mail action uses the real Auth emulator OOB code');
    // Only rewrite the public origin to the isolated Vite host; retain the actual
    // production action route and OOB parameters from the delivered message.
    const verification = await recipient.context.newPage(); lastPage = verification;
    await verification.goto(`${origin}${actionUrl.pathname}${actionUrl.search}${actionUrl.hash}`);
    await expect.poll(async () => (await admin.auth().getUser(createdRecipient.uid)).emailVerified).toBe(true);
    await verification.close(); lastPage = recipient.page;
    await recipient.page.getByRole('button', { name: "I've verified, continue", exact: true }).click();
    await expect(recipient.page).toHaveURL(/#\/home\?section=friends/, { timeout: 30000 });
    const redeemed = (await invite.ref.get()).data();
    assert.equal(redeemed.used, true);
    assert.equal(redeemed.usedBy, createdRecipient.uid);
    const friendship = await db.doc(`friendships/${['synthetic-inviter', createdRecipient.uid].sort().join('__')}`).get();
    assert.ok(friendship.exists, 'production transaction creates canonical friendship');
    const beforeReplay = friendship.data();
    await recipient.page.goto(invitationUrl);
    await expect(recipient.page).toHaveURL(/#\/home\?section=friends/, { timeout: 30000 });
    assert.equal((await db.collection('friendships').get()).size, previousFriendships + 1);
    assert.deepEqual((await friendship.ref.get()).data(), beforeReplay, 'same-account replay must not rewrite the friendship');
    assert.deepEqual((await invite.ref.get()).data(), redeemed, 'same-account replay must not consume the invite twice');
    await recipient.context.close();
  }
  await inviter.page.getByRole('button', { name: 'Share invite', exact: true }).click();
  await expect(inviter.page.getByText('Invite link copied.', { exact: true })).toBeVisible();
  const sharedUrl = new URL(await inviter.page.evaluate(() => navigator.clipboard.readText()));
  assert.equal(sharedUrl.origin, 'https://allplays.ai', 'local sender shares the real public origin');
  assert.equal(new URLSearchParams(sharedUrl.hash.split('?')[1]).get('code'), code);
  await acceptInvitation(recipientEmail, invite, `${origin}${sharedUrl.pathname}${sharedUrl.search}${sharedUrl.hash}`, 0, true);
  console.log('PASS: modern sender share URL, fresh signup, partial-account retry, real verification and same-account replay.');

  lastPage = inviter.page;
  await inviter.page.goto(`${origin}/profile.html`);
  const legacyRecipientEmail = 'legacy-recipient@example.invalid';
  await expect(inviter.page.locator('#email')).toHaveValue(inviterEmail, { timeout: 30000 });
  await inviter.page.locator('#access-code-email').fill(legacyRecipientEmail);
  await inviter.page.locator('#generate-code-btn').click();
  await expect(inviter.page.locator('#generated-code-text')).toHaveText(/^[A-Z0-9]{8}$/, { timeout: 30000 });
  const firstLegacyCode = await inviter.page.locator('#generated-code-text').innerText();
  await inviter.page.locator('#access-code-email').fill(legacyRecipientEmail);
  await inviter.page.locator('#generate-code-btn').click();
  await expect(inviter.page.locator('#generated-code-text')).not.toHaveText(firstLegacyCode, { timeout: 30000 });
  const legacyCode = await inviter.page.locator('#generated-code-text').innerText();
  assert.match(legacyCode, /^[A-Z0-9]{8}$/);
  assert.ok((await db.doc(`accessCodes/${firstLegacyCode}`).get()).exists);
  await inviter.page.locator('#copy-link-btn').click();
  await expect(inviter.page.locator('#copy-link-btn')).toContainText('Copied Link!');
  const legacySharedUrl = new URL(await inviter.page.evaluate(() => navigator.clipboard.readText()));
  assert.equal(legacySharedUrl.origin, 'https://allplays.ai');
  assert.equal(new URLSearchParams(legacySharedUrl.hash.split('?')[1]).get('code'), legacyCode);
  const legacyInvite = await db.doc(`accessCodes/${legacyCode}`).get();
  assert.equal(legacyInvite.data().type, 'friend_invite');
  assert.equal(legacyInvite.data().email, legacyRecipientEmail);
  assert.equal(legacyInvite.data().generatedBy, 'synthetic-inviter');
  await acceptInvitation(legacyRecipientEmail, legacyInvite, `${origin}${legacySharedUrl.pathname}${legacySharedUrl.search}${legacySharedUrl.hash}`, 1);
  console.log('PASS: unchanged legacy Profile UI generates and regenerates targeted friend codes and copies a public invite link; second recipient completes real signup/verification/redemption/replay.');
  assert.deepEqual(errors, [], 'real app must not throw page errors');
  console.log('PASS: real inviter Profile creates friend code; separate recipient signs up; actual local verification mail/OOB received and opened; verified token redeems invite and creates friendship. Emulator outbox only; no provider delivery or production writes.');
} catch (error) {
  console.error('Synthetic fixture page errors:', errors);
  if (lastPage) console.error('Synthetic fixture UI:', await lastPage.locator('body').innerText().catch(() => 'unavailable'));
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  rmSync(dir, { recursive: true, force: true });
}
