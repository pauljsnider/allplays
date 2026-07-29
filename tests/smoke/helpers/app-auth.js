import { expect } from '@playwright/test';

export const AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS = 240_000;
const AUTHENTICATED_CONTEXT_CLOSE_TIMEOUT_MS = 5_000;

const sensitivePatterns = [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    /\b(?:oobCode|code|token|apiKey|recipientId|registrationId)=([^&#\s]+)/gi,
    /\b[A-Za-z0-9_-]{24,}\b/g
];

export function getAppSmokeConfig() {
    return {
        appBaseUrl: process.env.SMOKE_APP_BASE_URL || process.env.SMOKE_APP_BOOT_URL || '',
        adminEmail: process.env.SMOKE_ADMIN_EMAIL || '',
        adminPassword: process.env.SMOKE_ADMIN_PASSWORD || '',
        staffEmail: process.env.SMOKE_STAFF_EMAIL || process.env.SMOKE_AUTH_EMAIL || '',
        staffPassword: process.env.SMOKE_STAFF_PASSWORD || process.env.SMOKE_AUTH_PASSWORD || '',
        parentEmail: process.env.SMOKE_PARENT_EMAIL || process.env.SMOKE_AUTH_EMAIL || '',
        parentPassword: process.env.SMOKE_PARENT_PASSWORD || process.env.SMOKE_AUTH_PASSWORD || '',
        teamId: process.env.SMOKE_TEAM_ID || '',
        playerId: process.env.SMOKE_PLAYER_ID || '',
        gameId: process.env.SMOKE_GAME_ID || '',
        eventId: process.env.SMOKE_EVENT_ID || process.env.SMOKE_GAME_ID || '',
        registrationFormId: process.env.SMOKE_REGISTRATION_FORM_ID || '',
        conversationId: process.env.SMOKE_CONVERSATION_ID || '',
        opportunityListingId: process.env.SMOKE_OPPORTUNITY_LISTING_ID || '',
        opportunityInquiryId: process.env.SMOKE_OPPORTUNITY_INQUIRY_ID || '',
        runId: process.env.SMOKE_RUN_ID || ''
    };
}

export function buildAppSmokeUrl(baseUrl, route = '/auth') {
    const url = new URL(baseUrl);
    if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
    url.search = '';
    url.hash = route.startsWith('/') ? route : `/${route}`;
    return url.toString();
}

export function redactSmokeDiagnostic(value, secrets = []) {
    let redacted = String(value || '');
    for (const secret of secrets) {
        if (secret) redacted = redacted.replaceAll(secret, '[REDACTED]');
    }
    for (const pattern of sensitivePatterns) {
        redacted = redacted.replace(pattern, (match, captured) => (
            captured ? match.replace(captured, '[REDACTED]') : '[REDACTED]'
        ));
    }
    return redacted.slice(0, 600);
}

function safeRequestLabel(requestUrl) {
    try {
        const parsed = new URL(requestUrl);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return '[invalid-url]';
    }
}

function safePageLabel(pageUrl) {
    try {
        const parsed = new URL(pageUrl);
        const route = parsed.hash.split('?')[0];
        return `${parsed.origin}${parsed.pathname}${route}`;
    } catch {
        return '[invalid-url]';
    }
}

export function collectAppRuntimeIssues(page, secrets = []) {
    const issues = [];
    page.on('pageerror', (error) => {
        issues.push(`pageerror:${redactSmokeDiagnostic(error.message, secrets)}`);
    });
    page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (/favicon|ERR_BLOCKED_BY_CLIENT|messaging\/unsupported-browser/i.test(text)) return;
        issues.push(`console:${redactSmokeDiagnostic(text, secrets)}`);
    });
    page.on('requestfailed', (request) => {
        if (!['document', 'script', 'stylesheet'].includes(request.resourceType())) return;
        issues.push(`asset:${request.failure()?.errorText || 'failed'}:${safeRequestLabel(request.url())}`);
    });
    page.on('response', (response) => {
        if (!['document', 'script', 'stylesheet'].includes(response.request().resourceType())) return;
        if (response.status() >= 400) {
            issues.push(`response:${response.status()}:${safeRequestLabel(response.url())}`);
        }
    });
    return issues;
}

