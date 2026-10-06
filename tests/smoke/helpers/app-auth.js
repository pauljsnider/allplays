import { expect } from '@playwright/test';
import { createAppFailureRecorder, routeTimings } from './app-route-diagnostic.js';

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

export function collectAppRuntimeIssues(page, secrets = [], {
    includeApiFailures = false,
    isControlledNavigation = () => false
} = {}) {
    const issues = [];
    const monitoredResourceTypes = new Set(includeApiFailures
        ? ['document', 'script', 'stylesheet', 'xhr', 'fetch', 'image', 'media', 'font']
        : ['document', 'script', 'stylesheet']);
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
        if (!monitoredResourceTypes.has(request.resourceType())) return;
        const errorText = request.failure()?.errorText || 'failed';
        if (/ERR_ABORTED/i.test(errorText) && isControlledNavigation()) return;
        const kind = includeApiFailures ? 'network' : 'asset';
        issues.push(`${kind}:${errorText}:${safeRequestLabel(request.url())}`);
    });
    page.on('response', (response) => {
        if (!monitoredResourceTypes.has(response.request().resourceType())) return;
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

export async function createAuthenticatedAppSession(browser, credentials, { diagnosticTestInfo, sessionIndex = 0 } = {}) {
    const context = await browser.newContext({
        serviceWorkers: 'block',
        recordVideo: undefined
    });
    const page = await context.newPage();
    const issues = collectAppRuntimeIssues(page, [credentials.email, credentials.password]);
    const failureDiagnostic = diagnosticTestInfo
        ? createAppFailureRecorder(page, { includeApiFailures: true, sessionIndex }) : undefined;
    try {
        const timing = await signInToApp(page, credentials);
        // Keep the authenticated context live. Exporting Firebase's IndexedDB-backed
        // persistence can remain pending after Auth and Home are already usable.
        return { context, page, issues, ...timing, failureDiagnostic };
    } catch (error) {
        await failureDiagnostic?.attach(diagnosticTestInfo);
        failureDiagnostic?.dispose();
        await closeBrowserContextBounded(context);
        throw error;
    }
}

export async function createAuthenticatedAppSessions(browser, credentialsList, options = {}) {
    const results = await Promise.allSettled(
        credentialsList.map((credentials, sessionIndex) => createAuthenticatedAppSession(browser, credentials, { ...options, sessionIndex }))
    );
    const sessions = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value);
    const failures = results
        .filter((result) => result.status === 'rejected')
        .map((result) => String(result.reason?.message || result.reason));

    if (failures.length > 0) {
        await Promise.all(sessions.map(async (session) => {
            await session.failureDiagnostic?.attach(options.diagnosticTestInfo);
            await closeAuthenticatedAppSession(session);
        }));
        throw new Error(`Authenticated smoke session setup failed: ${failures.join('; ')}`);
    }
    return sessions;
}

export async function closeAuthenticatedAppSession(session) {
    session?.failureDiagnostic?.dispose();
    if (session?.context) await closeBrowserContextBounded(session.context);
}

export async function assertAuthenticatedAppRoute(page, route, options = {}) {
    const {
        heading,
        forbidden = [/Unable to load/i, /\bnot found\b/i, /temporarily unavailable/i],
        requiredHref = '',
        panelHeading,
        seededFees = false,
        deadline = Date.now() + 25_000
    } = options;
    const remaining = () => {
        const timeout = deadline - Date.now();
        if (timeout <= 0) throw new Error('Authenticated route readiness exceeded its 25-second budget');
        return timeout;
    };
    await expect.poll(() => new URL(page.url()).hash.split('?')[0], { timeout: remaining() }).toBe(`#${route.split('?')[0]}`);
    await expect(page.locator('main')).toBeVisible({ timeout: remaining() });
    if (heading) {
        await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: remaining() });
    } else {
        await expect(page.getByRole('heading').first()).toBeVisible({ timeout: remaining() });
    }
    const timing = routeTimings.get(page);
    if (timing) timing.shellMs = Date.now() - timing.startedAt;
    if (panelHeading) {
        await expect(page.getByRole('heading', { name: panelHeading, exact: true })).toBeVisible({ timeout: remaining() });
        if (timing) timing.panelMs = Date.now() - timing.startedAt;
    }
    if (seededFees) {
        // Fee headers/metrics mount while loading; only a loaded fee card has
        // both Amount and Due. The production smoke parent is fixture-backed.
        const feeCard = page.locator('main section')
            .filter({ has: page.getByText('Amount', { exact: true }) })
            .filter({ has: page.getByText('Due', { exact: true }) }).first();
        await expect(feeCard).toBeVisible({ timeout: remaining() });
        await expect(page.getByText('Loading fees', { exact: true })).not.toBeVisible({ timeout: remaining() });
        await expect(page.locator('main')).not.toContainText('No fees in this view', { timeout: remaining() });
    }
    const body = await page.locator('body').innerText({ timeout: remaining() });
    for (const pattern of forbidden) expect(body).not.toMatch(pattern);
    if (requiredHref) {
        await expect.poll(
            () => page.locator('a').evaluateAll((links, expected) => (
                links.some((link) => String(link.getAttribute('href') || '').includes(String(expected)))
            ), requiredHref),
            {
                timeout: remaining(),
                message: `Expected a meaningful fixture link containing ${requiredHref}`
            }
        ).toBe(true);
    }
}

export async function openAuthenticatedAppRoute(page, appBaseUrl, route, options = {}) {
    const startedAt = Date.now();
    const url = buildAppSmokeUrl(appBaseUrl, route);
    routeTimings.set(page, { url, startedAt });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await assertAuthenticatedAppRoute(page, route, { ...options, deadline: startedAt + 25_000 });
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
