/**
 * Live smoke tests for parent workflows — authenticates with real Firebase credentials
 * and exercises the parent tools hub against the dev server.
 *
 * Requires:
 *   SMOKE_APP_BASE_URL=http://localhost:5174
 *   SMOKE_PARENT_EMAIL
 *   SMOKE_PARENT_PASSWORD
 *
 * Run:
 *   SMOKE_APP_BASE_URL=http://localhost:5174 \
 *     npx playwright test tests/smoke/app-parent-live.spec.js \
 *     --config=playwright.smoke.config.js --reporter=line
 */
import { expect, test } from '@playwright/test';

const appBaseUrl = process.env.SMOKE_APP_BASE_URL || '';
const parentEmail = process.env.SMOKE_PARENT_EMAIL || '';
const parentPassword = process.env.SMOKE_PARENT_PASSWORD || '';
const hasParentCredentials = Boolean(parentEmail && parentPassword);

test.skip(!appBaseUrl, 'SMOKE_APP_BASE_URL is required for live parent smoke tests');
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

function appUrl(baseURL, hashPath) {
    const url = new URL('/', appBaseUrl || baseURL);
    url.hash = hashPath;
    return url.toString();
}

/**
 * Sign in and wait for Firebase auth to fully resolve.
 * The auth route is #/auth; after success the app redirects to /teams (admin) or /home.
 */
async function signIn(page, baseURL) {
    await page.goto(appUrl(baseURL, '/auth'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 15000 });

    const emailField = page.getByLabel('Email');
    const passwordField = page.getByLabel('Password');
    await expect(emailField).toBeVisible({ timeout: 10000 });
    await emailField.fill(parentEmail);
    await passwordField.fill(parentPassword);

    // Click the submit Sign in button (second one, inside the form)
    await page.getByRole('button', { name: 'Sign in' }).last().click();

    // Wait for successful redirect away from /auth AND for the URL to stabilize
    // (the app auto-navigates admin users from /teams → /teams/:teamId after sign-in)
    await expect(async () => {
        const hash = new URL(page.url()).hash;
        expect(hash).not.toMatch(/^#\/(auth|sign-in)/);
    }).toPass({ timeout: 20000 });

    // Allow any post-login navigation effects to settle before the caller navigates
    await page.waitForTimeout(1500);
}

// ---------------------------------------------------------------------------
// BOOT — app loads and renders something sensible
// ---------------------------------------------------------------------------
test('live: app boots without a blank white screen', async ({ page, baseURL }) => {
    await page.goto(appUrl(baseURL, '/auth'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 15000 });
    // Auth page should always be reachable and show sign-in form
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 10000 });
    // No horizontal overflow
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
});

