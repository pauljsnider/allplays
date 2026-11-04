import { test, expect } from '@playwright/test';

const appBase = process.env.SMOKE_APP_BASE_URL || 'http://127.0.0.1:5174';
const requestId = '00112233-4455-4677-8899-aabbccddeeff';

test('MCP review link requires sign-in and preserves the requested destination', async ({ page }) => {
    // No credentials, real records, or external API calls are used by this smoke.
    await page.addInitScript(() => {
        window.__ALLPLAYS_CONFIG__ = {
            firebase: { apiKey: 'demo-api-key', authDomain: 'demo-allplays.firebaseapp.com', projectId: 'demo-allplays', messagingSenderId: '1234567890', appId: '1:1234567890:web:allplayssmoke' },
            appCheck: { enabled: false }
        };
    });
    const origin = new URL(appBase).origin;
    await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        const firebaseSdk = url.origin === 'https://www.gstatic.com' && /^\/firebasejs\/[^/]+\/[^/]+\.js$/.test(url.pathname);
        return url.origin === origin || firebaseSdk ? route.continue() : route.abort();
    });
    await page.goto(`${appBase.replace(/\/$/, '')}/#/ai/mcp/${requestId}`);
    await expect(page).toHaveURL(new RegExp(`#/auth\\?next=${encodeURIComponent(`/ai/mcp/${requestId}`)}$`), { timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Confirm change', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Prepare for review', exact: true })).toHaveCount(0);
});
