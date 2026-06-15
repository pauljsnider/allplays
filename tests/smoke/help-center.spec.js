import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { buildUrl } from './helpers/boot-path.js';

async function readHelpManifest(page) {
    const manifestText = await page.locator('#help-manifest').textContent();
    return JSON.parse(manifestText || '[]');
}

async function getVisibleWorkflowTitles(page) {
    return page.locator('#help-grid article h2').allInnerTexts();
}

function filterManifest(manifest, { role = '', query = '' } = {}) {
    const normalizedQuery = query.toLowerCase().trim();
    return manifest.filter((item) => {
        const text = `${item.title} ${item.summary} ${item.searchText || ''}`.toLowerCase();
        const roleOk = !role || (item.roles || []).includes(role) || (item.roles || []).includes('All');
        return (!normalizedQuery || text.includes(normalizedQuery)) && roleOk;
    }).sort((a, b) => a.title.localeCompare(b.title));
}

async function readPageReferenceFiles(page) {
    const cells = page.locator('tbody td.font-mono');
    const values = await cells.allInnerTexts();
    return values.filter((value) => value.endsWith('.html'));
}

async function expectReferenceRow(page, file, roles) {
    const row = page.locator('tbody tr').filter({
        has: page.locator('td.font-mono', { hasText: file })
    });

    await expect(row, `${file} row should be visible`).toBeVisible();
    await expect(row, `${file} row should show ${roles}`).toContainText(roles);
}

