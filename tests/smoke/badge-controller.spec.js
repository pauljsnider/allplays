import { test, expect } from '@playwright/test';
import { assertPageBootsWithoutFatalErrors } from './helpers/boot-path.js';

test('badge pairing boots, selects a team and downloads its configuration', async ({ page, baseURL }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/js/auth.js?*', route => route.fulfill({ contentType: 'text/javascript', body: 'export function checkAuth(callback) { callback({uid:"test",email:"test@example.com"}); }' }));
    await page.route('**/js/db.js?*', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function getUserTeamsWithAccess() { return [{id:"test-team",name:"Falcons"},{id:"other",name:"Owls"}]; } export async function getGames() {return [{id:"test-game",opponent:"Tigers",badgeScoreControl:true}];}' }));
    await page.route('**/js/firebase.js?*', route => route.fulfill({ contentType: 'text/javascript', body: 'export const functions={}; export const httpsCallable=()=>async()=>({data:{}});' }));
    await assertPageBootsWithoutFatalErrors(page, { baseURL, path: '/badge-controller.html' });
    await expect(page.getByRole('button', { name: 'Download badge pairing file' })).toBeEnabled();
    await expect(page.locator('header img')).toHaveJSProperty('naturalWidth', 678);
    await page.locator('#team').selectOption('other');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download badge pairing file' }).click();
    expect((await download).suggestedFilename()).toBe('controller.json');
    await expect(page.locator('#status')).toContainText('Pairing file downloaded');
    expect(errors).toEqual([]);
    await testInfo.attach('AllPlays badge setup', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    if (process.env.BADGE_SCREENSHOT_PATH) await page.screenshot({ path: process.env.BADGE_SCREENSHOT_PATH, fullPage: true });
});
