import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appCheckSdk = vi.hoisted(() => ({
    getToken: vi.fn(),
    initializeAppCheck: vi.fn(),
    CustomProvider: vi.fn(function CustomProvider(options) {
        this.getToken = options.getToken;
    }),
    ReCaptchaEnterpriseProvider: vi.fn(function ReCaptchaEnterpriseProvider(siteKey) {
        this.siteKey = siteKey;
    })
}));

const nativeAppCheck = vi.hoisted(() => ({
    initialize: vi.fn(),
    getToken: vi.fn()
}));

vi.mock('../../js/vendor/firebase-app-check.js', () => appCheckSdk);
vi.mock('@capacitor-firebase/app-check', () => ({ FirebaseAppCheck: nativeAppCheck }));

import {
    getAppCheckStatus,
    initializePrimaryAppCheck,
    isCapacitorNativeRuntime
} from '../../js/firebase-app-check.js';

describe('Firebase App Check initialization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        globalThis.__allplaysAppCheckInitializations = new Map();
        delete globalThis.__ALLPLAYS_APP_CHECK_STATUS__;
        delete globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN;
        globalThis.window = {
            location: {
                origin: 'https://allplays.ai',
                hostname: 'allplays.ai',
                protocol: 'https:',
                pathname: '/app/'
            },
            __ALLPLAYS_CONFIG__: {}
        };
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
        appCheckSdk.initializeAppCheck.mockReturnValue({ appCheck: true });
        appCheckSdk.getToken.mockResolvedValue({ token: 'not-logged-or-exposed' });
        nativeAppCheck.initialize.mockResolvedValue(undefined);
        nativeAppCheck.getToken.mockResolvedValue({ token: 'native-token', expireTimeMillis: Date.now() + 60_000 });
    });

    afterEach(() => {
        delete globalThis.window;
        delete globalThis.fetch;
        delete globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN;
    });

    it('skips web initialization safely until a reCAPTCHA Enterprise site key is configured', async () => {
        const status = await initializePrimaryAppCheck({ name: '[DEFAULT]' });

        expect(status).toMatchObject({
            state: 'skipped',
            reason: 'recaptcha-enterprise-site-key-missing'
        });
        expect(appCheckSdk.initializeAppCheck).not.toHaveBeenCalled();
    });

    it('initializes reCAPTCHA Enterprise once and monitors token acquisition without exposing the token', async () => {
        globalThis.window.__ALLPLAYS_CONFIG__.appCheck = {
            recaptchaEnterpriseSiteKey: 'public-site-key'
        };
        const app = { name: '[DEFAULT]' };

        const first = initializePrimaryAppCheck(app);
        const second = initializePrimaryAppCheck(app);
        await Promise.all([first, second]);
        await vi.waitFor(() => expect(getAppCheckStatus()?.state).toBe('token-ready'));

        expect(appCheckSdk.ReCaptchaEnterpriseProvider).toHaveBeenCalledWith('public-site-key');
        expect(appCheckSdk.initializeAppCheck).toHaveBeenCalledOnce();
        expect(appCheckSdk.getToken).toHaveBeenCalledOnce();
        expect(JSON.stringify(getAppCheckStatus())).not.toContain('not-logged-or-exposed');
    });

    it('bridges native attestation tokens into the Firebase JavaScript SDK', async () => {
        globalThis.window.location = {
            origin: 'capacitor://localhost',
            hostname: 'localhost',
            protocol: 'capacitor:',
            pathname: '/'
        };
        globalThis.window.Capacitor = { isNativePlatform: () => true };
        globalThis.window.__ALLPLAYS_CONFIG__.appCheck = {};

        expect(isCapacitorNativeRuntime()).toBe(true);
        const status = await initializePrimaryAppCheck({ name: '[DEFAULT]' });
        const provider = appCheckSdk.initializeAppCheck.mock.calls[0][1].provider;
        await expect(provider.getToken()).resolves.toMatchObject({ token: 'native-token' });

        expect(nativeAppCheck.initialize).toHaveBeenCalledWith({
            debugToken: true,
            isTokenAutoRefreshEnabled: true
        });
        expect(status).toMatchObject({ state: 'initialized', provider: 'native-debug' });
    });

    it('never enables the web debug provider from production runtime config', async () => {
        globalThis.window.__ALLPLAYS_CONFIG__.appCheck = {
            recaptchaEnterpriseSiteKey: 'public-site-key',
            debugToken: 'must-not-be-used-in-production'
        };

        await initializePrimaryAppCheck({ name: '[DEFAULT]' });

        expect(globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
        expect(getAppCheckStatus()).toMatchObject({ provider: 'recaptcha-enterprise' });
    });
});
