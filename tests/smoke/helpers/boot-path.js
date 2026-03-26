import { expect } from '@playwright/test';

const DEFAULT_FATAL_CONSOLE_PATTERNS = [
    /Missing Firebase image config/i,
    /Firebase config request failed/i,
    /Uncaught/i
];

function toRegExpList(patterns = []) {
    return patterns.map((pattern) => pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i'));
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
    const url = new URL(path, `${baseURL}/`);
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
        if (ignoredPatterns.some((pattern) => pattern.test(text))) {
            return;
        }

        if (fatalPatterns.some((pattern) => pattern.test(text))) {
            issues.push(`console:${text}`);
        }
    });

    page.on('pageerror', (error) => {
        issues.push(`pageerror:${error.message}`);
    });

    page.on('requestfailed', (request) => {
        if (!baseURL || !isAppAssetRequest(request.url(), baseURL)) {
            return;
        }

        const failure = request.failure();
        issues.push(`requestfailed:${failure?.errorText || 'unknown'}:${request.url()}`);
    });

    page.on('response', (response) => {
        const url = response.url();
        const status = response.status();

        if (/\/__(?:\/)?firebase\/init\.json$/.test(url) && status === 404) {
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
    const { baseURL, path, titlePatterns } = options;
    const issues = createBootIssueCollector(page, options);

    await page.goto(buildUrl(baseURL, path), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    if (titlePatterns) {
        const title = await page.title();
        const matchers = Array.isArray(titlePatterns) ? titlePatterns : [titlePatterns];
        expect(matchers.some((pattern) => pattern.test(title))).toBeTruthy();
    }

    expect(issues).toEqual([]);
}
