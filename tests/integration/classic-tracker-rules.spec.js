import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc } from 'firebase/firestore';
import contextCore from '../../functions/delegated-team-context-core.cjs';

// Never point this harness at a real project or silently omit the rules engine.
const projectId = 'demo-allplays-classic-contract';
const address = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^127\.0\.0\.1:\d+$/.test(address)) {
    throw new Error('Set FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> for this demo-only contract.');
}
const port = Number(address.split(':')[1]);
const gamePath = 'teams/team-1/games/game-1';
const trackerUrl = '/track-live.html#teamId=team-1&gameId=game-1';
let env;

async function privileged(callback) {
    let result;
    await env.withSecurityRulesDisabled(async context => { result = await callback(context.firestore()); });
    return result;
}
async function read(path) {
    return privileged(async (db) => (await getDoc(doc(db, path))).data() || null);
}
const callable = contextCore.createDelegatedTeamContextHandler({
    loadTeam: id => read(`teams/${id}`),
    loadUser: id => read(`users/${id}`),
    loadGame: (team, game) => read(`teams/${team}/games/${game}`),
    loadRsvp: (team, game, uid) => read(`teams/${team}/games/${game}/rsvps/${uid}`),
    makeError: (code, message) => Object.assign(new Error(message), { code })
});

test.beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId, firestore: {
        host: '127.0.0.1', port, rules: readFileSync('firestore.rules', 'utf8')
    } });
});
test.afterAll(async () => { await env?.cleanup(); });

async function seed(count = 41, { reset = false, legacy = false } = {}) {
    await env.clearFirestore();
    await privileged(async db => {
        const writes = [
            setDoc(doc(db, 'teams/team-1'), { name: 'Contract Comets', sport: 'Basketball',
                ownerId: 'owner', adminEmails: ['staff@example.com'], isPublic: true, active: true,
                teamPermissions: { scorekeeping: { mode: 'selected', memberIds: ['delegate'] } } }),
            setDoc(doc(db, gamePath), { opponent: 'Rockets', type: 'game', status: 'scheduled',
                liveStatus: 'live', visibility: 'private', shareable: false, trackingEngine: 'legacy',
                date: new Date('2026-10-01T12:00:00Z'), statTrackerConfigId: 'config-1',
                homeScore: 3, awayScore: 5, liveViewerCount: 2, liveClockMs: 60000, liveClockRunning: false,
                opponentStats: { opp1: { name: 'Opponent', number: '1', pts: 5 } } }),
            setDoc(doc(db, 'teams/team-1/statTrackerConfigs/config-1'), {
                name: 'Basketball', baseType: 'Basketball', columns: ['PTS'] }),
            setDoc(doc(db, `${gamePath}/liveChat/message-1`), { text: 'Existing chat survives startup',
                senderId: 'owner', senderName: 'Coach', createdAt: new Date('2026-10-01T12:00:00Z') })
        ];
        for (const uid of ['owner', 'staff', 'delegate', 'outsider']) {
            writes.push(setDoc(doc(db, `users/${uid}`), { isAdmin: false, email: `${uid}@example.com` }));
        }
        for (let i = 1; i <= 15; i++) {
            writes.push(setDoc(doc(db, `teams/team-1/players/p${i}`), { name: `Player ${i}`, number: String(i), active: true }));
            writes.push(setDoc(doc(db, `${gamePath}/aggregatedStats/p${i}`), {
                playerName: `Player ${i}`, playerNumber: String(i), stats: { pts: i === 1 ? 3 : 0 } }));
        }
        for (let i = 0; i < count; i++) {
            const event = { type: 'stat', description: `History ${String(i).padStart(3, '0')}`,
                playerId: 'p1', statKey: 'pts', value: 1, period: 'Q1', gameClock: '1:00',
                createdAt: new Date('2026-10-01T12:00:00Z') };
            if (reset && i === 20) event.type = 'reset';
            if (reset && i === 40) Object.assign(event, { type: 'undo', description: 'Undo: History 039' });
            writes.push(setDoc(doc(db, `${gamePath}/liveEvents/event-${String(i).padStart(3, '0')}`), event));
        }
        if (legacy) for (let i = 0; i < 8; i++) {
            writes.push(setDoc(doc(db, `${gamePath}/events/legacy-${i}`), { type: 'goal', value: 1 }));
        }
        await Promise.all(writes);
    });
}

