import { expect, test } from '@playwright/test';

// Exercise the real legacy page and database function, replacing only I/O.
test('legacy Profile generates an email-only friend invite and copies its public link', async ({ page, baseURL }) => {
    const { readFileSync } = await import('node:fs');
    const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
    const firebaseNames = dbSource.match(/^import \{([\s\S]*?)\} from '\.\/firebase\.js\?v=\d+';/)[1]
        .split(',').map((name) => name.trim()).filter(Boolean);
    const fixtures = {
        db: '{}', storage: '{}', functions: '{}',
        auth: '{ currentUser: { uid: "sender-1", email: "sender@example.com", emailVerified: true } }',
        doc: '(_db, ...parts) => ({ id: parts.at(-1), path: parts.join("/") })',
        getDoc: 'async () => ({ exists: () => true, data: () => ({ displayName: "Invite Sender", parentTeamIds: ["team-1"], hasPassword: true }) })',
        getDocs: 'async () => ({ docs: [], empty: true, size: 0, forEach() {} })',
        httpsCallable: '() => async () => ({ data: { teams: [] } })',
        Timestamp: '{ now: () => new Date(), fromMillis: (value) => new Date(value) }',
        runTransaction: `async (_db, work) => work({
            get: async () => ({ exists: () => false }),
            set: (reference, payload) => window.__inviteWrites.push({ reference, payload })
        })`
    };
    const firebaseMock = firebaseNames.map((name) => `export const ${name} = ${fixtures[name] || '() => ({})'};`).join('\n');
    const localOrigin = new URL(baseURL).origin;
    await page.route('**/*', (route) => new URL(route.request().url()).origin === localOrigin
        ? route.continue() : route.abort('blockedbyclient'));
    await page.route('https://cdn.tailwindcss.com/**', (route) => route.fulfill({
        contentType: 'text/javascript', body: 'window.tailwind = {};'
    }));
    const mockModule = (name, body) => page.route(new RegExp(`/js/${name}\\.js(?:\\?.*)?$`), (route) => route.fulfill({
        contentType: 'text/javascript', body
    }));
    await mockModule('firebase', firebaseMock);
    await mockModule('firebase-images', 'export const imageStorage = {}; export const ensureImageAuth = async () => {}; export const requireImageAuth = async () => {};');
    await mockModule('utils', 'export const renderHeader = () => {}; export const renderFooter = () => {}; export const escapeHtml = (value) => String(value || ""); export const resolveZip = async () => null;');
    await mockModule('auth', `export const checkAuth = (callback) => callback({ uid: 'sender-1', email: 'sender@example.com', emailVerified: true });
        export const setUserPassword = async () => {}; export const resendVerificationEmail = async () => {};`);
    await mockModule('push-notifications', 'export const registerPushNotifications = async () => null;');
    await page.addInitScript(() => {
        window.__inviteWrites = [];
        window.__copiedInvite = '';
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.__copiedInvite = text; } } });
    });
    await page.goto(new URL('/profile.html', baseURL).toString(), { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: '.hidden { display: none; }' });
    await expect(page.locator('#email')).toHaveValue('sender@example.com');
    await page.locator('#access-code-email').fill('friend@example.com');
    await expect(page.locator('#access-code-phone')).toHaveValue('');
    await page.locator('#generate-code-btn').click();
    await expect(page.locator('#generated-code-display')).toBeVisible();
    await expect(page.locator('#generate-status')).toBeEmpty();
    const writes = await page.evaluate(() => window.__inviteWrites);
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toMatchObject({ type: 'friend_invite', email: 'friend@example.com', phone: null });
    expect(writes[0].payload.code).toMatch(/^[A-Z0-9]{8}$/);
    await page.locator('#copy-link-btn').click();
    await expect.poll(() => page.evaluate(() => window.__copiedInvite)).toBe(
        `https://allplays.ai/app/#/accept-invite?code=${writes[0].payload.code}&type=friend`
    );
});
