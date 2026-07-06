import { expect, test } from '@playwright/test';

const USER_ID = 'owner-1';

function buildTrackingItemsUrl(baseURL) {
    const url = new URL('/tracking-items.html', `${baseURL}/`);
    url.hash = 'teamId=team-1';
    url.searchParams.set('cb', String(Date.now()));
    return url.toString();
}

const DB_STUB = `
export async function getTeam(teamId) {
    return {
        id: teamId,
        name: 'Bears',
        ownerId: '${USER_ID}',
        adminEmails: ['coach@example.com']
    };
}

export async function getUserProfile() {
    return {
        email: 'coach@example.com',
        isAdmin: false
    };
}

export function canModerateChat() {
    return false;
}
`;

const AUTH_STUB = `
export async function requireAuth() {
    return {
        uid: '${USER_ID}',
        email: 'coach@example.com'
    };
}
`;

const FIREBASE_STUB = `
const state = window.__trackingItemsAdminState;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function makeSnapshotDoc(item) {
    return {
        id: item.id,
        data() {
            const { id, ...data } = item;
            return clone(data);
        }
    };
}

export const db = { type: 'mock-firestore' };

export function collection(_db, path) {
    return { path };
}

export function doc(first, ...segments) {
    if (segments.length === 0) {
        const id = 'tracking-item-' + String(state.nextId++);
        return { id, path: first.path + '/' + id };
    }

    const id = segments.at(-1);
    const basePath = first.path ? first.path + '/' : '';
    return { id, path: basePath + segments.join('/') };
}

export async function getDocs(ref) {
    state.getDocsCalls.push(ref.path);
    return {
        docs: state.items.map(makeSnapshotDoc)
    };
}

export async function setDoc(ref, payload) {
    state.setDocCalls.push({ ref: clone(ref), payload: clone(payload) });
    state.items.push({ id: ref.id, ...clone(payload) });
}

export async function updateDoc(ref, payload) {
    state.updateDocCalls.push({ ref: clone(ref), payload: clone(payload) });
    const item = state.items.find((candidate) => candidate.id === ref.id);
    if (item) Object.assign(item, clone(payload));
}

export function serverTimestamp() {
    return '__serverTimestamp__';
}
`;

async function mockTrackingItemsAdminModules(page) {
    await page.addInitScript(() => {
        window.__trackingItemsAdminState = {
            items: [],
            nextId: 1,
            getDocsCalls: [],
            setDocCalls: [],
            updateDocCalls: []
        };
    });

    await page.route(/https:\/\/cdn\.tailwindcss\.com\/.*/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: "window.tailwind = window.tailwind || {}; const style = document.createElement('style'); style.textContent = '.hidden{display:none!important}'; document.head.appendChild(style);"
    }));
    await page.route(/\/js\/telemetry\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ''
    }));
    await page.route(/\/js\/db\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: DB_STUB
    }));
    await page.route(/\/js\/auth\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: AUTH_STUB
    }));
    await page.route(/\/js\/firebase\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: FIREBASE_STUB
    }));
}

test('tracking items admin creates and archives items through the page workflow', async ({ page, baseURL }) => {
    page.on('dialog', async (dialog) => {
        expect(dialog.message()).toBe('Archive "Medical release"?');
        await dialog.accept();
    });

    await mockTrackingItemsAdminModules(page);
    await page.goto(buildTrackingItemsUrl(baseURL), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Tracking checklist items' })).toBeVisible();
    await expect(page.getByText('No active tracking items yet.')).toBeVisible();

    await page.getByRole('button', { name: 'Add new item' }).click();
    await expect(page.locator('#tracking-item-form')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add new item' })).toBeHidden();

    await page.locator('#tracking-item-name').fill('Medical release');
    await page.locator('#tracking-item-description').fill('Upload before the first practice.');
    await page.locator('#tracking-item-visibility').selectOption('public');
    await page.getByRole('button', { name: 'Save item' }).click();

    await expect(page.getByText('Tracking item created.')).toBeVisible();
    await expect(page.locator('#tracking-item-form')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Add new item' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Medical release' })).toBeVisible();

    const setDocCall = await page.evaluate(() => window.__trackingItemsAdminState.setDocCalls[0]);
    expect(setDocCall).toBeDefined();
    expect(setDocCall.ref.path).toBe('teams/team-1/trackingItems/tracking-item-1');
    expect(setDocCall.payload).toMatchObject({
        name: 'Medical release',
        description: 'Upload before the first practice.',
        visibility: 'public',
        status: 'active',
        archived: false,
        active: true,
        teamId: 'team-1',
        createdBy: USER_ID,
        updatedBy: USER_ID
    });
    expect(setDocCall.payload.createdAt).toBe('__serverTimestamp__');
    expect(setDocCall.payload.updatedAt).toBe('__serverTimestamp__');

    await page.getByRole('button', { name: 'Archive' }).click();

    await expect(page.getByText('Tracking item archived.')).toBeVisible();
    await expect(page.getByText('No active tracking items yet.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Medical release' })).toHaveCount(0);

    const updateDocCall = await page.evaluate(() => window.__trackingItemsAdminState.updateDocCalls[0]);
    expect(updateDocCall).toBeDefined();
    expect(updateDocCall.ref.path).toBe('teams/team-1/trackingItems/tracking-item-1');
    expect(updateDocCall.payload).toMatchObject({
        status: 'archived',
        archived: true,
        active: false,
        updatedAt: '__serverTimestamp__',
        updatedBy: USER_ID
    });

    await page.locator('#show-archived-tracking-items').check();
    await expect(page.getByRole('heading', { name: 'Medical release' })).toBeVisible();
    await expect(page.locator('#tracking-items-list').getByText('Archived')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0);
});
