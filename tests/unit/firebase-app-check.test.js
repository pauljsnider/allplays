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
    getPrimaryAppCheckHeaders,
    getPrimaryAppCheckToken,
    initializePrimaryAppCheck,
    isCapacitorNativeRuntime,
    isPrimaryFirebaseRestRequest
} from '../../js/firebase-app-check.js';

const PRIMARY_APP = {
    name: '[DEFAULT]',
    options: {
        apiKey: 'primary-api-key',
        projectId: 'game-flow-c6311',
        storageBucket: 'game-flow-c6311.firebasestorage.app'
    }
};

describe('Firebase App Check initialization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        globalThis.__allplaysAppCheckInitializations = new Map();
        delete globalThis.__allplaysPrimaryAppCheckInitialization;
        delete globalThis.__allplaysPrimaryFirebaseOptions;
        delete globalThis.__allplaysPrimaryAppCheckTokenGetter;
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
        const status = await initializePrimaryAppCheck(PRIMARY_APP);

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
        const app = PRIMARY_APP;

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
        const status = await initializePrimaryAppCheck(PRIMARY_APP);
        const provider = appCheckSdk.initializeAppCheck.mock.calls[0][1].provider;
        await expect(provider.getToken()).resolves.toMatchObject({ token: 'native-token' });

        expect(nativeAppCheck.initialize).toHaveBeenCalledWith({
            debugToken: false,
            isTokenAutoRefreshEnabled: true
        });
        expect(status).toMatchObject({ state: 'initialized', provider: 'native-attestation' });
    });

    it('never enables the web debug provider from production runtime config', async () => {
        globalThis.window.__ALLPLAYS_CONFIG__.appCheck = {
            recaptchaEnterpriseSiteKey: 'public-site-key',
            debugToken: 'must-not-be-used-in-production'
        };

        await initializePrimaryAppCheck(PRIMARY_APP);

        expect(globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
        expect(getAppCheckStatus()).toMatchObject({ provider: 'recaptcha-enterprise' });
    });

    it('attaches the current token only to primary Firebase REST endpoints', async () => {
        globalThis.window.__ALLPLAYS_CONFIG__.appCheck = {
            recaptchaEnterpriseSiteKey: 'public-site-key'
        };
        await initializePrimaryAppCheck(PRIMARY_APP);
        appCheckSdk.getToken.mockClear();

        const primaryUrls = [
            'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=primary-api-key',
            'https://securetoken.googleapis.com/v1/token?key=primary-api-key',
            'https://firestore.googleapis.com/v1/projects/game-flow-c6311/databases/(default)/documents/teams',
            'https://firebasestorage.googleapis.com/v0/b/game-flow-c6311.firebasestorage.app/o/photos%2Fone.jpg',
            'https://us-central1-game-flow-c6311.cloudfunctions.net/sendPublicRsvpEmails'
        ];

        for (const requestUrl of primaryUrls) {
            expect(isPrimaryFirebaseRestRequest(requestUrl)).toBe(true);
            await expect(getPrimaryAppCheckHeaders({ Authorization: 'Bearer user-token' }, requestUrl))
                .resolves.toEqual({
                    Authorization: 'Bearer user-token',
                    'X-Firebase-AppCheck': 'not-logged-or-exposed'
                });
        }
        expect(appCheckSdk.getToken).toHaveBeenCalledTimes(primaryUrls.length);
        await expect(getPrimaryAppCheckToken()).resolves.toBe('not-logged-or-exposed');
    });

    it('never leaks the primary token to secondary or arbitrary REST endpoints', async () => {
        globalThis.window.__ALLPLAYS_CONFIG__.appCheck = {
            recaptchaEnterpriseSiteKey: 'public-site-key'
        };
        await initializePrimaryAppCheck(PRIMARY_APP);
        appCheckSdk.getToken.mockClear();

        const nonPrimaryUrls = [
            'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=secondary-image-api-key',
            'https://securetoken.googleapis.com/v1/token?key=secondary-image-api-key',
            'https://firestore.googleapis.com/v1/projects/game-flow-img/databases/(default)/documents/photos',
            'https://firebasestorage.googleapis.com/v0/b/game-flow-img.firebasestorage.app/o/photos%2Fone.jpg',
            'https://us-central1-game-flow-img.cloudfunctions.net/processPhoto',
            'https://example.com/collect'
        ];

        for (const requestUrl of nonPrimaryUrls) {
            expect(isPrimaryFirebaseRestRequest(requestUrl)).toBe(false);
            await expect(getPrimaryAppCheckHeaders({ 'Content-Type': 'application/json' }, requestUrl))
                .resolves.toEqual({ 'Content-Type': 'application/json' });
        }
        expect(appCheckSdk.getToken).not.toHaveBeenCalled();
    });

    it('fails open without exposing token-shaped SDK error text', async () => {
        globalThis.window.__ALLPLAYS_CONFIG__.appCheck = {
            recaptchaEnterpriseSiteKey: 'public-site-key'
        };
        await initializePrimaryAppCheck(PRIMARY_APP);
        appCheckSdk.getToken.mockRejectedValueOnce(new Error('Bearer secret-app-check-token'));

        await expect(getPrimaryAppCheckToken()).resolves.toBeNull();

        expect(getAppCheckStatus()).toMatchObject({
            state: 'token-error',
            error: { message: 'App Check operation failed.' }
        });
        expect(JSON.stringify(getAppCheckStatus())).not.toContain('secret-app-check-token');
    });

    it('rejects SDK placeholder tokens and keeps REST requests fail-open', async () => {
        globalThis.window.__ALLPLAYS_CONFIG__.appCheck = {
            recaptchaEnterpriseSiteKey: 'public-site-key'
        };
        await initializePrimaryAppCheck(PRIMARY_APP);
        appCheckSdk.getToken.mockResolvedValueOnce({
            token: 'placeholder-token-that-must-not-be-sent',
            error: new Error('reCAPTCHA failure with private diagnostics')
        });

        const requestUrl = 'https://firestore.googleapis.com/v1/projects/game-flow-c6311/databases/(default)/documents/teams';
        await expect(getPrimaryAppCheckHeaders({ Authorization: 'Bearer user-token' }, requestUrl))
            .resolves.toEqual({ Authorization: 'Bearer user-token' });

        expect(getAppCheckStatus()).toMatchObject({
            state: 'token-error',
            error: { message: 'App Check operation failed.' }
        });
        expect(JSON.stringify(getAppCheckStatus())).not.toContain('placeholder-token');
        expect(JSON.stringify(getAppCheckStatus())).not.toContain('private diagnostics');
    });
});
