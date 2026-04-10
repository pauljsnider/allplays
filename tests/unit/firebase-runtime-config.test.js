import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveImageFirebaseConfig, resolvePrimaryFirebaseConfig } from '../../js/firebase-runtime-config.js';

const ORIGINAL_WINDOW = globalThis.window;
const ORIGINAL_FETCH = globalThis.fetch;

function resetGlobals() {
    globalThis.window = {};
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
        expect(config.appId).toBe('1:1030107289033:web:7154238712942475143046');
        expect(globalThis.fetch).toHaveBeenCalledOnce();
    });

    it('returns the bundled image firebase config when no inline image config is present', () => {
        resetGlobals();

        const config = resolveImageFirebaseConfig();

        expect(config.projectId).toBe('game-flow-img');
        expect(config.appId).toBe('1:340859680438:web:4d00f571e8531907a11817');
    });
});