export async function signInToApp(page, { appBaseUrl, email, password, roleLabel }) {
    expect(email, `${roleLabel} smoke email is required`).toBeTruthy();
    expect(password, `${roleLabel} smoke password is required`).toBeTruthy();

    let stage = 'opening the sign-in page';
    try {
        await page.goto(buildAppSmokeUrl(appBaseUrl, '/auth'), {
            waitUntil: 'domcontentloaded',
            timeout: 45_000
        });
        stage = 'waiting for the sign-in form';
        await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 30_000 });
        stage = 'filling credentials';
        await page.getByLabel('Email').fill(email, { timeout: 15_000 });
        await page.getByLabel('Password', { exact: true }).fill(password, { timeout: 15_000 });
        const authenticatedHomeStartedAt = Date.now();
        stage = 'submitting credentials';
        await page.getByRole('button', { name: 'Sign in' }).last().click({ timeout: 20_000 });
        stage = 'waiting for the authenticated route';
        await expect.poll(() => new URL(page.url()).hash, {
            message: `${roleLabel} remained in the authentication flow`,
            timeout: 40_000
        }).not.toMatch(/^#\/(?:auth|verify-pending)(?:\?|$)/);
        stage = 'waiting for the authenticated shell';
        await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });
        await page.getByLabel('Password', { exact: true }).fill('').catch(() => {});
        await page.getByLabel('Email').fill('').catch(() => {});
        return { authenticatedHomeStartedAt };
    } catch (error) {
        throw new Error(
            `${roleLabel} smoke authentication failed while ${stage} at ${safePageLabel(page.url())}: ` +
            redactSmokeDiagnostic(error?.message, [email, password])
        );
    }
}

async function closeBrowserContextBounded(context) {
    let timeoutId;
    await Promise.race([
        context.close().catch(() => {}),
        new Promise((resolve) => {
            timeoutId = setTimeout(resolve, AUTHENTICATED_CONTEXT_CLOSE_TIMEOUT_MS);
        })
    ]);
    clearTimeout(timeoutId);
}

export async function createAuthenticatedAppSession(browser, credentials) {
    const context = await browser.newContext({
        serviceWorkers: 'block',
        recordVideo: undefined
    });
    const page = await context.newPage();
    const issues = collectAppRuntimeIssues(page, [credentials.email, credentials.password]);
    try {
        const timing = await signInToApp(page, credentials);
        // Keep the authenticated context live. Exporting Firebase's IndexedDB-backed
        // persistence can remain pending after Auth and Home are already usable.
        return { context, page, issues, ...timing };
    } catch (error) {
        await closeBrowserContextBounded(context);
        throw error;
    }
}

export async function createAuthenticatedAppSessions(browser, credentialsList) {
    const results = await Promise.allSettled(
        credentialsList.map((credentials) => createAuthenticatedAppSession(browser, credentials))
    );
    const sessions = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value);
    const failures = results
        .filter((result) => result.status === 'rejected')
        .map((result) => String(result.reason?.message || result.reason));

    if (failures.length > 0) {
        await Promise.all(sessions.map((session) => closeBrowserContextBounded(session.context)));
        throw new Error(`Authenticated smoke session setup failed: ${failures.join('; ')}`);
    }
    return sessions;
}

export async function closeAuthenticatedAppSession(session) {
    if (session?.context) await closeBrowserContextBounded(session.context);
}

export async function assertAuthenticatedAppRoute(page, route, options = {}) {
    const {
        heading,
        forbidden = [/Unable to load/i, /\bnot found\b/i, /temporarily unavailable/i],
        requiredHref = ''
    } = options;
    await expect.poll(() => new URL(page.url()).hash, { timeout: 20_000 }).toContain(`#${route.split('?')[0]}`);
    await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });
    if (heading) {
        await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 25_000 });
    } else {
        await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 25_000 });
    }
    const body = await page.locator('body').innerText();
    for (const pattern of forbidden) expect(body).not.toMatch(pattern);
    if (requiredHref) {
        const found = await page.locator('a').evaluateAll((links, expected) => (
            links.some((link) => String(link.getAttribute('href') || '').includes(String(expected)))
        ), requiredHref);
        expect(found, `Expected a meaningful fixture link containing ${requiredHref}`).toBe(true);
    }
}

export async function openAuthenticatedAppRoute(page, appBaseUrl, route, options = {}) {
    await page.goto(buildAppSmokeUrl(appBaseUrl, route), { waitUntil: 'domcontentloaded' });
    await assertAuthenticatedAppRoute(page, route, options);
}

export async function assertNotificationInbox(page) {
    await page.getByRole('button', { name: 'Notifications' }).first().click();
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 15_000 });
    const inbox = page.getByRole('dialog', { name: 'Notifications' });
    await expect(inbox).toBeVisible();
    await expect(
        inbox.locator('li').first(),
        'The smoke account must have a seeded notification with a meaningful app deep link'
    ).toBeVisible({ timeout: 20_000 });
    await expect(inbox).not.toContainText('No notifications yet');
}
