import { test, expect } from '@playwright/test';

const FATAL_CONSOLE_PATTERNS = [
    /Missing Firebase image config/i,
    /Firebase config request failed/i,
    /Uncaught/i
];

function createIssueCollector(page) {
    const issues = [];

    page.on('console', (msg) => {
        const text = msg.text();
        if (msg.type() === 'error' && FATAL_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) {
            issues.push(`console:${text}`);
        }
    });

    page.on('pageerror', (error) => {
        issues.push(`pageerror:${error.message}`);
    });

    page.on('response', (response) => {
        const url = response.url();
        const status = response.status();
        if (status >= 500) {
            issues.push(`response:${status}:${url}`);
            return;
        }
        if (/\/__(?:\/)?firebase\/init\.json$/.test(url) && status === 404) {
            return;
        }
        if (status === 404 && /(firebase|auth|db|utils)\.js/.test(url)) {
            issues.push(`response:${status}:${url}`);
        }
    });

    return issues;
}

async function assertBootsWithoutFatalErrors(page, path, titlePattern) {
    const issues = createIssueCollector(page);
    const bust = Date.now();
    await page.goto(`${path}${path.includes('?') ? '&' : '?'}cb=${bust}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await expect(page).toHaveTitle(titlePattern);
    expect(issues).toEqual([]);
}

test('homepage boots under static-hosting constraints', async ({ page, baseURL }) => {
    await assertBootsWithoutFatalErrors(page, `${baseURL}/`, /ALL PLAYS/i);
});

test('dashboard boot path does not fatally fail under static-hosting constraints', async ({ page, baseURL }) => {
    await assertBootsWithoutFatalErrors(page, `${baseURL}/dashboard.html`, /My Teams/i);
});
