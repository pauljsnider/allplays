import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    isNativeAppCheckDebugBuild,
    resolveAppCheckRuntimeConfig,
    resolveImageFirebaseConfig,
    resolvePrimaryFirebaseConfig
} from '../../js/firebase-runtime-config.js';

const ORIGINAL_WINDOW = globalThis.window;
const ORIGINAL_FETCH = globalThis.fetch;

function resetGlobals() {
    globalThis.window = { location: { origin: 'http://localhost' } }; // Mock window.location for fetchFirebaseConfigFromHosting
    delete globalThis.window.__ALLPLAYS_CONFIG__;
    delete globalThis.window.ALLPLAYS_FIREBASE_CONFIG;
    delete globalThis.window.ALLPLAYS_FIREBASE_IMAGE_CONFIG;
    delete globalThis.window.ALLPLAYS_APP_CHECK_CONFIG;
    delete globalThis.fetch;
}

describe('firebase runtime config', () => {
    afterEach(() => {
        if (typeof ORIGINAL_WINDOW === 'undefined') {
            delete globalThis.window;
        } else {
            globalThis.window = ORIGINAL_WINDOW;
        }

        if (typeof ORIGINAL_FETCH === 'undefined') {
            delete globalThis.fetch;
        } else {
            globalThis.fetch = ORIGINAL_FETCH;
        }

        vi.restoreAllMocks();
    });

    it('falls back to the bundled primary firebase config when hosting init is unavailable', async () => {
        resetGlobals();
        globalThis.window.location = {
            origin: 'https://allplays.ai',
            hostname: 'allplays.ai',
            pathname: '/'
        };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404
        });

        const config = await resolvePrimaryFirebaseConfig();

        expect(config.projectId).toBe('game-flow-c6311');
        // The fallback must carry the real game-flow-c6311 web app id (project
        // number 982493478258) — the old 1030107289033 pair belonged to another
        // project and broke Installations/FCM/Performance wherever the fallback ran.
        expect(config.appId).toBe('1:982493478258:web:1f942c420cef6c40e8b1eb');
        expect(config.messagingSenderId).toBe('982493478258');
        expect(globalThis.fetch).toHaveBeenCalledOnce();
    });

    it('keeps hosted demo firebase config when served through local Firebase hosting', async () => {
        resetGlobals();
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                apiKey: 'demo-key',
                authDomain: 'demo-allplays.firebaseapp.com',
                projectId: 'demo-allplays',
                messagingSenderId: '123',
                appId: 'demo-app'
            })
        });

        const config = await resolvePrimaryFirebaseConfig();

        expect(config).toMatchObject({
            apiKey: 'demo-key',
            authDomain: 'demo-allplays.firebaseapp.com',
            projectId: 'demo-allplays',
            appId: 'demo-app'
        });
    });

    it('uses an explicit non-production runtime fallback for isolated local preview smoke', async () => {
        resetGlobals();
        globalThis.window.location = {
            origin: 'http://127.0.0.1:4173',
            protocol: 'http:',
            hostname: '127.0.0.1',
            pathname: '/app/'
        };
        globalThis.fetch = vi.fn(async (url) => {
            if (url.endsWith('/__/firebase/init.json')) {
                return { ok: false, status: 404 };
            }
            if (url.endsWith('/.well-known/allplays-runtime-config.json')) {
                return {
                    ok: true,
                    json: async () => ({
                        firebase: {
                            apiKey: 'preview-smoke-key',
                            authDomain: 'allplays-preview-smoke.firebaseapp.com',
                            projectId: 'allplays-preview-smoke',
                            messagingSenderId: '123456789',
                            appId: 'preview-smoke-app'
                        }
                    })
                };
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const config = await resolvePrimaryFirebaseConfig();

        expect(config.projectId).toBe('allplays-preview-smoke');
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('fails closed when local hosting and runtime config are unavailable', async () => {
        resetGlobals();
        globalThis.window.location = {
            origin: 'http://localhost:3000',
            protocol: 'http:',
            hostname: 'localhost',
            pathname: '/'
        };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404
        });

        await expect(resolvePrimaryFirebaseConfig()).rejects.toThrow(
            'Firebase config is unavailable for local development. Configure an explicit non-production Firebase project.'
        );
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('fails closed when localhost runtime config points at production Firebase', async () => {
        resetGlobals();
        globalThis.window.location = {
            origin: 'http://127.0.0.1:4173',
            protocol: 'http:',
            hostname: '127.0.0.1',
            pathname: '/app/'
        };
        globalThis.fetch = vi.fn(async (url) => {
            if (url.endsWith('/__/firebase/init.json')) {
                return { ok: false, status: 404 };
            }
            return {
                ok: true,
                json: async () => ({
                    firebase: {
                        apiKey: 'production-key',
                        authDomain: 'game-flow-c6311.firebaseapp.com',
                        projectId: 'game-flow-c6311',
                        messagingSenderId: '982493478258',
                        appId: 'production-app'
                    }
                })
            };
        });

        await expect(resolvePrimaryFirebaseConfig()).rejects.toThrow(
            'Firebase config is unavailable for local development. Configure an explicit non-production Firebase project.'
        );
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('uses host-specific init before any runtime file on a non-production Firebase host', async () => {
        resetGlobals();
        globalThis.window.location = {
            origin: 'https://allplays-preview.web.app',
            hostname: 'allplays-preview.web.app',
            pathname: '/app/'
        };
        globalThis.fetch = vi.fn(async (url) => {
            if (url.endsWith('/__/firebase/init.json')) {
                return {
                    ok: true,
                    json: async () => ({
                        apiKey: 'preview-key',
                        authDomain: 'allplays-preview.firebaseapp.com',
                        projectId: 'allplays-preview',
                        messagingSenderId: '456',
                        appId: 'preview-app'
                    })
                };
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const config = await resolvePrimaryFirebaseConfig();

        expect(config.projectId).toBe('allplays-preview');
        expect(globalThis.fetch).toHaveBeenCalledOnce();
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://allplays-preview.web.app/__/firebase/init.json',
            { cache: 'no-store' }
        );
    });

    it('does not let a different non-production runtime file override a Firebase host identity', async () => {
        resetGlobals();
        globalThis.window.location = {
            origin: 'https://allplays-preview.web.app',
            hostname: 'allplays-preview.web.app',
            pathname: '/app/'
        };
        globalThis.fetch = vi.fn(async (url) => {
            if (url.endsWith('/__/firebase/init.json')) {
                return {
                    ok: true,
                    json: async () => ({
                        apiKey: 'preview-key',
                        authDomain: 'allplays-preview.firebaseapp.com',
                        projectId: 'allplays-preview',
                        messagingSenderId: '456',
                        appId: 'preview-app'
                    })
                };
            }
            if (url.endsWith('/.well-known/allplays-runtime-config.json')) {
                return {
                    ok: true,
                    json: async () => ({
                        firebase: {
                            apiKey: 'other-key',
                            authDomain: 'other-preview.firebaseapp.com',
                            projectId: 'other-preview',
                            messagingSenderId: '789',
                            appId: 'other-preview-app'
                        }
                    })
                };
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const config = await resolvePrimaryFirebaseConfig();

        expect(config.projectId).toBe('allplays-preview');
        expect(globalThis.fetch).toHaveBeenCalledOnce();
        expect(globalThis.fetch).not.toHaveBeenCalledWith(
            'https://allplays-preview.web.app/.well-known/allplays-runtime-config.json',
            expect.anything()
        );
    });

    it('fails closed instead of using a runtime fallback when Firebase host init is unavailable', async () => {
        resetGlobals();
        globalThis.window.location = {
            origin: 'https://allplays-preview.web.app',
            hostname: 'allplays-preview.web.app',
            pathname: '/app/'
        };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 503
        });

        await expect(resolvePrimaryFirebaseConfig()).rejects.toThrow(
            'Firebase config request failed (503)'
        );
        expect(globalThis.fetch).toHaveBeenCalledOnce();
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://allplays-preview.web.app/__/firebase/init.json',
            { cache: 'no-store' }
        );
    });

    it('fails closed when a non-production host has only the bundled production config', async () => {
        resetGlobals();
        globalThis.window.location = {
            origin: 'https://preview.example.com',
            hostname: 'preview.example.com',
            pathname: '/'
        };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                firebase: {
                    apiKey: 'production-key',
                    authDomain: 'game-flow-c6311.firebaseapp.com',
                    projectId: 'game-flow-c6311',
                    messagingSenderId: '982493478258',
                    appId: 'production-app'
                }
            })
        });

        await expect(resolvePrimaryFirebaseConfig()).rejects.toThrow(
            'Firebase config is unavailable for this non-production host.'
        );
    });

    it('keeps the bundled config available to the packaged native app', async () => {
        resetGlobals();
        globalThis.window.location = {
            origin: 'capacitor://localhost',
            protocol: 'capacitor:',
            hostname: 'localhost',
            pathname: '/app/'
        };
        globalThis.fetch = vi.fn();

        const config = await resolvePrimaryFirebaseConfig();

        expect(config.projectId).toBe('game-flow-c6311');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('prefers explicit inline firebase config without making a network request', async () => {
        resetGlobals();
        globalThis.window.__ALLPLAYS_CONFIG__ = {
            firebase: {
                apiKey: 'inline-key',
                authDomain: 'inline-allplays.firebaseapp.com',
                projectId: 'inline-allplays',
                messagingSenderId: '999',
                appId: 'inline-app'
            }
        };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                apiKey: 'hosted-key',
                authDomain: 'hosted-allplays.firebaseapp.com',
                projectId: 'hosted-allplays',
                messagingSenderId: '123',
                appId: 'hosted-app'
            })
        });

        const config = await resolvePrimaryFirebaseConfig();

        expect(config).toMatchObject({
            apiKey: 'inline-key',
            authDomain: 'inline-allplays.firebaseapp.com',
            projectId: 'inline-allplays',
            appId: 'inline-app'
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('falls back to inline config before bundled defaults when hosted init lookup fails', async () => {
        resetGlobals();
        globalThis.window.__ALLPLAYS_CONFIG__ = {
            firebase: {
                apiKey: 'inline-key',
                authDomain: 'inline-allplays.firebaseapp.com',
                projectId: 'inline-allplays',
                messagingSenderId: '999',
                appId: 'inline-app'
            }
        };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404
        });

        const config = await resolvePrimaryFirebaseConfig();

        expect(config).toMatchObject({
            apiKey: 'inline-key',
            authDomain: 'inline-allplays.firebaseapp.com',
            projectId: 'inline-allplays',
            appId: 'inline-app'
        });
    });

    it('returns the bundled image firebase config when no inline image config is present', () => {
        resetGlobals();

        const config = resolveImageFirebaseConfig();

        expect(config.projectId).toBe('game-flow-img');
        expect(config.appId).toBe('1:340859680438:web:4d00f571e8531907a11817');
    });

    it('normalizes inline App Check config and keeps auto-refresh enabled', async () => {
        resetGlobals();
        globalThis.window.__ALLPLAYS_CONFIG__ = {
            appCheck: {
                enabled: 'true',
                webSiteKey: ' enterprise-site-key ',
                debugToken: ' local-debug-token '
            }
        };

        const config = await resolveAppCheckRuntimeConfig();

        expect(config).toMatchObject({
            enabled: true,
            recaptchaEnterpriseSiteKey: 'enterprise-site-key',
            debugToken: 'local-debug-token',
            isTokenAutoRefreshEnabled: true
        });
        expect(globalThis.fetch).toBeUndefined();
    });

    it('loads staged App Check config from the well-known runtime endpoint', async () => {
        resetGlobals();
        globalThis.window.location = {
            origin: 'https://allplays.ai',
            hostname: 'allplays.ai',
            pathname: '/app/'
        };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                appCheck: { recaptchaEnterpriseSiteKey: 'staged-site-key' }
            })
        });

        const config = await resolveAppCheckRuntimeConfig();

        expect(config.recaptchaEnterpriseSiteKey).toBe('staged-site-key');
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://allplays.ai/.well-known/allplays-runtime-config.json',
            { cache: 'no-store' }
        );
    });

    it('shares one allplays.ai runtime request across Firebase and App Check startup', async () => {
        resetGlobals();
        globalThis.window.location = {
            origin: 'https://allplays.ai',
            hostname: 'allplays.ai',
            pathname: '/app/'
        };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                firebase: {
                    apiKey: 'runtime-key',
                    authDomain: 'runtime.firebaseapp.com',
                    projectId: 'runtime-project',
                    messagingSenderId: '123',
                    appId: 'runtime-app'
                },
                appCheck: { enabled: false }
            })
        });

        const [firebaseConfig, appCheckConfig] = await Promise.all([
            resolvePrimaryFirebaseConfig(),
            resolveAppCheckRuntimeConfig()
        ]);

        expect(firebaseConfig.projectId).toBe('runtime-project');
        expect(appCheckConfig.enabled).toBe(false);
        expect(globalThis.fetch).toHaveBeenCalledOnce();
        expect(globalThis.fetch).not.toHaveBeenCalledWith(
            'https://allplays.ai/__/firebase/init.json',
            expect.anything()
        );
    });

    it('does not expose the repository through a Vite-analyzable import-meta URL', () => {
        const source = readFileSync(new URL('../../js/firebase-runtime-config.js', import.meta.url), 'utf8');

        expect(source).not.toMatch(/new URL\([\s\S]*?import\.meta\.url/);
        expect(source).not.toContain('import.meta.url');
    });

    it('keeps every legacy browser importer on the explicit runtime-config cache contract', () => {
        for (const importer of ['firebase.js', 'firebase-images.js', 'firebase-app-check.js']) {
            const source = readFileSync(new URL(`../../js/${importer}`, import.meta.url), 'utf8');
            expect(source).toContain('firebase-runtime-config.js?v=16');
        }
    });

    it('selects native debug attestation only for the explicit build mode and without a bundled token', () => {
        expect(isNativeAppCheckDebugBuild({ MODE: 'native-debug' })).toBe(true);
        expect(isNativeAppCheckDebugBuild({ MODE: 'production' })).toBe(false);
        expect(isNativeAppCheckDebugBuild({ MODE: 'development' })).toBe(false);
        expect(isNativeAppCheckDebugBuild({ DEV: true, VITE_APP_CHECK_DEBUG_TOKEN: 'true' })).toBe(false);
    });
});