async function boot(page, uid = 'owner', { revokeAfterPage = false, acceptConfirm = false } = {}) {
    const user = uid ? { uid, email: `${uid}@example.com`, emailVerified: true, displayName: uid } : null;
    await page.addInitScript(() => {
        const add = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (type, callback, options) {
            if (this.id === 'startBtn' && type === 'click') {
                return add.call(this, type, function (event) {
                    window.__startCompletion = Promise.resolve(callback.call(this, event));
                    return window.__startCompletion;
                }, options);
            }
            return add.call(this, type, callback, options);
        };
    });
    const alerts = [];
    const errors = [];
    page.on('dialog', async dialog => {
        if (dialog.type() === 'beforeunload' || (dialog.type() === 'confirm' && acceptConfirm)) return dialog.accept();
        alerts.push(dialog.message());
        await dialog.dismiss();
    });
    page.on('pageerror', error => { errors.push(error.message); console.error('Browser fatal:', error.message); });
    page.on('console', message => { if (message.type() === 'error') console.error('Browser console:', message.text()); });
    await page.exposeFunction('__contractCallable', async (name, data) => {
        try {
            if (name !== 'getDelegatedTeamContext') throw Object.assign(new Error('Unsupported callable'), { code: 'permission-denied' });
            return { data: await callable(data, { auth: user ? { uid, token: { email: user.email } } : null }) };
        } catch (error) { return { error: { code: `functions/${error.code}`, message: error.message } }; }
    });
    await page.exposeFunction('__afterLivePage', async () => {
        if (revokeAfterPage) await privileged(db => updateDoc(doc(db, 'teams/team-1'), {
            ownerId: 'another-owner', adminEmails: [], 'teamPermissions.scorekeeping.memberIds': []
        }));
    });
    // The actual page, db.js and vendored SDK run unchanged. Only environment,
    // identity, callable transport and unrelated chrome are adapted for local QA.
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1') {
            if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'text/javascript', body: 'window.tailwind = {};' });
            return route.abort();
        }
        if (url.pathname === '/js/firebase.js') return route.fulfill({ contentType: 'text/javascript', body: `
            import { initializeApp } from '/js/vendor/firebase-app.js';
            import { getFirestore, connectFirestoreEmulator, getDocs as sdkGetDocs } from '/js/vendor/firebase-firestore.js';
            export * from '/js/vendor/firebase-firestore.js';
            export * from '/js/vendor/firebase-storage.js';
            const app = initializeApp({ projectId: '${projectId}', apiKey: 'demo-only', appId: 'demo-only' });
            export const db = getFirestore(app);
            connectFirestoreEmulator(db, '127.0.0.1', ${port}, ${user ? JSON.stringify({ mockUserToken: { sub: uid, email: user.email, email_verified: true } }) : '{}'});
            export const auth = { currentUser: ${JSON.stringify(user)} };
            export const storage = null;
            export const functions = {};
            export const httpsCallable = (_, name) => async data => {
                const result = await window.__contractCallable(name, data);
                if (result.error) throw Object.assign(new Error(result.error.message), result.error);
                return result;
            };
            window.__livePages = [];
            export async function getDocs(q) {
                const snapshot = await sdkGetDocs(q);
                if (snapshot.docs[0]?.ref.path.includes('/liveEvents/')) {
                    window.__livePages.push(snapshot.docs.map(d => d.id));
                    if (window.__livePages.length === 1) await window.__afterLivePage();
                }
                return snapshot;
            }
        ` });
        if (url.pathname === '/js/auth.js') return route.fulfill({ contentType: 'text/javascript', body: `export function checkAuth(callback) { callback(${JSON.stringify(user)}); }` });
        if (url.pathname === '/js/firebase-images.js') return route.fulfill({ contentType: 'text/javascript', body: 'export const imageStorage = null; export async function ensureImageAuth() {} export async function requireImageAuth() {}' });
        if (url.pathname === '/js/telemetry.js') return route.fulfill({ contentType: 'text/javascript', body: '' });
        if (url.pathname === '/js/utils.js') return route.fulfill({ contentType: 'text/javascript', body: `
            export function renderHeader() {} export function renderFooter() {}
            export function getUrlParams() { return Object.fromEntries(new URLSearchParams(location.hash.slice(1))); }
            export function escapeHtml(value) { const e = document.createElement('span'); e.textContent = String(value ?? ''); return e.innerHTML; }
            export function resolveZip() { throw new Error('ZIP export is outside this contract'); }
        ` });
        if (url.pathname === '/app/') return route.fulfill({ body: 'Local authentication destination' });
        return route.continue();
    });
    await page.goto(trackerUrl);
    return { alerts, errors };
}

