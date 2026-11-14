import { expect, test } from '@playwright/test';
import { collectAppRuntimeIssues } from './helpers/app-auth.js';

// Synthetic frames only: all network requests are fulfilled locally.
test('only the exact embedded reCAPTCHA storage diagnostic is nonfatal', async ({ page }) => {
    const issues = collectAppRuntimeIssues(page, [], { includeApiFailures: true });
    await page.route('**/*', route => {
        const isAnchor = new URL(route.request().url()).hostname === 'www.google.com';
        return route.fulfill({ contentType: 'text/html', body: isAnchor
            ? '<script>console.error("requestStorageAccess: Permission denied.")</script><p>frame ready</p>'
            : '<iframe src="https://www.google.com/recaptcha/enterprise/anchor"></iframe>' });
    });
    await page.goto('https://allplays.ai/app/');
    await expect(page.frameLocator('iframe').getByText('frame ready')).toBeVisible();
    expect(issues).toEqual([]);
    await page.evaluate(() => console.error('requestStorageAccess: Permission denied.'));
    await expect.poll(() => issues).toEqual(['console:requestStorageAccess: Permission denied.']);
    await page.frames()[1].evaluate(() => console.error('Failed to load resource: the server responded with a status of 403 ()'));
    await expect.poll(() => issues.length).toBe(2);
    expect(issues[1]).toContain('403');
});
