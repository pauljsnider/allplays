import { test, expect } from '@playwright/test';
import { assertPageBootsWithoutFatalErrors, buildUrl } from './helpers/boot-path.js';

test('changelog page boots without fatal errors', async ({ page, baseURL }) => {
    await assertPageBootsWithoutFatalErrors(page, {
        baseURL,
        path: '/changelog.html',
        titlePatterns: [/Changelog - ALL PLAYS/i],
        readySelectors: ['#cl-search', 'section.release'],
        forbiddenTexts: [/Error loading/i]
    });
});

test('changelog page structure and default collapse state', async ({ page, baseURL }) => {
    await page.goto(buildUrl(baseURL, '/changelog.html'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Changelog' })).toBeVisible();
    await expect(page.getByRole('link', { name: '← Help Center' })).toBeVisible();

    // The latest six-week catch-up is expanded — its body container is visible
    await expect(page.locator('#body-jun-2026')).toBeVisible();

    // All older releases are collapsed on load
    for (const id of ['body-may-2026', 'body-mar-2026', 'body-feb-2026', 'body-jan-2026', 'body-dec-2025']) {
        await expect(page.locator(`#${id}`), `${id} should be hidden on load`).toBeHidden();
    }

    // Sidebar TOC lists all release periods
    const toc = page.locator('#cl-toc');
    await expect(toc).toContainText('May 12-June 23, 2026');
    await expect(toc).toContainText('May 2026');
    await expect(toc).toContainText('March 2026');
    await expect(toc).toContainText('February 2026');
    await expect(toc).toContainText('January 2026');
    await expect(toc).toContainText('December 2025');
});

test('changelog expand/collapse toggle', async ({ page, baseURL }) => {
    await page.goto(buildUrl(baseURL, '/changelog.html'), { waitUntil: 'domcontentloaded' });

    const marBody   = page.locator('#body-mar-2026');
    const marToggle = page.locator('[data-target="body-mar-2026"]');

    await expect(marBody).toBeHidden();
    await expect(marToggle).toContainText('Expand');

    await marToggle.click();
    await expect(marBody).toBeVisible();
    await expect(marToggle).toContainText('Collapse');

    // Entries inside are now accessible
    await expect(marBody.locator('.entry').first()).toBeVisible();

    // Collapse it again
    await marToggle.click();
    await expect(marBody).toBeHidden();
    await expect(marToggle).toContainText('Expand');
});

test('changelog search filters entries and shows result count', async ({ page, baseURL }) => {
    await page.goto(buildUrl(baseURL, '/changelog.html'), { waitUntil: 'domcontentloaded' });

    const search    = page.locator('#cl-search');
    const clearBtn  = page.locator('#cl-search-clear');
    const status    = page.locator('#cl-status');
    const noResults = page.locator('#cl-no-results');

    // Clear button hidden initially
    await expect(clearBtn).toBeHidden();

    // Type a query that should match a known entry
    await search.fill('foul');
    await expect(clearBtn).toBeVisible();

    // Status bar should show a result count
    const statusText = await status.textContent();
    expect(statusText).toMatch(/\d+ result/i);

    // At least one entry is visible
    const visibleEntries = page.locator('.entry:not(.cl-hidden)');
    await expect(visibleEntries.first()).toBeVisible();

    // The release containing the foul entries should be auto-expanded
    await expect(page.locator('#body-may-2026')).toBeVisible();

    // An unrelated entry title should be hidden (zero points for generic terms, specific ones work)
    // Search for something very specific to may-2026 only
    await search.fill('stripe checkout');
    const stripeEntry = page.locator('.entry').filter({
        has: page.locator('.entry-title', { hasText: 'Team Fees & Payments (Stripe)' })
    });
    await expect(stripeEntry).toBeVisible();
});

test('changelog search clear restores all entries', async ({ page, baseURL }) => {
    await page.goto(buildUrl(baseURL, '/changelog.html'), { waitUntil: 'domcontentloaded' });

    const search   = page.locator('#cl-search');
    const clearBtn = page.locator('#cl-search-clear');
    const status   = page.locator('#cl-status');

    await search.fill('foul tracking');
    await expect(clearBtn).toBeVisible();

    // Clear the search
    await clearBtn.click();
    await expect(search).toHaveValue('');
    await expect(clearBtn).toBeHidden();
    await expect(status).toHaveText('');

    // The latest release remains visible and all its entries are restored
    await expect(page.locator('#body-jun-2026')).toBeVisible();
    await expect(page.locator('#body-jun-2026 .entry').first()).toBeVisible();
});

test('changelog search no-results state', async ({ page, baseURL }) => {
    await page.goto(buildUrl(baseURL, '/changelog.html'), { waitUntil: 'domcontentloaded' });

    const noResults = page.locator('#cl-no-results');
    await expect(noResults).toBeHidden();

    await page.locator('#cl-search').fill('zzz-no-match-xyzzy');
    await expect(noResults).toBeVisible();
    await expect(noResults).toContainText('No results');

    // Clear restores normal state
    await page.locator('#cl-search').fill('');
    await expect(noResults).toBeHidden();
});

test('changelog category filter chips hide non-matching entries', async ({ page, baseURL }) => {
    await page.goto(buildUrl(baseURL, '/changelog.html'), { waitUntil: 'domcontentloaded' });

    const allChip       = page.locator('.filter-chip[data-cat="all"]');
    const paymentsChip  = page.locator('.filter-chip[data-cat="payments"]');
    const status        = page.locator('#cl-status');

    // "All" chip is active by default
    await expect(allChip).toHaveClass(/active/);

    // Click Payments — only payments entries should remain visible
    await paymentsChip.click();
    await expect(paymentsChip).toHaveClass(/active/);
    await expect(allChip).not.toHaveClass(/active/);

    const statusText = await status.textContent();
    expect(statusText).toMatch(/\d+ result/i);

    // The known payments entry should be visible
    const paymentsEntry = page.locator('.entry').filter({
        has: page.locator('.entry-title', { hasText: 'Fee refunds, reminders, and guardrails' })
    });
    await expect(paymentsEntry).toBeVisible();

    // A platform-only entry should be hidden
    const platformEntry = page.locator('.entry', { hasText: 'Native app parity wave' });
    await expect(platformEntry).toBeHidden();

    // Click All to restore
    await allChip.click();
    await expect(allChip).toHaveClass(/active/);
    await expect(status).toHaveText('');
    await expect(platformEntry).toBeVisible();
});

test('changelog keyboard shortcut focuses search', async ({ page, baseURL }) => {
    await page.goto(buildUrl(baseURL, '/changelog.html'), { waitUntil: 'domcontentloaded' });

    const search = page.locator('#cl-search');

    // Ensure search is not focused
    await page.getByRole('heading', { name: 'Changelog' }).click();
    await expect(search).not.toBeFocused();

    // Press / to focus
    await page.keyboard.press('/');
    await expect(search).toBeFocused();

    // Escape blurs
    await page.keyboard.press('Escape');
    await expect(search).not.toBeFocused();
});