async function assertReady(page, diagnostics) {
    await expect(page.locator('#statsTableBody tr')).toHaveCount(15);
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect(page.locator('#away-score')).toHaveText('5');
    await expect(page.locator('#chat-messages')).toContainText('Existing chat survives startup');
    await expect(page.locator('#chat-viewer-count')).toContainText('2');
    expect(diagnostics.alerts).toEqual([]);
    expect(diagnostics.errors).toEqual([]);
}

for (const count of [0, 20, 21, 40, 41]) {
    test(`Classic boots with ${count} tied events and preserves all history`, async ({ page }) => {
        await seed(count);
        const diagnostics = await boot(page);
        await assertReady(page, diagnostics);
        await expect(page.locator('#gameLog .undo-log-btn')).toHaveCount(count);
        const ids = await page.evaluate(() => window.__livePages.flat());
        expect(ids).toHaveLength(count);
        expect(new Set(ids).size).toBe(count);
        expect(await page.evaluate(() => window.__livePages.every(rows => rows.length <= 20))).toBe(true);
    });
}

for (const uid of ['owner', 'staff', 'delegate']) {
    test(`${uid} can resume, score, persist and reload through real rules`, async ({ page }) => {
        await seed(41, { reset: true });
        const diagnostics = await boot(page, uid);
        await assertReady(page, diagnostics);
        await expect(page.locator('#gameLog .undo-log-btn')).toHaveCount(18);
        await expect(page.locator('#gameLog')).toContainText('History 021');
        await expect(page.locator('#gameLog')).not.toContainText('History 039');
        await expect(page.locator('#gameLog')).not.toContainText('History 019');
        await page.locator(`[onclick="incrementStat('p1', 'pts', 1, false)"]`).click();
        await expect.poll(async () => (await read(gamePath)).homeScore).toBe(4);
        await expect.poll(async () => (await read(`${gamePath}/aggregatedStats/p1`)).stats.pts).toBe(4);
        await page.reload();
        await expect(page.locator('#statsTableBody tr')).toHaveCount(15);
        await expect(page.locator('#home-score')).toHaveText('4');
        await expect(page.locator('#chat-messages')).toContainText('Existing chat survives startup');
        await expect(page.locator('#gameLog .undo-log-btn')).toHaveCount(19);
        await page.locator('#gameLog .undo-log-btn').first().click();
        await expect.poll(async () => (await read(gamePath)).homeScore).toBe(3);
        await expect.poll(async () => (await read(`${gamePath}/aggregatedStats/p1`)).stats.pts).toBe(3);
        await page.reload();
        await expect(page.locator('#home-score')).toHaveText('3');
        await expect(page.locator('#gameLog')).not.toContainText('#1 Player 1 +1 PTS');
        expect(diagnostics.alerts).toEqual([]);
        expect(diagnostics.errors).toEqual([]);
    });
}

