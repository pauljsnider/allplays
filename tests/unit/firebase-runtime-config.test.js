import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveImageFirebaseConfig, resolvePrimaryFirebaseConfig } from '../../js/firebase-runtime-config.js';

const ORIGINAL_WINDOW = globalThis.window;
const ORIGINAL_FETCH = globalThis.fetch;

function resetGlobals() {
    globalThis.window = { location: { origin: 'http://localhost' } }; // Mock window.location for fetchFirebaseConfigFromHosting
    delete globalThis.window.__ALLPLAYS_CONFIG__;
    delete globalThis.window.ALLPLAYS_FIREBASE_CONFIG;
    delete globalThis.window.ALLPLAYS_FIREBASE_IMAGE_CONFIG;
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

    it('prefers hosted firebase config over inline config when both are present', async () => {
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
            apiKey: 'hosted-key',
            authDomain: 'hosted-allplays.firebaseapp.com',
            projectId: 'hosted-allplays',
            appId: 'hosted-app'
        });
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
});
