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
            await assertPageBootsWithoutFatalErrors(page, {
                baseURL,
                path: `/${file}`,
                titlePatterns: [/ALL PLAYS Help/i],
                skipDefaultForbiddenTexts: true,
                requiredSelectors: [
                    '[data-help-back-link]',
                    '#workflow-mobile-toc',
                    '.help-workflow-body h2[id]'
                ]
            });

            await expect(page.locator('#workflow-mobile-toc')).toBeVisible();
            expect(await page.locator('#workflow-mobile-toc a').count(), `${file} should populate mobile TOC links`).toBeGreaterThan(0);
        }
    });
});
