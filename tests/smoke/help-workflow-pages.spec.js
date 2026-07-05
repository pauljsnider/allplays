import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPageBootsWithoutFatalErrors } from './helpers/boot-path.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function listRootPages(prefix) {
    return readdirSync(REPO_ROOT)
        .filter((file) => file.startsWith(prefix) && file.endsWith('.html'))
        .sort();
}

const helpTopicPages = listRootPages('help-');
const workflowPages = listRootPages('workflow-');
const workflowTocPage = 'workflow-live-watch-replay.html';

async function bootWorkflowPage(page, baseURL, path) {
    await assertPageBootsWithoutFatalErrors(page, {
        baseURL,
        path,
        titlePatterns: [/ALL PLAYS Help/i],
        skipDefaultForbiddenTexts: true,
        requiredSelectors: [
            '[data-help-back-link]',
            '#workflow-toc',
            '#workflow-mobile-toc',
            '.help-workflow-body h2[id]'
        ]
    });
}

test.describe('help topic and workflow pages', () => {
    for (const file of ['help.html', ...helpTopicPages]) {
        test(`${file} boots with help navigation`, async ({ page, baseURL }) => {
            await assertPageBootsWithoutFatalErrors(page, {
                baseURL,
                path: `/${file}`,
                titlePatterns: [/Help/i],
                skipDefaultForbiddenTexts: true,
                requiredSelectors: ['body', 'a[href="help.html"], a[href="/help.html"], #help-page-reference-link']
            });
        });
    }

    for (const file of workflowPages) {
        test(`${file} boots with generated workflow navigation`, async ({ page, baseURL }) => {
            await assertPageBootsWithoutFatalErrors(page, {
                baseURL,
                path: `/${file}`,
                titlePatterns: [/ALL PLAYS Help/i],
                skipDefaultForbiddenTexts: true,
                requiredSelectors: [
                    '[data-help-back-link]',
                    '#workflow-toc',
                    '#workflow-mobile-toc',
                    '.help-workflow-body h2[id]'
                ]
            });

            await expect(page.locator('#workflow-toc a').first()).toBeVisible();
            expect(await page.locator('.help-workflow-body h2[id]').count()).toBeGreaterThan(2);
        });
    }

    test('workflow pages expose mobile table-of-contents links', async ({ page, baseURL }) => {
        await page.setViewportSize({ width: 390, height: 844 });

        for (const file of workflowPages) {
            await bootWorkflowPage(page, baseURL, `/${file}`);

            await expect(page.locator('#workflow-mobile-toc')).toBeVisible();
            expect(await page.locator('#workflow-mobile-toc a').count(), `${file} should populate mobile TOC links`).toBeGreaterThan(0);
        }
    });

    test('mobile workflow table-of-contents links sync active state and collapse after click', async ({ page, baseURL }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await bootWorkflowPage(page, baseURL, `/${workflowTocPage}`);

        const mobileTocDetails = page.locator('#workflow-mobile-toc details');
        const mobilePrerequisitesLink = page.locator('#workflow-mobile-toc a[href="#prerequisites"]');
        const desktopPrerequisitesLink = page.locator('.wf-sidebar #workflow-toc a[href="#prerequisites"]');

        await page.locator('#workflow-mobile-toc summary').click();
        await expect(mobileTocDetails).toHaveJSProperty('open', true);

        await mobilePrerequisitesLink.click();

        await expect(page).toHaveURL(/#prerequisites$/);
        await expect(mobilePrerequisitesLink).toHaveClass(/is-active/);
        await expect(desktopPrerequisitesLink).toHaveClass(/is-active/);
        await expect(mobileTocDetails).toHaveJSProperty('open', false);
    });

    test('workflow table-of-contents keeps hash active after mobile resize and updates on scroll', async ({ page, baseURL }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await bootWorkflowPage(page, baseURL, `/${workflowTocPage}#prerequisites`);

        await expect(page.locator('#workflow-mobile-toc details')).toHaveCount(0);
        await page.setViewportSize({ width: 390, height: 844 });

        const mobilePrerequisitesLink = page.locator('#workflow-mobile-toc a[href="#prerequisites"]');
        const desktopPrerequisitesLink = page.locator('.wf-sidebar #workflow-toc a[href="#prerequisites"]');
        await expect(mobilePrerequisitesLink).toHaveClass(/is-active/);
        await expect(desktopPrerequisitesLink).toHaveClass(/is-active/);

        const targetSection = page.locator('.help-workflow-body h2#common-questions');
        await targetSection.evaluate((element) => element.scrollIntoView());
        await expect(page.locator('#workflow-mobile-toc a[href="#common-questions"]')).toHaveClass(/is-active/);
        await expect(page.locator('.wf-sidebar #workflow-toc a[href="#common-questions"]')).toHaveClass(/is-active/);
        await expect(mobilePrerequisitesLink).not.toHaveClass(/is-active/);
    });
});
