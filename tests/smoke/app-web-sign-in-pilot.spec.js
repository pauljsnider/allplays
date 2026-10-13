import { test, expect } from '@playwright/test';
const appBase = process.env.SMOKE_APP_BASE_URL;
test.skip(!appBase || process.env.SMOKE_SUITE === 'production', 'Local module-mocked browser pilot only.');

test('pilot browser request, explicit completion, wrong-email recovery and stale invitation isolation', async ({ page }) => {
    page.on('pageerror', (error) => console.error('Pilot fixture error:', error.message));
    // This harness renders the real component; every backend boundary is mocked.
    // Abort all non-local traffic, so this spec cannot request live auth emails.
    await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
    });
    await page.route(/\/src\/main\.tsx(?:\?.*)?$/, async (route) => {
        const transformed = await (await route.fetch()).text();
        const dependency = (name) => transformed.match(new RegExp(`["']([^"']*/node_modules/\\.vite/deps/${name}\\.js[^"']*)["']`))[1];
        return route.fulfill({ contentType: 'application/javascript', body: `
      import React from '${dependency('react')}';
      import ReactDOM from '${dependency('react-dom_client')}';
      import { HashRouter } from '${dependency('react-router-dom')}';
      import { EmailSignIn } from '/src/pages/EmailSignIn.tsx';
      window.pilotCalls = [];
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(HashRouter, null,
        React.createElement(EmailSignIn, {auth: {user: null, loading:false, refresh:async()=>{}}})));
    ` }); });
    await page.route(/\/src\/lib\/webSignInPilot\.ts(?:\?.*)?$/, (route) => route.fulfill({ contentType: 'application/javascript', body: `
      export const readPilotEmail=()=>localStorage.getItem('pilotEmail')||'';
      export const normalizePilotEmail=v=>v.trim().toLowerCase();
      export const safePilotNext=()=>'/home';
      export const pilotConfirmation='If eligible, check your inbox.';
      export const signOutPilotAccount=async()=>{};
      export const requestPilotEmail=async(email)=>{window.pilotCalls.push('request');localStorage.setItem('pilotEmail',email)};
      export const completePilotEmail=async(email)=>{window.pilotCalls.push('complete');throw Error('expired')};
    ` }));
    await page.addInitScript(() => {
        localStorage.setItem('allplays-app-pending-invite-code', 'STALE123');
        localStorage.setItem('allplays.pendingPushRoute', '/accept-invite');
    });
    await page.goto(`${appBase}/#/email-sign-in`);
    await page.getByLabel('Email address that received the link').fill('paul@allplays.ai');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByRole('status')).toBeVisible();
    await page.goto(`${appBase}/#/email-sign-in?mode=signIn&oobCode=local-fixture`);
    await page.reload();
    await expect(page.getByLabel('Email address that received the link')).toHaveValue('paul@allplays.ai');
    expect(await page.evaluate(() => window.pilotCalls)).toEqual([]);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('expired or already used');
    await page.getByRole('button', { name: 'Request a new link' }).click();
    await expect(page.getByRole('status')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('allplays-app-pending-invite-code'))).toBe('STALE123');
});
