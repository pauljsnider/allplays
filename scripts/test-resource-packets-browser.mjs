import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
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
let server; let browser;
try {
  for (const uid of ['web-staff', 'web-parent', 'web-other', 'web-player']) {
    await admin.auth().createUser({ uid, email: `${uid}@example.invalid`, password: 'LocalBrowserFixture-123!', emailVerified: true });
    await db.doc(`users/${uid}`).set({ active: true, parentTeamIds: uid === 'web-parent' ? ['web-team'] : [], parentPlayerKeys: uid === 'web-parent' ? ['web-team::web-child', 'web-team::web-sibling'] : [] });
  }
  await db.doc('drillLibrary/synthetic-drill').set({ source: 'community', title: 'Balance library drill', description: 'Synthetic balance instruction', youtubeUrl: 'https://example.com/footwork', sport: 'Soccer' });
  await db.doc('teams/web-team').set({ ownerId: 'web-staff', name: 'Synthetic practice team', sport: 'Soccer', active: true, adminEmails: [] });
  for (const id of ['web-child', 'web-sibling']) await db.doc(`teams/web-team/players/${id}`).set({ name: id, active: true });
  await db.doc('teams/web-team/players/web-child').update({ userId: 'web-player' });
  await db.doc('teams/web-team/games/web-practice').set({ type: 'practice', title: 'Synthetic practice', active: true });
  writeFileSync(join(dir, 'firebase.ts'), `
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
export * from 'firebase/functions'; export * from 'firebase/auth'; export * from 'firebase/firestore'; export * from 'firebase/app'; export * from 'firebase/storage';
import { getStorage } from 'firebase/storage';
const app = initializeApp({ projectId: 'demo-allplays-resource', apiKey: 'local-only', authDomain: 'localhost' });
export const appCheckReady = Promise.resolve(); export const storage = getStorage(app);
export const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9299', { disableWarnings: true });
export const functions = getFunctions(app); connectFunctionsEmulator(functions, '127.0.0.1', 5201);
export const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8280);
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
import { db, doc, getDoc, collection, query, where, getDocs } from './firebase';
export const DRILL_TYPES = []; export const DRILL_LEVELS = [];
export const hasFullTeamAccess = (team, user) => team.ownerId === user?.uid;
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
 if (!user) return <form onSubmit={async event => { event.preventDefault(); const result = await signInWithEmailAndPassword(auth, actor + '@example.invalid', 'LocalBrowserFixture-123!'); setUser({ uid: result.user.uid, email: result.user.email, displayName: actor, roles: actor === 'web-staff' ? ['coach'] : ['parent'] }); }}><label>Fixture identity<select value={actor} onChange={event => setActor(event.target.value)}>{['web-staff','web-parent','web-other','web-player'].map(id => <option key={id}>{id}</option>)}</select></label><button>Sign in to isolated fixture</button></form>;
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
  browser = await chromium.launch({ headless: true });
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
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:4179'); await page.getByLabel('Fixture identity').selectOption(actor); await page.getByRole('button', { name: 'Sign in to isolated fixture' }).click();
    return { page, context };
  }
  const staff = await session('web-staff');
  await expect(staff.page.getByRole('heading', { name: '1. Reusable resources' })).toBeVisible();
  await staff.page.getByLabel('Find an existing library drill').fill('Balance');
  await staff.page.getByRole('button', { name: 'Search drill library' }).click();
  await staff.page.getByRole('button', { name: 'Use Balance library drill', exact: true }).click();
  await expect(staff.page.getByLabel('External HTTPS link')).toHaveValue('https://example.com/footwork');
  await staff.page.getByLabel('Title', { exact: true }).fill('Balance exercise');
  await staff.page.getByLabel('External HTTPS link').fill('https://example.com/footwork');
  await staff.page.getByLabel('Teaching point').fill('Keep your knees soft and your head up.');
  await staff.page.getByRole('button', { name: 'Save resource', exact: true }).click();
  await expect(staff.page.getByRole('status').filter({ hasText: 'Resource saved' })).toContainText('Resource saved');
  await staff.page.getByLabel('Packet title').fill('Home footwork');
  await staff.page.getByLabel('Notes for families').fill('Try this together for five minutes.');
  await staff.page.getByRole('checkbox', { name: 'Balance exercise' }).check();
  await staff.page.getByRole('checkbox', { name: 'web-child', exact: true }).check();
  await staff.page.getByLabel('Linked practice (optional)').selectOption('web-practice');
  await staff.page.getByRole('button', { name: 'Save packet draft' }).click();
  await expect(staff.page.getByRole('status').filter({ hasText: 'Draft saved' })).toContainText('Draft saved');
  const parent = await session('web-parent', { width: 390, height: 844 });
  await expect(parent.page.getByText('No resource packets assigned to web-child.')).toBeVisible();
  await staff.page.getByRole('button', { name: 'Review publication' }).click();
  await staff.page.getByRole('button', { name: 'Confirm publish without notification' }).click();
  await expect(staff.page.getByRole('status').filter({ hasText: 'Packet published' })).toContainText('Packet published');
  await parent.page.reload(); await parent.page.getByLabel('Fixture identity').selectOption('web-parent'); await parent.page.getByRole('button', { name: 'Sign in to isolated fixture' }).click();
  await expect(parent.page.getByRole('heading', { name: 'Home footwork' })).toBeVisible();
  assert.equal((await db.collection('resourcePacketTeams/web-team/evidence').get()).size, 0, 'render must not record an open');
  const popup = parent.page.waitForEvent('popup');
  await parent.page.getByRole('button', { name: 'Open link in new tab' }).click();
  await expect((await popup).getByRole('heading', { name: 'Synthetic external destination' })).toBeVisible();
  await expect(parent.page.getByText(/^Link opened /)).toBeVisible();
  await expect(parent.page.getByLabel('We report: watched')).not.toBeChecked();
  await parent.page.getByLabel('We report: practiced').click();
  await expect(parent.page.getByLabel('We report: practiced')).toBeChecked();
  await parent.page.getByLabel('Child and team').selectOption('web-team::web-sibling');
  await expect(parent.page.getByText('No resource packets assigned to web-sibling.')).toBeVisible();
  assert.equal(await parent.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'mobile layout has no horizontal overflow');
  const outsider = await session('web-other'); await expect(outsider.page.getByRole('alert')).toContainText('not linked');
  // Revise a resource and publish a multi-item revision using the real editor.
  await staff.page.getByRole('button', { name: 'Edit Balance exercise · v1' }).click();
  await staff.page.getByLabel('Teaching point').fill('Revised teaching point.');
  await staff.page.getByRole('button', { name: 'Save resource revision' }).click();
  await expect(staff.page.getByRole('status').filter({ hasText: 'Resource saved' })).toContainText('Resource saved');
  await staff.page.getByLabel('Title', { exact: true }).fill('Unavailable external resource');
  await staff.page.getByLabel('External HTTPS link').fill('https://example.com/removed');
  await staff.page.getByLabel('Teaching point').fill('An external destination can disappear; opening is not watching.');
  await staff.page.getByRole('button', { name: 'Save resource', exact: true }).click();
  await expect(staff.page.getByRole('status').filter({ hasText: 'Resource saved' })).toContainText('Resource saved');
  await staff.page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await staff.page.getByRole('checkbox', { name: 'Unavailable external resource' }).check();
  await staff.page.getByLabel('Due date', { exact: false }).fill('2026-11-10T18:30');
  await staff.page.getByRole('button', { name: 'Save packet draft' }).click();
  await expect(staff.page.getByRole('status').filter({ hasText: 'Draft saved' })).toContainText('Draft saved');
  await staff.page.getByRole('button', { name: 'Review publication' }).click();
  const confirm = staff.page.getByRole('button', { name: 'Confirm publish without notification' });
  await confirm.focus(); await staff.page.keyboard.press('Enter');
  await expect(staff.page.getByRole('status').filter({ hasText: 'Packet published' })).toContainText('Packet published');
  await parent.page.reload(); await parent.page.getByLabel('Fixture identity').selectOption('web-parent'); await parent.page.getByRole('button', { name: 'Sign in to isolated fixture' }).click();
  await expect(parent.page.getByText('Revised teaching point.', { exact: true })).toBeVisible();
  await expect(parent.page.getByText(/Version 2.*America\/Chicago/)).toBeVisible();
  await expect(parent.page.getByLabel('We report: practiced').first()).not.toBeChecked();
  const brokenPopup = parent.page.waitForEvent('popup');
  await parent.page.getByRole('button', { name: 'Open link in new tab' }).nth(1).tap();
  await expect((await brokenPopup).getByRole('heading', { name: 'Synthetic link unavailable' })).toBeVisible();
  await expect(parent.page.getByLabel('We report: watched').nth(1)).not.toBeChecked();
  // A disconnected explicit report fails visibly; retry commits one evidence record.
  const beforeOffline = (await db.collection('resourcePacketTeams/web-team/evidence').get()).size;
  await parent.context.setOffline(true);
  await parent.page.getByLabel('We report: practiced').first().tap();
  await expect(parent.page.getByRole('alert')).toBeVisible();
  await parent.context.setOffline(false);
  await parent.page.getByLabel('We report: practiced').first().tap();
  await expect(parent.page.getByLabel('We report: practiced').first()).toBeChecked();
  assert.equal((await db.collection('resourcePacketTeams/web-team/evidence').get()).size, beforeOffline + 1);
  const playerSession = await session('web-player', { width: 390, height: 844 });
  await expect(playerSession.page.getByRole('heading', { name: 'Player practice resources' })).toBeVisible();
  await playerSession.page.getByRole('link', { name: 'web-child · Synthetic practice team' }).click();
  await expect(playerSession.page.getByRole('heading', { name: 'Home footwork' })).toBeVisible();
  await playerSession.page.getByLabel('We report: watched').first().tap();
  await expect(playerSession.page.getByLabel('We report: watched').first()).toBeChecked();
  const playerEvidence = (await db.collection('resourcePacketTeams/web-team/evidence').where('actorUid', '==', 'web-player').get()).docs.map(doc => doc.data());
  assert.equal(playerEvidence.length, 1); assert.equal(playerEvidence[0].playerId, 'web-child');
  if (process.env.RESOURCE_PACKET_FULL_SHELL === '1') {
    const shell = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await shell.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const shellPage = await shell.newPage();
    const shellErrors = [];
    shellPage.on('pageerror', error => shellErrors.push(error.message));
    await shellPage.goto('http://127.0.0.1:4179/shell.html#/auth');
    await shellPage.getByLabel('Email', { exact: true }).fill('web-player@example.invalid');
    await shellPage.getByLabel('Password', { exact: true }).fill('LocalBrowserFixture-123!');
    await shellPage.locator('button[type="submit"]').filter({ hasText: 'Sign in' }).click();
    await shellPage.getByRole('link', { name: 'My player practice resources', exact: true }).click({ timeout: 30000 });
    await shellPage.getByRole('link', { name: 'web-child · Synthetic practice team', exact: true }).click();
    await expect(shellPage.getByRole('heading', { name: 'Home footwork' })).toBeVisible();
    assert.deepEqual(shellErrors, [], 'Full app shell must not throw page errors');
    console.log('PASS: full App/Auth/Home shell sign-in and self-only player discovery into authorized packet queue.');
    await shell.close();
  }
  if (process.env.RESOURCE_PACKET_QA_ARTIFACT_DIR) {
    mkdirSync(process.env.RESOURCE_PACKET_QA_ARTIFACT_DIR, { recursive: true });
    await staff.page.screenshot({ path: join(process.env.RESOURCE_PACKET_QA_ARTIFACT_DIR, 'coach-resources.png'), fullPage: true });
    await parent.page.screenshot({ path: join(process.env.RESOURCE_PACKET_QA_ARTIFACT_DIR, 'family-resources.png'), fullPage: true });
    await playerSession.page.screenshot({ path: join(process.env.RESOURCE_PACKET_QA_ARTIFACT_DIR, 'player-resources.png'), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: real-component desktop coach and mobile family flow; draft/publish/click/self-report/sibling isolation/outsider denial; no external network.');
} finally { await browser?.close(); await server?.close(); rmSync(dir, { recursive: true, force: true }); }