function readRepoHtml(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function extractTitle(html) {
    return html.match(/<title>\s*([^<]+?)\s*<\/title>/i)?.[1]?.trim() || null;
}

async function expectRequestedPageResponse(request, baseURL, file, indexHtml) {
    const response = await request.get(buildUrl(baseURL, `/${file}`));
    expect(response.ok(), `${file} should resolve successfully`).toBeTruthy();

    const responseHtml = await response.text();
    expect(responseHtml, `${file} should return HTML content`).toMatch(/<!doctype html>|<html/i);

    if (file !== 'index.html') {
        expect(responseHtml, `${file} should not rewrite to index.html`).not.toBe(indexHtml);
    }

    const expectedTitle = extractTitle(readRepoHtml(file));
    expect(expectedTitle, `${file} should declare a page title in the repo source`).toBeTruthy();
    expect(
        extractTitle(responseHtml),
        `${file} should serve its own HTML instead of an index.html rewrite fallback`
    ).toBe(expectedTitle);
}

test('help center supports workflow discovery and page-reference navigation', async ({ page, baseURL }) => {
    await page.goto(buildUrl(baseURL, '/help.html'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'ALL PLAYS Help Center' })).toBeVisible();

    const manifest = await readHelpManifest(page);
    expect(manifest.length).toBeGreaterThan(0);

    await expect(page.locator('#help-grid article')).toHaveCount(manifest.length);
    await expect(page.locator('#help-summary')).toHaveText(`${manifest.length} of ${manifest.length} workflows`);
    await expect(page.locator('#help-empty')).toHaveClass(/hidden/);
    await expect(page.locator('#help-grid')).not.toHaveClass(/hidden/);
    await expect(page.getByRole('link', { name: 'View file-by-file page reference' })).toBeVisible();

    await page.goto(buildUrl(baseURL, '/help.html?context=team&teamId=team-123&role=coach'), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#help-role')).toHaveValue('Coach');
    const coachResults = filterManifest(manifest, { role: 'Coach' });
    await expect(page.locator('#help-grid article')).toHaveCount(coachResults.length);
    await expect(page.locator('#help-summary')).toHaveText(`${coachResults.length} of ${manifest.length} workflows`);
    await expect(page.locator('#help-grid')).toContainText('Plan Schedule and Launch Game Flows');
    await expect(page.locator('#help-grid')).not.toContainText('Operate Platform Admin Controls');
    const teamContextScheduleCard = page.locator('#help-grid article', { hasText: 'Plan Schedule and Launch Game Flows' });
    await expect(teamContextScheduleCard.getByRole('link', { name: /Open workflow/i })).toHaveAttribute(
        'href',
        'workflow-schedule.html?context=team&teamId=team-123&role=coach'
    );

    await page.locator('#help-search').fill('team operations');
    const teamOperationsResults = filterManifest(manifest, { role: 'Coach', query: 'team operations' });
    await expect(page.locator('#help-grid article')).toHaveCount(teamOperationsResults.length);
    await expect(page.locator('#help-summary')).toHaveText(`${teamOperationsResults.length} of ${manifest.length} workflows`);
    await expect(page.locator('#help-grid')).toContainText('Team Operations');
    const teamOperationsCard = page.locator('#help-grid article', { hasText: 'Team Operations' });
    await expect(teamOperationsCard.getByRole('link', { name: /Open workflow/i })).toHaveAttribute(
        'href',
        'help-team-operations.html?context=team&teamId=team-123&role=coach'
    );

    await page.locator('#help-search').fill('foundation');
    const foundationResults = filterManifest(manifest, { role: 'Coach', query: 'foundation' });
    await expect(page.locator('#help-grid article')).toHaveCount(foundationResults.length);
    await expect(page.locator('#help-summary')).toHaveText(`${foundationResults.length} of ${manifest.length} workflows`);
    expect(await getVisibleWorkflowTitles(page)).toEqual(foundationResults.map((item) => item.title));

    await page.locator('#help-search').fill('zzzz-no-match');
    await expect(page.locator('#help-grid')).toHaveClass(/hidden/);
    await expect(page.locator('#help-empty')).not.toHaveClass(/hidden/);
    await expect(page.locator('#help-summary')).toHaveText(`0 of ${manifest.length} workflows`);

    await page.locator('#help-search').fill('');
    await page.locator('#help-role').selectOption('');
    await expect(page.locator('#help-grid article')).toHaveCount(manifest.length);
    await expect(page.locator('#help-empty')).toHaveClass(/hidden/);
    await expect(page.locator('#help-grid')).not.toHaveClass(/hidden/);
    const restoredScheduleCard = page.locator('#help-grid article', { hasText: 'Plan Schedule and Launch Game Flows' });
    await expect(restoredScheduleCard.getByRole('link', { name: /Open workflow/i })).toHaveAttribute(
        'href',
        'workflow-schedule.html?context=team&teamId=team-123&role=coach'
    );

    await page.getByRole('link', { name: 'View file-by-file page reference' }).click();
    await expect(page).toHaveURL(/help-page-reference\.html/);
    await expect(page.getByRole('heading', { name: 'File-by-File Page Reference' })).toBeVisible();
    await expect(page.locator('tbody')).toContainText('edit-schedule.html');
    await expect(page.locator('tbody')).toContainText('live-game.html');
    await expect(page.locator('tbody')).toContainText('help-page-reference.html');
    await expectReferenceRow(page, 'certificates.html', 'Parent, Coach, Admin');
    await expectReferenceRow(page, 'check-admin-status.html', 'Admin');
    await expectReferenceRow(page, 'registration.html', 'Parent');
    await expectReferenceRow(page, 'team-fees.html', 'Coach, Admin');
    await expectReferenceRow(page, 'team-media.html', 'Parent, Coach, Admin');

    await page.getByRole('link', { name: '← Back to Help Portal' }).click();
    await expect(page).toHaveURL(/help\.html/);
    await expect(page.getByRole('heading', { name: 'ALL PLAYS Help Center' })).toBeVisible();

    await page.goto(buildUrl(baseURL, '/help.html?context=team&teamId=team-123&role=coach'), { waitUntil: 'domcontentloaded' });
    const scheduleCard = page.locator('#help-grid article', { hasText: 'Plan Schedule and Launch Game Flows' });
    await scheduleCard.getByRole('link', { name: /Open workflow/i }).click();
    await expect(page).toHaveURL(/workflow-schedule\.html\?context=team&teamId=team-123&role=coach/);
    await expect(page.getByRole('link', { name: '← Back to Help Center' })).toBeVisible();
    await page.getByRole('link', { name: '← Back to Help Center' }).click();
    await expect(page).toHaveURL(/help\.html/);
});

test('help manifest and page-reference files resolve successfully', async ({ page, request, baseURL }) => {
    await page.goto(buildUrl(baseURL, '/help.html'), { waitUntil: 'domcontentloaded' });
    const manifest = await readHelpManifest(page);
    const workflowFiles = manifest.map((item) => item.file);

    expect(workflowFiles).toContain('workflow-schedule.html');
    expect(workflowFiles).toContain('workflow-track-game.html');
    expect(workflowFiles).toContain('help-team-operations.html');

    await page.goto(buildUrl(baseURL, '/help-page-reference.html'), { waitUntil: 'domcontentloaded' });
    const referenceFiles = await readPageReferenceFiles(page);

    expect(referenceFiles).toContain('edit-schedule.html');
    expect(referenceFiles).toContain('live-game.html');
    expect(referenceFiles).toContain('help-page-reference.html');
    expect(referenceFiles).toEqual(expect.arrayContaining([
        'certificates.html',
        'check-admin-status.html',
        'registration.html',
        'team-fees.html',
        'team-media.html'
    ]));

    const uniqueFiles = [...new Set([...workflowFiles, ...referenceFiles])];
    const indexResponse = await request.get(buildUrl(baseURL, '/index.html'));
    expect(indexResponse.ok(), 'index.html should resolve successfully').toBeTruthy();
    const indexHtml = await indexResponse.text();

    for (const file of uniqueFiles) {
        await expectRequestedPageResponse(request, baseURL, file, indexHtml);
    }
});
