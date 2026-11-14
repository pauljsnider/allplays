import { test, expect } from '@playwright/test';

// Real browser modules and SDK transport, synthetic prompt, no Auth/Firestore
// credentials or writes. Only the attestation provider and remote AI are fakes.
test('AI waits for attestation, renews a rejected token, and keeps verification failure actionable', async ({ page }) => {
    let requests = 0;
    const tokens = [];
    await page.route('https://firebasevertexai.googleapis.com/**', async (route) => {
        requests += 1;
        tokens.push(route.request().headers()['x-firebase-appcheck']);
        await route.fulfill({
            status: requests === 1 ? 401 : 200,
            contentType: 'application/json',
            body: JSON.stringify(requests === 1
                ? { error: { message: 'Firebase App Check token is invalid' } }
                : { candidates: [{ content: { role: 'model', parts: [{ text: 'Synthetic preview only' }] } }] })
        });
    });
    await page.route('**/ai-attestation-harness.html', (route) => route.fulfill({
        contentType: 'text/html',
        body: `<button id="parse">Preview synthetic roster</button><output id="result"></output>
            <script type="module">
            import { initializeApp } from '/js/vendor/firebase-app.js';
            import { initializeAppCheck, CustomProvider, getToken } from '/js/vendor/firebase-app-check.js';
            import { registerPrimaryAppCheckContext } from '/js/firebase-app-check-rest.js';
            import { getAI, getGenerativeModel } from '/js/firebase-ai.js';
            const app = initializeApp({ apiKey: 'synthetic-public-key', projectId: 'demo-ai-smoke', appId: 'synthetic-app' });
            let appCheck;
            let calls = 0;
            let activate;
            const ready = new Promise(resolve => { activate = resolve; });
            registerPrimaryAppCheckContext({ initialization: Promise.resolve(), tokenPreparer: () => ready,
                tokenGetter: force => getToken(appCheck, force) });
            window.activateAttestation = () => {
                appCheck = initializeAppCheck(app, { isTokenAutoRefreshEnabled: false, provider: new CustomProvider({
                    getToken: async () => ({ token: calls++ ? 'renewed-synthetic-token' : 'initial-synthetic-token', expireTimeMillis: Date.now() + 3600000 })
                }) });
                activate();
            };
            window.failAttestation = () => registerPrimaryAppCheckContext({ tokenGetter: async () => null });
            const model = getGenerativeModel(getAI(app), { model: 'gemini-2.5-flash' });
            document.querySelector('#parse').onclick = async () => {
                const output = document.querySelector('#result');
                output.textContent = 'Verifying';
                try { output.textContent = (await model.generateContent('Preview a synthetic roster; do not write data.')).response.text(); }
                catch (error) { output.textContent = error.message; }
            };
            </script>`
    }));
    await page.goto('/ai-attestation-harness.html');
    await page.waitForFunction(() => typeof window.activateAttestation === 'function');
    await page.getByRole('button').click();
    await expect(page.locator('output')).toHaveText('Verifying');
    expect(requests).toBe(0);
    await page.evaluate(() => window.activateAttestation());
    await expect(page.locator('output')).toHaveText('Synthetic preview only');
    expect(tokens).toEqual(['initial-synthetic-token', 'renewed-synthetic-token']);
    await page.evaluate(() => window.failAttestation());
    await page.getByRole('button').click();
    await expect(page.locator('output')).toContainText('manual entry or CSV import');
    expect(requests).toBe(2);
});