// ---------------------------------------------------------------------------
// AUTH — sign in with email/password completes successfully
// ---------------------------------------------------------------------------
test('live: parent can sign in and land on a protected page', async ({ page, baseURL }) => {
    test.skip(!hasParentCredentials, 'SMOKE_PARENT_EMAIL and SMOKE_PARENT_PASSWORD are required for authenticated parent smoke tests');
    await signIn(page, baseURL);
    const hash = new URL(page.url()).hash;
    // Should land on /teams (admin) or /home or /schedule — never /auth
    expect(hash).not.toMatch(/^#\/(auth|sign-in)/);
    // App shell nav should be present
    await expect(page.locator('nav, [role="navigation"]').first()).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// SCHEDULE — parent can see schedule
// ---------------------------------------------------------------------------
test('live: schedule page boots and shows content without crash', async ({ page, baseURL }) => {
    test.skip(!hasParentCredentials, 'SMOKE_PARENT_EMAIL and SMOKE_PARENT_PASSWORD are required for authenticated parent smoke tests');
    await signIn(page, baseURL);
    await page.goto(appUrl(baseURL, '/schedule'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 15000 });

    await expect(async () => {
        // Could be a schedule heading, empty state, or event cards
        const hasSchedule = await page.getByText(/schedule/i).first().isVisible().catch(() => false);
        const hasContent = await page.locator('[class*="card"],[class*="event"],[class*="game"]').first().isVisible().catch(() => false);
        const hasEmpty = await page.getByText(/no (upcoming|games|events)/i).first().isVisible().catch(() => false);
        expect(hasSchedule || hasContent || hasEmpty).toBe(true);
    }).toPass({ timeout: 20000 });

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
});

// ---------------------------------------------------------------------------
// PARENT TOOLS — access panel renders "Family workflows" heading
// ---------------------------------------------------------------------------
test('live: parent tools access panel boots and shows family workflows heading', async ({ page, baseURL }) => {
    test.skip(!hasParentCredentials, 'SMOKE_PARENT_EMAIL and SMOKE_PARENT_PASSWORD are required for authenticated parent smoke tests');
    await signIn(page, baseURL);
    await page.goto(appUrl(baseURL, '/parent-tools/access'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 15000 });

    await expect(page.getByRole('heading', { name: 'Family workflows' })).toBeVisible({ timeout: 25000 });
    // Access tab should always be present (use aria-pressed to distinguish tab button)
    await expect(page.locator('button[aria-pressed]', { hasText: 'Access' }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
});

// ---------------------------------------------------------------------------
// FEES — fees panel boots
// ---------------------------------------------------------------------------
test('live: parent fees panel boots without error', async ({ page, baseURL }) => {
    test.skip(!hasParentCredentials, 'SMOKE_PARENT_EMAIL and SMOKE_PARENT_PASSWORD are required for authenticated parent smoke tests');
    await signIn(page, baseURL);
    await page.goto(appUrl(baseURL, '/parent-tools/fees'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 15000 });

    // Wait for family workflows heading (parent tools shell)
    await expect(page.getByRole('heading', { name: 'Family workflows' })).toBeVisible({ timeout: 25000 });

    // Fees panel: either fee records, empty state, or access-locked redirect
    await expect(async () => {
        const hasFees = await page.getByText(/fees|team dues|balance/i).first().isVisible().catch(() => false);
        const hasEmpty = await page.getByText(/no (fees|open|dues)/i).first().isVisible().catch(() => false);
        const hasLockedMsg = await page.getByText(/request access|no linked players/i).first().isVisible().catch(() => false);
        const hasLoading = await page.getByText(/loading/i).first().isVisible().catch(() => false);
        expect(hasFees || hasEmpty || hasLockedMsg || hasLoading).toBe(true);
    }).toPass({ timeout: 15000 });

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
});

// ---------------------------------------------------------------------------
// CALENDAR — calendar panel boots
// ---------------------------------------------------------------------------
test('live: parent calendar panel boots without crash', async ({ page, baseURL }) => {
    test.skip(!hasParentCredentials, 'SMOKE_PARENT_EMAIL and SMOKE_PARENT_PASSWORD are required for authenticated parent smoke tests');
    await signIn(page, baseURL);
    await page.goto(appUrl(baseURL, '/parent-tools/calendar'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 15000 });

    await expect(page.getByRole('heading', { name: 'Family workflows' })).toBeVisible({ timeout: 25000 });

    await expect(async () => {
        const hasCalendar = await page.getByText('Calendar tools').isVisible().catch(() => false);
        const hasNoSchedules = await page.getByText('No team schedules').isVisible().catch(() => false);
        const hasDownload = await page.getByRole('button', { name: /download/i }).isVisible().catch(() => false);
        const hasLocked = await page.getByText(/request access/i).first().isVisible().catch(() => false);
        expect(hasCalendar || hasNoSchedules || hasDownload || hasLocked).toBe(true);
    }).toPass({ timeout: 20000 });

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
});

// ---------------------------------------------------------------------------
// SHARE — family share panel boots
// ---------------------------------------------------------------------------
test('live: parent share panel boots without crash', async ({ page, baseURL }) => {
    test.skip(!hasParentCredentials, 'SMOKE_PARENT_EMAIL and SMOKE_PARENT_PASSWORD are required for authenticated parent smoke tests');
    await signIn(page, baseURL);
    await page.goto(appUrl(baseURL, '/parent-tools/share'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 15000 });

    await expect(page.getByRole('heading', { name: 'Family workflows' })).toBeVisible({ timeout: 25000 });

    await expect(async () => {
        const hasShare = await page.getByText('Family share').isVisible().catch(() => false);
        const hasNoLinks = await page.getByText('No family links').isVisible().catch(() => false);
        const hasLocked = await page.getByText(/request access/i).first().isVisible().catch(() => false);
        expect(hasShare || hasNoLinks || hasLocked).toBe(true);
    }).toPass({ timeout: 20000 });
});

// ---------------------------------------------------------------------------
// HOUSEHOLD — household panel boots
// ---------------------------------------------------------------------------
test('live: parent household panel boots without crash', async ({ page, baseURL }) => {
    test.skip(!hasParentCredentials, 'SMOKE_PARENT_EMAIL and SMOKE_PARENT_PASSWORD are required for authenticated parent smoke tests');
    await signIn(page, baseURL);
    await page.goto(appUrl(baseURL, '/parent-tools/household'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 15000 });

    await expect(page.getByRole('heading', { name: 'Family workflows' })).toBeVisible({ timeout: 25000 });
});

// ---------------------------------------------------------------------------
// CERTIFICATES / AWARDS — awards panel boots
// ---------------------------------------------------------------------------
test('live: parent awards panel boots without crash', async ({ page, baseURL }) => {
    test.skip(!hasParentCredentials, 'SMOKE_PARENT_EMAIL and SMOKE_PARENT_PASSWORD are required for authenticated parent smoke tests');
    await signIn(page, baseURL);
    await page.goto(appUrl(baseURL, '/parent-tools/certificates'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 15000 });

    await expect(page.getByRole('heading', { name: 'Family workflows' })).toBeVisible({ timeout: 25000 });

    await expect(async () => {
        const hasAward = await page.getByText(/award|certificate|hustle|no awards|nothing yet/i).first().isVisible().catch(() => false);
        const hasLocked = await page.getByText(/request access/i).first().isVisible().catch(() => false);
        expect(hasAward || hasLocked).toBe(true);
    }).toPass({ timeout: 15000 });
});

// ---------------------------------------------------------------------------
// NAVIGATION — tab switching within parent tools
// ---------------------------------------------------------------------------
test('live: parent tools tab navigation works across tabs', async ({ page, baseURL }) => {
    test.skip(!hasParentCredentials, 'SMOKE_PARENT_EMAIL and SMOKE_PARENT_PASSWORD are required for authenticated parent smoke tests');
    await signIn(page, baseURL);
    await page.goto(appUrl(baseURL, '/parent-tools/access'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Family workflows' })).toBeVisible({ timeout: 25000 });

    const tabsToTest = ['Fees', 'Calendar', 'Awards'];
    for (const tabLabel of tabsToTest) {
        const tab = page.getByRole('button', { name: tabLabel });
        if (await tab.isVisible().catch(() => false)) {
            await tab.click();
            // Loading spinner clears and some heading is visible
            await expect(page.getByRole('heading', { name: 'Family workflows' })).toBeVisible({ timeout: 10000 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
        }
    }
});

// ---------------------------------------------------------------------------
// RSVP — schedule event detail has RSVP section
// ---------------------------------------------------------------------------
test('live: schedule RSVP button opens response panel without crash', async ({ page, baseURL }) => {
    test.skip(!hasParentCredentials, 'SMOKE_PARENT_EMAIL and SMOKE_PARENT_PASSWORD are required for authenticated parent smoke tests');
    await signIn(page, baseURL);
    await page.goto(appUrl(baseURL, '/schedule'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 15000 });

    // Wait for schedule to load
    await expect(async () => {
        const notLoading = await page.getByText('Loading ALL PLAYS').isHidden().catch(() => false);
        expect(notLoading).toBe(true);
        const hasContent = await page.getByRole('heading').first().isVisible().catch(() => false);
        expect(hasContent).toBe(true);
    }).toPass({ timeout: 20000 });

    const rsvpButton = page.getByRole('button', { name: /rsvp|going|attending/i }).first();
    const hasRsvp = await rsvpButton.isVisible({ timeout: 8000 }).catch(() => false);

    if (!hasRsvp) {
        // No upcoming events for this account — skip gracefully
        return;
    }

    await rsvpButton.click();
    await expect(async () => {
        const hasOptions = await page.getByRole('button', { name: /yes|no|maybe|going|not going/i }).first().isVisible().catch(() => false);
        const hasPanel = await page.getByText(/rsvp|attendance|response/i).first().isVisible().catch(() => false);
        expect(hasOptions || hasPanel).toBe(true);
    }).toPass({ timeout: 10000 });

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
});
