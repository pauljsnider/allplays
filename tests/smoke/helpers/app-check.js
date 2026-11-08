// Firebase documents debug-provider attestation for CI browsers. This credential
// belongs only in protected smoke jobs, never in a build or runtime config.
const productionOrigins = new Set([
    'https://allplays.ai',
    'https://www.allplays.ai',
    'https://game-flow-c6311.web.app',
    'https://game-flow-c6311.firebaseapp.com'
]);
const debugTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function installSmokeAppCheck(page, baseUrl, env = process.env) {
    const token = env.SMOKE_APP_CHECK_DEBUG_TOKEN || '';
    const required = env.SMOKE_APP_CHECK_REQUIRED === '1';
    if (!token && !required) return false;
    if (typeof token !== 'string' || token.length !== 36 || !debugTokenPattern.test(token)) {
        throw new Error('Protected smoke requires a registered SMOKE_APP_CHECK_DEBUG_TOKEN UUID');
    }
    let url;
    try { url = new URL(baseUrl); } catch { /* Reject without reflecting input. */ }
    if (!url || url.username || url.password || !productionOrigins.has(url.origin)) {
        throw new Error('Smoke App Check credential requires an allowlisted production HTTPS origin');
    }
    try {
        await page.addInitScript(({ origin, debugToken }) => {
            // Init scripts also run in child frames and after redirects. Never
            // give this credential to reCAPTCHA frames or a different origin.
            if (globalThis.top === globalThis && globalThis.location.origin === origin) {
                globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
            }
        }, { origin: url.origin, debugToken: token });
    } catch {
        // Playwright errors can contain serialized arguments; do not expose them.
        throw new Error('Could not install protected smoke App Check attestation');
    }
    return true;
}

export async function assertSmokeAppCheckReady(page, enabled) {
    if (!enabled) return;
    try {
        await page.waitForFunction(() => {
            const state = globalThis.__ALLPLAYS_APP_CHECK_STATUS__?.state;
            return ['token-ready', 'token-error', 'disabled', 'error'].includes(state);
        }, undefined, { timeout: 30_000 });
        const ready = await page.evaluate(() => (
            globalThis.__ALLPLAYS_APP_CHECK_STATUS__?.state === 'token-ready'
        ));
        if (!ready) throw new Error('not-ready');
    } catch {
        throw new Error('Production smoke App Check did not obtain a valid token; exchange errors remain failures');
    }
}
