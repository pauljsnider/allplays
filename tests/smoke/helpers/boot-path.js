import { expect } from '@playwright/test';

const DEFAULT_FATAL_CONSOLE_PATTERNS = [
    /Missing Firebase image config/i,
    /Firebase config request failed/i,
    /Uncaught/i,
    /ReferenceError/i,
    /TypeError/i,
    /Identifier .* has already been declared/i,
    /Failed to fetch dynamically imported module/i
];

const DEFAULT_FORBIDDEN_TEXT_PATTERNS = [
    /Error loading game\./i,
    /Error loading player details/i,
    /Game not found\.?/i,
    /Player not found/i,
    /Team not found/i
];

function toRegExpList(patterns = []) {
    return patterns.map((pattern) => pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i'));
}

function matchesAnyPattern(patterns, text) {
    return patterns.some((pattern) => pattern.test(text));
}

function shouldIgnoreError(patterns, text) {
    return matchesAnyPattern(patterns, text);
}

function isFirebaseInitRequest(urlString) {
    return /\/__(?:\/)?firebase\/init\.json$/.test(urlString);
}

function isAppAssetRequest(urlString, baseURL) {
    const requestUrl = new URL(urlString);
    const appUrl = new URL(baseURL);
    if (requestUrl.origin !== appUrl.origin) {
        return false;
    }

    return requestUrl.pathname === '/' ||
        requestUrl.pathname.endsWith('.html') ||
        requestUrl.pathname.endsWith('.js') ||
        requestUrl.pathname.endsWith('.json') ||
        requestUrl.pathname.startsWith('/js/');
}

export function buildUrl(baseURL, path) {
    const base = new URL(baseURL);
    const relativePath = path.startsWith('/') ? path.slice(1) : path;
    const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
    const url = new URL(relativePath, `${base.origin}${basePath}`);
    url.searchParams.set('cb', String(Date.now()));
    return url.toString();
}

export function createBootIssueCollector(page, options = {}) {
    const {
        baseURL,
        fatalConsolePatterns = DEFAULT_FATAL_CONSOLE_PATTERNS,
        ignoredConsoleErrors = []
    } = options;

    const fatalPatterns = toRegExpList(fatalConsolePatterns);
    const ignoredPatterns = toRegExpList(ignoredConsoleErrors);
    const issues = [];

    page.on('console', (msg) => {
        if (msg.type() !== 'error') {
            return;
        }

        const text = msg.text();
        if (shouldIgnoreError(ignoredPatterns, text)) {
            return;
        }

        if (matchesAnyPattern(fatalPatterns, text)) {
            issues.push(`console:${text}`);
        }
    });

    page.on('pageerror', (error) => {
        const message = error.message || String(error);
        if (shouldIgnoreError(ignoredPatterns, message)) {
            return;
        }

        issues.push(`pageerror:${message}`);
    });

    page.on('requestfailed', (request) => {
        if (!baseURL || !isAppAssetRequest(request.url(), baseURL)) {
            return;
        }

        if (isFirebaseInitRequest(request.url())) {
            return;
        }

        const failure = request.failure();
        issues.push(`requestfailed:${failure?.errorText || 'unknown'}:${request.url()}`);
    });

    page.on('response', (response) => {
        const url = response.url();
        const status = response.status();

        if (isFirebaseInitRequest(url) && status === 404) {
            return;
        }

        if (!baseURL || !isAppAssetRequest(url, baseURL)) {
            return;
        }

        if (status >= 500) {
            issues.push(`response:${status}:${url}`);
            return;
        }

        if (status === 404) {
            issues.push(`response:${status}:${url}`);
        }
    });

    return issues;
}

export async function assertPageBootsWithoutFatalErrors(page, options) {
    const { baseURL, path, titlePatterns, readySelectors = [], forbiddenTexts = [] } = options;
    const issues = createBootIssueCollector(page, options);

    await page.goto(buildUrl(baseURL, path), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    if (titlePatterns) {
        const title = await page.title();
        const matchers = Array.isArray(titlePatterns) ? titlePatterns : [titlePatterns];
        expect(matchers.some((pattern) => pattern.test(title))).toBeTruthy();
    }

    if (readySelectors.length > 0) {
        await Promise.any(
            readySelectors.map((selector) =>
                page.locator(selector).first().waitFor({ state: 'attached', timeout: 10000 })
            )
        );
    }

    const bodyText = await page.locator('body').innerText();
    const forbiddenPatterns = [
        ...DEFAULT_FORBIDDEN_TEXT_PATTERNS,
        ...toRegExpList(forbiddenTexts)
    ];
    forbiddenPatterns.forEach((pattern) => {
        expect(bodyText).not.toMatch(pattern);
    });

    expect(issues).toEqual([]);
}
