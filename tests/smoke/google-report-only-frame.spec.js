import { test, expect } from '@playwright/test';
import { collectAppRuntimeIssues } from './helpers/app-auth.js';

test('Google report-only child-frame diagnostic is scoped before frame navigation commits', async ({ page }) => {
    const observed = [];
    await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === 'https://allplays.ai') {
            return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Smoke fixture</title><iframe src="https://www.google.com/recaptcha/enterprise/anchor?fixture=1"></iframe>' });
        }
        if (url.origin === 'https://www.google.com' && url.pathname === '/recaptcha/enterprise/anchor') {
            return route.fulfill({
                contentType: 'text/html',
                headers: { 'Content-Security-Policy-Report-Only': "frame-ancestors 'self'" },
                body: '<!doctype html><title>Child fixture</title><p>Loaded</p>'
            });
        }
        return route.abort();
    });
    page.on('console', message => {
        if (message.text().includes('frame-ancestors') && message.text().includes('report-only')) observed.push(message.text());
    });
    const issues = collectAppRuntimeIssues(page, [], { includeApiFailures: true });
    await page.goto('https://allplays.ai/smoke-frame-fixture', { waitUntil: 'load' });
    await expect.poll(() => observed.length).toBeGreaterThan(0);
    expect(issues).toEqual([]);
    await expect(page.frameLocator('iframe').getByText('Loaded', { exact: true })).toBeVisible();
});