test('real rules reject unbounded/oversized queries even for owner, and private reads/writes for outsiders', async () => {
    await seed();
    const owner = env.authenticatedContext('owner', { email: 'owner@example.com', email_verified: true }).firestore();
    const events = collection(owner, `${gamePath}/liveEvents`);
    await assertFails(getDocs(query(events, orderBy('createdAt', 'asc'))));
    await assertFails(getDocs(query(events, orderBy('createdAt', 'asc'), limit(21))));
    for (const db of [env.unauthenticatedContext().firestore(), env.authenticatedContext('outsider', { email: 'outsider@example.com', email_verified: true }).firestore()]) {
        await assertFails(getDocs(query(collection(db, `${gamePath}/liveEvents`), limit(20))));
        await assertFails(updateDoc(doc(db, gamePath), { homeScore: 999 }));
    }
});

test('signed-out Classic redirects to auth', async ({ page }) => {
    await seed();
    await boot(page, null);
    await expect(page).toHaveURL(/\/app\/#\/auth$/);
});

test('outsider cannot initialize private game scoring', async ({ page }) => {
    await seed();
    const diagnostics = await boot(page, 'outsider');
    await expect.poll(() => diagnostics.alerts.length).toBeGreaterThan(0);
    await expect(page.locator('#statsTableBody tr')).toHaveCount(0);
    expect((await read(gamePath)).homeScore).toBe(3);
});

test('revocation between pages fails closed without partial history or score changes', async ({ page }) => {
    await seed();
    const diagnostics = await boot(page, 'delegate', { revokeAfterPage: true });
    await expect.poll(() => diagnostics.alerts).toContain('Error loading game data.');
    await expect(page.locator('#gameLog .undo-log-btn')).toHaveCount(0);
    await expect(page.locator('#statsTableBody tr')).toHaveCount(0);
    expect((await read(gamePath)).homeScore).toBe(3);
});

test('legacy report events are not invented as live history', async ({ page }) => {
    await seed(0, { legacy: true });
    await assertReady(page, await boot(page));
    await expect(page.locator('#gameLog')).toContainText('Game log will appear here');
    expect(await read(`${gamePath}/events/legacy-7`)).toEqual({ type: 'goal', value: 1 });
});

// Existing zero-score records require confirmation before resuming.
for (const uid of ['owner', 'staff']) {
test(`${uid} Resume preserves existing zero-score tracked data and starts timer`, async ({ page }) => {
    await seed(0);
    await privileged(async db => {
        await updateDoc(doc(db, gamePath), { homeScore: 0, awayScore: 0, liveClockMs: 0 });
        await updateDoc(doc(db, `${gamePath}/aggregatedStats/p1`), { 'stats.pts': 0 });
    });
    const diagnostics = await boot(page, uid, { acceptConfirm: true });
    await expect(page.locator('#statsTableBody tr')).toHaveCount(15);
    await page.locator('#startBtn').click();
    await expect(page.locator('#startBtn')).toBeDisabled();
    await expect.poll(async () => (await read(gamePath)).liveClockRunning).toBe(true);
    expect((await read(`${gamePath}/aggregatedStats/p1`)).stats.pts).toBe(0);
    expect(diagnostics.errors).toEqual([]);
});
}

for (const uid of ['owner', 'staff', 'delegate']) {
    // Runs the exact page-owned read expression against the real browser SDK and
    // rules. AI extraction/upload/replacement writes are intentionally separate.
    test(`${uid} stat-sheet existing-live-history preflight uses an allowed query`, async ({ page }) => {
        await seed(41);
        await assertReady(page, await boot(page, uid));
        const source = readFileSync('track-statsheet.html', 'utf8');
        const expression = source.match(/const liveEventsSnap = (await getDocs\([^;]+\));/)[1];
        const count = await page.evaluate(async expression => {
            const sdk = await import('/js/firebase.js?v=33');
            const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
            return new AsyncFunction('db', 'getDocs', 'collection', 'query', 'limit', 'currentTeamId', 'currentGameId',
                `return (${expression}).size;`)(sdk.db, sdk.getDocs, sdk.collection, sdk.query, sdk.limit, 'team-1', 'game-1');
        }, expression);
        expect(count).toBe(1);
    });
}


async function persistedGameSnapshot() {
    return privileged(async db => ({
        game: (await getDoc(doc(db, gamePath))).data(),
        collections: await Promise.all(['aggregatedStats', 'events', 'liveEvents'].map(async name => {
            const snapshot = await getDocs(collection(db, `${gamePath}/${name}`));
            return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
        }))
    }));
}

for (const uid of ['owner', 'staff', 'delegate']) {
    test(`${uid} Cancel at existing-data preflight leaves all state unchanged`, async ({ page }) => {
        await seed(0, { legacy: true });
        await privileged(async db => {
            await updateDoc(doc(db, gamePath), { homeScore: 0, awayScore: 0, liveClockMs: 0 });
            await updateDoc(doc(db, `${gamePath}/aggregatedStats/p1`), { 'stats.pts': 0, 'stats.fouls': 2 });
        });
        const diagnostics = await boot(page, uid); // Dismiss the confirmation = Cancel.
        await expect(page.locator('#statsTableBody tr')).toHaveCount(15);
        const before = await persistedGameSnapshot();
        const logBefore = await page.locator('#gameLog').innerHTML();
        const rosterBefore = await page.locator('#statsTableBody').innerHTML();
        await page.locator('#startBtn').click();
        await page.evaluate(async () => await window.__startCompletion);
        expect.soft(await persistedGameSnapshot()).toEqual(before);
        await expect.soft(page.locator('#startBtn')).toBeEnabled();
        expect.soft(await page.locator('#gameLog').innerHTML()).toBe(logBefore);
        expect.soft(await page.locator('#statsTableBody').innerHTML()).toBe(rosterBefore);
        await expect(page.locator('#home-score')).toHaveText('0');
        expect(diagnostics.alerts).toEqual(['This game already has tracked data. Continue where you left off?\n\nCancel leaves existing data unchanged.']);
        expect(diagnostics.errors).toEqual([]);
    });
}


for (const uid of ['owner', 'staff']) {
    test(`${uid} genuinely empty game starts without a confirmation and persists clock`, async ({ page }) => {
        await seed(0);
        await privileged(async db => {
            for (const name of ['events', 'aggregatedStats', 'liveEvents']) {
                const snapshot = await getDocs(collection(db, `${gamePath}/${name}`));
                await Promise.all(snapshot.docs.map(item => deleteDoc(item.ref)));
            }
            await updateDoc(doc(db, gamePath), { homeScore: 0, awayScore: 0, liveClockMs: 0,
                liveClockRunning: false, opponentStats: {}, liveHasData: false, liveStatus: 'scheduled' });
        });
        const before = await persistedGameSnapshot();
        expect(before.collections).toEqual([[], [], []]);
        const diagnostics = await boot(page, uid);
        await expect(page.locator('#statsTableBody tr')).toHaveCount(15);
        await page.locator('#startBtn').click();
        await page.evaluate(async () => await window.__startCompletion);
        await expect(page.locator('#startBtn')).toBeDisabled();
        await expect.poll(async () => (await read(gamePath)).liveClockRunning).toBe(true);
        await expect.poll(async () => (await read(gamePath)).liveStatus).toBe('live');
        expect(diagnostics.alerts).toEqual([]);
        expect(diagnostics.errors).toEqual([]);
    });
}
