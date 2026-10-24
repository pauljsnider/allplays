import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { chromium, webkit, expect } from '@playwright/test';
import { createServer } from '../apps/app/node_modules/vite/dist/node/index.js';
const require = createRequire(import.meta.url);
require('../functions/test/resource-packets-network-guard.cjs');
if (process.env.GCLOUD_PROJECT !== 'demo-allplays-resource' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8280' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9299') throw new Error('Isolated stack required');
const functionsRequire = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = functionsRequire('firebase-admin');
const { Firestore } = functionsRequire('firebase-admin/firestore');
admin.initializeApp({ projectId: 'demo-allplays-resource', credential: { getAccessToken: async () => ({ access_token: 'local-only', expires_in: 3600 }) } });
const db = new Firestore({ projectId: 'demo-allplays-resource' });
const root = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(root, 'apps/app/.resource-browser-'));
let server; let browser; let lastPage;
try {
  for (const uid of ['web-staff', 'web-parent', 'web-other', 'web-player', 'web-guardian']) {
    await admin.auth().createUser({ uid, email: `${uid}@example.invalid`, password: 'LocalBrowserFixture-123!', emailVerified: true });
    await db.doc(`users/${uid}`).set({ active: true, parentTeamIds: ['web-parent', 'web-guardian'].includes(uid) ? ['web-team'] : [], parentPlayerKeys: ['web-parent', 'web-guardian'].includes(uid) ? ['web-team::web-child', 'web-team::web-sibling'] : [] });
  }
  await db.doc('drillLibrary/synthetic-drill').set({ source: 'community', title: 'Balance library drill', description: 'Synthetic balance instruction', youtubeUrl: 'https://example.com/footwork', sport: 'Soccer' });
  await db.doc('teams/web-team').set({ ownerId: 'web-staff', name: 'Synthetic practice team', sport: 'Soccer', active: true, adminEmails: [] });
  for (const id of ['web-child', 'web-sibling']) await db.doc(`teams/web-team/players/${id}`).set({ name: id, active: true });
  await db.doc('teams/web-team/players/web-child').update({ userId: 'web-player' });
  await db.doc('teams/web-team/games/web-practice').set({ type: 'practice', title: 'Synthetic practice', active: true });
  writeFileSync(join(dir, 'firebase.ts'), `
import { initializeApp } from 'firebase/app';
import { initializeAuth, browserLocalPersistence, connectAuthEmulator } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore';
export * from 'firebase/functions'; export * from 'firebase/auth'; export * from 'firebase/firestore'; export * from 'firebase/app'; export * from 'firebase/storage';
import { getStorage } from 'firebase/storage';
const app = initializeApp({ projectId: 'demo-allplays-resource', apiKey: 'local-only', authDomain: 'localhost' });
export const appCheckReady = Promise.resolve(); export const storage = getStorage(app);
export const auth = initializeAuth(app, { persistence: browserLocalPersistence }); connectAuthEmulator(auth, 'http://127.0.0.1:9299', { disableWarnings: true });
export const functions = getFunctions(app); connectFunctionsEmulator(functions, '127.0.0.1', 5201);
export const db = initializeFirestore(app, { experimentalForceLongPolling: true, useFetchStreams: false }); connectFirestoreEmulator(db, '127.0.0.1', 8280);
`);
  writeFileSync(join(dir, 'auth-sdk.ts'), `
import './firebase'; export * from 'firebase/app'; export * from 'firebase/auth';
export const resolvePrimaryFirebaseConfig = async () => ({ projectId: 'demo-allplays-resource', apiKey: 'local-only', authDomain: 'localhost' });
export const initializePrimaryAppCheck = async () => null;
`);
  writeFileSync(join(dir, 'app-check.ts'), `export const initializePrimaryAppCheck = async () => null; export const getPrimaryAppCheckToken = async () => null; export const getPrimaryAppCheckHeaders = async (headers = {}) => headers;`);
  writeFileSync(join(dir, 'images.ts'), `import { storage } from './firebase'; export const imageStorage = storage; export const ensureImageAuth = async () => null; export const requireImageAuth = async () => null;`);
  writeFileSync(join(dir, 'shell.html'), '<html><head><title>Isolated full app QA</title></head><body><div id="root"></div><script type="module" src="/shell.tsx"></script></body></html>');
  writeFileSync(join(dir, 'shell.tsx'), "import '../src/main';");
  // The existing library service is retained; this test adapter uses only local
  // SDK reads and cannot initialize the separate production image project.
  writeFileSync(join(dir, 'drills.ts'), `
import './firebase';
import { getApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore/lite';
const db = getFirestore(getApp()); connectFirestoreEmulator(db, '127.0.0.1', 8280);
export const DRILL_TYPES = []; export const DRILL_LEVELS = [];
export { hasFullTeamAccess } from '@legacy/team-access.js?v=44338';
export const getTeam = async id => ({ id, ...(await getDoc(doc(db, 'teams', id))).data() });
export const getDrill = async id => ({ id, ...(await getDoc(doc(db, 'drillLibrary', id))).data() });
export const getDrillFavorites = async () => [];
export const getDrills = async () => ({ drills: (await getDocs(query(collection(db, 'drillLibrary'), where('source', '==', 'community')))).docs.map(doc => ({ id: doc.id, ...doc.data() })), lastDoc: null });
export const getPublishedDrills = async () => [];
export const addDrillFavorite = async () => { throw new Error('Not used by resource browser tests'); };
export const removeDrillFavorite = addDrillFavorite;
`);
  writeFileSync(join(dir, 'index.html'), '<html><head><title>Isolated practice packet QA</title></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
  writeFileSync(join(dir, 'entry.tsx'), `
import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { auth, signInWithEmailAndPassword } from './firebase';
import { PlayerResourcePackets } from '../src/pages/PlayerResourcePackets';
import { ResourcePackets } from '../src/pages/ResourcePackets';
import { ResourcePacketQueue } from '../src/components/schedule/ResourcePacketQueue';
import '../src/styles/index.css';
function App() {
 const [user, setUser] = useState(null); const [actor, setActor] = useState('web-staff');
 if (!user) return <form onSubmit={async event => { event.preventDefault(); const result = await signInWithEmailAndPassword(auth, actor + '@example.invalid', 'LocalBrowserFixture-123!'); setUser({ uid: result.user.uid, email: result.user.email, displayName: actor, roles: actor === 'web-staff' ? ['coach'] : ['parent'] }); }}><label>Fixture identity<select value={actor} onChange={event => setActor(event.target.value)}>{['web-staff','web-parent','web-other','web-player','web-guardian'].map(id => <option key={id}>{id}</option>)}</select></label><button>Sign in to isolated fixture</button></form>;
 return <MemoryRouter initialEntries={[actor === 'web-player' ? '/practice-resources' : '/teams/web-team/resources']}><Routes><Route path="/practice-resources" element={<PlayerResourcePackets auth={{ user, profile: {}, loading: false }} />} /><Route path="/players/:teamId/:playerId/resources" element={<PlayerResourcePackets auth={{ user, profile: {}, loading: false }} />} /><Route path="/teams/:teamId/resources" element={actor === 'web-staff' ? <ResourcePackets auth={{ user, profile: {}, loading: false }} /> : <ResourcePacketQueue uid={user.uid} children={[{teamId:'web-team',teamName:'Synthetic team',playerId:'web-child',playerName:'web-child'},{teamId:'web-team',teamName:'Synthetic team',playerId:'web-sibling',playerName:'web-sibling'}]} staffTeams={[]} />} /></Routes></MemoryRouter>;
}
createRoot(document.getElementById('root')).render(<App />);
`);
  server = await createServer({ configFile: false, root: dir, define: { 'import.meta.env.VITE_RESOURCE_PACKETS_ENABLED': JSON.stringify('true') }, esbuild: { jsx: 'automatic' }, resolve: { alias: { '@legacy': join(root, 'js') }, dedupe: ['react', 'react-dom'] }, plugins: [{ name: 'isolated-drill-adapter', enforce: 'pre', async resolveId(id, importer) {
 if (/\/adapters\/legacyTeamDrills$/.test(id)) return join(dir, 'drills.ts');
 if (/\/adapters\/legacyFirebaseAuthSdk$/.test(id)) return join(dir, 'auth-sdk.ts');
 if (/(?:^|\/)firebase\.js(?:\?|$)/.test(id)) return join(dir, 'firebase.ts');
 if (/(?:^|\/)firebase-app-check(?:-rest)?\.js(?:\?|$)/.test(id)) return join(dir, 'app-check.ts');
 if (/(?:^|\/)firebase-images\.js(?:\?|$)/.test(id)) return join(dir, 'images.ts');
 const sdk = id.match(/vendor\/firebase-(app|auth|firestore|functions|storage)\.js(?:\?|$)/);
 if (sdk) return this.resolve('firebase/' + sdk[1], join(dir, 'firebase.ts'), { skipSelf: true });
 } }], server: { host: '127.0.0.1', port: 4179, strictPort: true, fs: { allow: [root] } } });
  await server.listen();
  browser = await (process.env.RESOURCE_PACKET_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true });
  const errors = [];
  async function session(actor, viewport = { width: 1280, height: 900 }) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 500, timezoneId: 'America/Chicago' });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'example.com' && url.pathname === '/removed') return route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>Synthetic link unavailable</h1>' });
      if (url.hostname === 'example.com') return route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic external destination</h1>' });
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { errors.push(`Blocked external request: ${url.origin}`); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage(); lastPage = page; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:4179'); await page.getByLabel('Fixture identity').selectOption(actor); await page.getByRole('button', { name: 'Sign in to isolated fixture' }).click();
    return { page, context };
  }
  const staff = await session('web-staff', { width: 390, height: 844 });
  await expect(staff.page.getByRole('heading', { name: 'Assignments', exact: true })).toBeVisible();
  const shareStarted = Date.now();
  await staff.page.getByRole('button', { name: 'Share a video', exact: true }).click();
  await staff.page.getByText('Choose from our library', { exact: true }).click();
  await staff.page.getByLabel('Find a drill').fill('Balance');
  await staff.page.getByRole('button', { name: 'Search library', exact: true }).click();
  await staff.page.getByRole('button', { name: 'Use Balance library drill', exact: true }).click();
  await expect(staff.page.getByLabel('Video link 1')).toHaveValue('https://example.com/footwork');
  await staff.page.getByLabel('Video title 1').fill('Home footwork');
  await staff.page.getByLabel('Coaching note (optional)').fill('Keep your head up.');
  await staff.page.getByText('Whole team', { exact: true }).click();
  await staff.page.getByRole('checkbox', { name: 'web-sibling', exact: true }).uncheck();
  await staff.page.getByLabel('Notify families').uncheck();
  await staff.page.getByRole('button', { name: 'Add another video', exact: true }).click();
  await staff.page.getByLabel('Video link 2').fill('https://example.com/second');
  await staff.page.getByLabel('Video title 2').fill('Second exercise');
  const aiPopupPromise = staff.page.waitForEvent('popup');
  await staff.page.getByRole('link', { name: 'Help me with AI (new tab)', exact: true }).click();
  const aiPopup = await aiPopupPromise;
  await aiPopup.waitForURL(url => url.pathname === '/ai');
  const aiPrompt = new URL(aiPopup.url()).searchParams.get('prompt');
  const aiComposition = JSON.parse(aiPrompt.split('Composition: ')[1]);
  assert.equal(aiComposition.notes, 'Keep your head up.');
  assert.equal(aiComposition.items[1].url, 'https://example.com/second');
  assert.deepEqual(aiComposition.playerIds, ['web-child']);
  assert.equal(aiComposition.notify, false);
  assert.equal((await db.collection('resourcePacketTeams/web-team/assignments').get()).size, 0, 'opening AI must not save or publish');
  await aiPopup.close();
  await staff.page.bringToFront();
  await expect(staff.page.getByLabel('Coaching note (optional)')).toHaveValue('Keep your head up.');
  await expect(staff.page.getByLabel('Video link 2')).toHaveValue('https://example.com/second');
  await expect(staff.page.getByLabel('Notify families')).not.toBeChecked();
  await staff.page.getByRole('button', { name: 'Remove video 2', exact: true }).click();
  await staff.page.getByRole('button', { name: 'Preview family view' }).click();
  await expect(staff.page.getByRole('region', { name: 'Family preview' })).toContainText('Home footwork');
  assert.equal((await db.collection('resourcePacketTeams/web-team/evidence').get()).size, 0, 'preview must not record completion');
  await staff.page.getByRole('button', { name: 'Close preview' }).click();
  await staff.page.getByText('1 player', { exact: true }).click();
  if (process.env.RESOURCE_PACKET_QA_ARTIFACT_DIR) {
    mkdirSync(process.env.RESOURCE_PACKET_QA_ARTIFACT_DIR, { recursive: true });
    await staff.page.screenshot({ path: join(process.env.RESOURCE_PACKET_QA_ARTIFACT_DIR, 'coach-composer.png'), fullPage: true });
  }
  await staff.page.getByRole('button', { name: 'Assign without notifying', exact: true }).click();
  await expect(staff.page.getByRole('status')).toContainText('Assignment shared');
  console.log(`MEASURED automated library-to-assignment journey: ${Date.now() - shareStarted}ms (not a human usability timing).`);
  const parent = await session('web-parent', { width: 390, height: 844 });
  await expect(parent.page.locator('article > h3').filter({ hasText: /^Home footwork$/ })).toBeVisible();
  assert.equal((await db.collection('resourcePacketTeams/web-team/evidence').get()).size, 0, 'render must not record an open');
  const popup = parent.page.waitForEvent('popup');
  await parent.page.getByRole('button', { name: 'Watch', exact: true }).tap();
  await expect((await popup).getByRole('heading', { name: 'Synthetic external destination' })).toBeVisible();
  await expect(parent.page.getByRole('button', { name: 'Watch again' })).toBeVisible();
  await expect(parent.page.getByLabel('We report: watched')).toHaveCount(0);
  const guardian = await session('web-guardian', { width: 390, height: 844 });
  await expect(guardian.page.getByRole('button', { name: 'Watch again' })).toBeVisible();
  await guardian.context.close();
  await parent.page.getByLabel('Child and team').selectOption('web-team::web-sibling');
  await expect(parent.page.getByText('No resource packets assigned to web-sibling.')).toBeVisible();
  await parent.page.getByLabel('Child and team').selectOption('web-team::web-child');
  assert.equal(await parent.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'mobile layout has no horizontal overflow');
  const outsider = await session('web-other'); await expect(outsider.page.getByRole('alert')).toContainText('not linked');
  // Publish, edit, and publish again without losing the returned revision or completion.
  await staff.page.getByRole('button', { name: 'Edit assignment', exact: true }).click();
  // Resource saving can succeed before invalid draft notes fail. Reverting the
  // visible media must restore its original version, not silently select v2.
  await staff.page.getByLabel('Video link 1').fill('https://example.com/partial-replacement');
  await staff.page.getByLabel('Coaching note (optional)').fill('   ');
  await staff.page.getByRole('button', { name: 'Assign without notifying', exact: true }).click();
  await expect(staff.page.getByRole('alert')).toContainText('Enter a valid packet notes.');
  const partialResource = (await db.collection('resourcePacketTeams/web-team/resources').get()).docs[0].data();
  assert.equal(partialResource.url, 'https://example.com/partial-replacement');
  assert.equal(partialResource.version, 2);
  await staff.page.getByLabel('Video link 1').fill('https://example.com/footwork');
  await staff.page.getByLabel('Coaching note (optional)').fill('Corrected coaching instruction.');
  await staff.page.getByRole('button', { name: 'Assign without notifying', exact: true }).click();
  await expect(staff.page.getByRole('status')).toContainText('Assignment shared');
  const revertedAssignment = (await db.collection('resourcePacketTeams/web-team/assignments').get()).docs[0].data();
  assert.equal(revertedAssignment.items[0].url, 'https://example.com/footwork');
  assert.equal(revertedAssignment.items[0].resourceVersion, 1);
  async function refreshParent() {
    await parent.page.reload(); await parent.page.getByLabel('Fixture identity').selectOption('web-parent'); await parent.page.getByRole('button', { name: 'Sign in to isolated fixture' }).click();
  }
  await refreshParent();
  await expect(parent.page.getByText('Corrected coaching instruction.')).toBeVisible();
  await expect(parent.page.getByRole('button', { name: 'Watch again' })).toBeVisible();
  // A concurrent server edit must not trap the existing composer at its old revision.
  await staff.page.getByRole('button', { name: 'Edit assignment', exact: true }).click();
  await staff.page.getByLabel('Coaching note (optional)').fill('Corrected coaching instruction.');
  const concurrentDoc = (await db.collection('resourcePacketTeams/web-team/assignments').get()).docs[0];
  await concurrentDoc.ref.update({ revision: concurrentDoc.data().revision + 1, title: 'Concurrent coach title' });
  await staff.page.getByRole('button', { name: 'Assign without notifying', exact: true }).click();
  await expect(staff.page.getByRole('heading', { name: 'This assignment changed while you were editing' })).toBeVisible();
  await expect(staff.page.getByRole('button', { name: 'Assign without notifying', exact: true })).toBeDisabled();
  if (process.env.RESOURCE_PACKET_QA_ARTIFACT_DIR) {
    await staff.page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await staff.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await staff.page.screenshot({ path: join(process.env.RESOURCE_PACKET_QA_ARTIFACT_DIR, 'assignment-conflict-mobile.png'), fullPage: true });
  }
  await staff.page.getByRole('button', { name: 'Update draft with these choices' }).click();
  await staff.page.getByRole('button', { name: 'Assign without notifying', exact: true }).click();
  await expect(staff.page.getByRole('status')).toContainText('Assignment shared');
  const reconciledAssignment = (await concurrentDoc.ref.get()).data();
  assert.equal(reconciledAssignment.title, 'Concurrent coach title');
  assert.equal(reconciledAssignment.notes, 'Corrected coaching instruction.');
  assert.equal(reconciledAssignment.items[0].resourceVersion, 1);
  console.log('PASS: real callable revision conflict reconciles in place and preserves pinned media.');
  // A material URL replacement needs a new open; unchanged item progress is retained.
  await staff.page.getByRole('button', { name: 'Edit assignment', exact: true }).click();
  await staff.page.getByLabel('Video link 1').fill('https://example.com/removed');
  await staff.page.getByRole('button', { name: 'Add another video' }).click();
  await staff.page.getByLabel('Video link 2').fill('https://example.com/second');
  await staff.page.getByLabel('Video title 2').fill('Second exercise');
  await staff.page.getByText('No due date', { exact: true }).click();
  await staff.page.getByLabel('Due date', { exact: false }).fill('2026-11-10T18:30');
  const send = staff.page.getByRole('button', { name: 'Assign without notifying', exact: true });
  await send.focus(); await staff.page.keyboard.press('Enter');
  await expect(staff.page.getByRole('heading', { name: 'This library video changed while you were editing' })).toBeVisible();
  await staff.page.getByRole('button', { name: 'Keep my video as a separate resource' }).click();
  await send.click();
  await expect(staff.page.getByRole('status')).toContainText('Assignment shared');
  const preservedLibrary = (await db.collection('resourcePacketTeams/web-team/resources').doc(partialResource.resourceId).get()).data();
  assert.equal(preservedLibrary.version, 2);
  assert.equal(preservedLibrary.url, 'https://example.com/partial-replacement');
  await refreshParent();
  await expect(parent.page.getByText(/America\/Chicago/)).toBeVisible();
  await expect(parent.page.getByRole('button', { name: 'Watch', exact: true })).toHaveCount(2);
  const brokenPopup = parent.page.waitForEvent('popup');
  await parent.page.getByRole('button', { name: 'Watch', exact: true }).first().tap();
  await expect((await brokenPopup).getByRole('heading', { name: 'Synthetic link unavailable' })).toBeVisible();
  await expect(parent.page.getByRole('button', { name: 'Watch again' })).toHaveCount(1);
  // A popup blocked by the browser must not record an open.
  const beforeBlocked = (await db.collection('resourcePacketTeams/web-team/evidence').get()).size;
  await parent.page.evaluate(() => { window.__originalOpen = window.open; window.open = () => null; });
  await parent.page.getByRole('button', { name: 'Watch', exact: true }).tap();
  await expect(parent.page.getByRole('alert')).toContainText('Allow');
  assert.equal((await db.collection('resourcePacketTeams/web-team/evidence').get()).size, beforeBlocked);
  await parent.page.evaluate(() => { window.open = window.__originalOpen; });
  await parent.context.setOffline(true);
  await parent.page.getByRole('button', { name: 'Watch', exact: true }).tap();
  await expect(parent.page.getByRole('alert')).toBeVisible();
  await parent.context.setOffline(false);
  const retryPopup = parent.page.waitForEvent('popup');
  await parent.page.getByRole('button', { name: 'Watch', exact: true }).tap();
  await expect((await retryPopup).getByRole('heading', { name: 'Synthetic external destination' })).toBeVisible();
  await expect(parent.page.getByRole('button', { name: 'Watch again' })).toHaveCount(2);
  assert.equal((await db.collection('resourcePacketTeams/web-team/evidence').get()).size, beforeBlocked + 1);
  const playerSession = await session('web-player', { width: 390, height: 844 });
  await playerSession.page.getByRole('link', { name: 'web-child · Synthetic practice team' }).click();
  await expect(playerSession.page.locator('article > h3').filter({ hasText: /^Concurrent coach title$/ })).toBeVisible();
  const playerPopup = playerSession.page.waitForEvent('popup');
  await playerSession.page.getByRole('button', { name: 'Watch again' }).nth(1).tap();
  await expect((await playerPopup).getByRole('heading', { name: 'Synthetic external destination' })).toBeVisible();
  const playerEvidence = (await db.collection('resourcePacketTeams/web-team/evidence').where('actorUid', '==', 'web-player').get()).docs.map(doc => doc.data());
  assert.equal(playerEvidence.length, 1); assert.equal(playerEvidence[0].playerId, 'web-child');
  // Synthetic outbox records only. This browser stack has no provider delivery
  // trigger; the separate trigger suite verifies recipient sinks/idempotency.
  const recoveryAssignmentId = (await db.collection('resourcePacketTeams/web-team/assignments').get()).docs[0].id;
  const pendingDelivery = db.doc('resourcePacketTeams/web-team/outbox/browser-pending');
  const interruptedDelivery = db.doc('resourcePacketTeams/web-team/outbox/browser-interrupted');
  const deliveryFixture = { teamId: 'web-team', assignmentId: recoveryAssignmentId, playerIds: ['web-child'], actorUid: 'web-staff', createdAt: new Date().toISOString() };
  await pendingDelivery.set({ ...deliveryFixture, version: 1, state: 'pending' });
  await interruptedDelivery.set({ ...deliveryFixture, version: 2, state: 'dispatching', attemptedAt: '2020-01-01T00:00:00.000Z' });
  // Refresh staff data and measure the deterministic outstanding-player filter journey.
  await staff.page.reload(); await staff.page.getByLabel('Fixture identity').selectOption('web-staff'); await staff.page.getByRole('button', { name: 'Sign in to isolated fixture' }).click();
  await expect(staff.page.getByText('1 of 1 complete', { exact: true })).toBeVisible();
  await staff.page.setViewportSize({ width: 1280, height: 900 });
  const progressStarted = Date.now();
  await staff.page.getByRole('button', { name: 'View progress' }).click();
  await staff.page.getByRole('button', { name: 'Outstanding (0)' }).click();
  console.log(`MEASURED automated outstanding-player filter journey: ${Date.now() - progressStarted}ms (not a human usability timing).`);
  await staff.page.getByText('Notification status', { exact: true }).click();
  assert.equal((await pendingDelivery.get()).data().retryRequestedAt, undefined, 'viewing status must not retry');
  await staff.page.getByRole('button', { name: 'Retry pending notification', exact: true }).click();
  await expect(staff.page.getByRole('status')).toContainText('Notification recovery checked');
  assert.ok((await pendingDelivery.get()).data().retryRequestedAt);
  await staff.page.getByRole('button', { name: 'Check interrupted delivery (after 15 minutes)', exact: true }).click();
  await expect(staff.page.getByText('Delivery could not be confirmed. It will not be sent again automatically.')).toBeVisible();
  assert.equal((await interruptedDelivery.get()).data().state, 'uncertain');
  await expect(staff.page.getByRole('button', { name: 'Check interrupted delivery (after 15 minutes)', exact: true })).toHaveCount(0);
  if (process.env.RESOURCE_PACKET_FULL_SHELL === '1') {
    const shell = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await shell.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const shellPage = await shell.newPage();
    const shellErrors = [];
    shellPage.on('pageerror', error => shellErrors.push(error.message));
    const assignmentId = (await db.collection('resourcePacketTeams/web-team/assignments').get()).docs[0].id;
    await shellPage.goto(`http://127.0.0.1:4179/shell.html#/players/web-team/web-child/resources?assignmentId=${assignmentId}`);
    await expect(shellPage).toHaveURL(/#\/auth\?next=/);
    await shellPage.getByLabel('Email', { exact: true }).fill('web-player@example.invalid');
    await shellPage.getByLabel('Password', { exact: true }).fill('LocalBrowserFixture-123!');
    await shellPage.locator('button[type="submit"]').filter({ hasText: 'Sign in' }).click();
    await expect(shellPage).toHaveURL(new RegExp(`#\\/players/web-team/web-child/resources\\?assignmentId=${assignmentId}`));
    await expect(shellPage.locator('article > h3').filter({ hasText: /^Concurrent coach title$/ })).toBeVisible();
    assert.deepEqual(shellErrors, [], 'Full app shell must not throw page errors');
    console.log('PASS: full App/Auth shell preserves exact child assignment through sign-in.');
    await shell.close();
    const coachShell = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await coachShell.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const coachPage = await coachShell.newPage();
    coachPage.on('pageerror', error => shellErrors.push(error.message));
    await coachPage.goto('http://127.0.0.1:4179/shell.html#/auth');
    await coachPage.getByLabel('Email', { exact: true }).fill('web-staff@example.invalid');
    await coachPage.getByLabel('Password', { exact: true }).fill('LocalBrowserFixture-123!');
    await coachPage.locator('button[type="submit"]').filter({ hasText: 'Sign in' }).click();
    await expect(coachPage).not.toHaveURL(/#\/auth/);
    await coachPage.goto('http://127.0.0.1:4179/shell.html#/teams/web-team/resources');
    await coachPage.getByRole('button', { name: 'Edit assignment', exact: true }).click();
    await coachPage.getByLabel('Coaching note (optional)').fill('Unsaved full-shell coaching note.');
    const fullAiPopupPromise = coachPage.waitForEvent('popup');
    await coachPage.getByRole('link', { name: 'Help me with AI (new tab)', exact: true }).click();
    const fullAiPage = await fullAiPopupPromise;
    fullAiPage.on('pageerror', error => shellErrors.push(error.message));
    await expect(fullAiPage.getByPlaceholder('Ask ALL PLAYS...')).toHaveValue(/Unsaved full-shell coaching note/);
    await expect(fullAiPage.getByPlaceholder('Ask ALL PLAYS...')).toHaveValue(/explicit confirmation/);
    await fullAiPage.close();
    await coachPage.bringToFront();
    await expect(coachPage.getByLabel('Coaching note (optional)')).toHaveValue('Unsaved full-shell coaching note.');
    assert.equal((await db.collection('resourcePacketTeams/web-team/assignments').get()).docs[0].data().notes, 'Corrected coaching instruction.', 'AI launch must not persist the unsaved note');
    assert.deepEqual(shellErrors, [], 'Full coach/AI shell must not throw page errors');
    console.log('PASS: full authenticated coach shell opens seeded AI and returns to the intact unsaved composer without a write.');
    await coachShell.close();
  }
  if (process.env.RESOURCE_PACKET_QA_ARTIFACT_DIR) {
    mkdirSync(process.env.RESOURCE_PACKET_QA_ARTIFACT_DIR, { recursive: true });
    await staff.page.screenshot({ path: join(process.env.RESOURCE_PACKET_QA_ARTIFACT_DIR, 'coach-resources.png'), fullPage: true });
    await staff.page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await staff.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'mobile progress/recovery layout has no horizontal overflow');
    await staff.page.screenshot({ path: join(process.env.RESOURCE_PACKET_QA_ARTIFACT_DIR, 'coach-progress-mobile.png'), fullPage: true });
    await parent.page.screenshot({ path: join(process.env.RESOURCE_PACKET_QA_ARTIFACT_DIR, 'family-resources.png'), fullPage: true });
    await playerSession.page.screenshot({ path: join(process.env.RESOURCE_PACKET_QA_ARTIFACT_DIR, 'player-resources.png'), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: real-component desktop coach and mobile family flow; draft/publish/click/self-report/sibling isolation/outsider denial; no external network.');
} catch (error) {
  if (lastPage) { console.error('Synthetic fixture state:', await lastPage.locator('body').innerText().catch(() => 'unavailable')); }
  throw error;
} finally { await browser?.close(); await server?.close(); rmSync(dir, { recursive: true, force: true }); }
