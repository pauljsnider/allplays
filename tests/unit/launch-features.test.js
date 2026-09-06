import { afterEach, describe, expect, it, vi } from 'vitest';

import { isDiamondScorebookUiEnabled } from '../../js/launch-features.js';

describe('legacy launch features', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps Diamond setup and activation UI off when runtime config is missing or malformed', () => {
        vi.stubGlobal('window', {});
        expect(isDiamondScorebookUiEnabled()).toBe(false);

        window.__ALLPLAYS_CONFIG__ = null;
        expect(isDiamondScorebookUiEnabled()).toBe(false);

        window.__ALLPLAYS_CONFIG__ = { diamondScorebookUiEnabled: false };
        expect(isDiamondScorebookUiEnabled()).toBe(false);

        window.__ALLPLAYS_CONFIG__ = { diamondScorebookUiEnabled: 'true' };
        expect(isDiamondScorebookUiEnabled()).toBe(false);

        Object.defineProperty(window, '__ALLPLAYS_CONFIG__', {
            configurable: true,
            get() {
                throw new Error('runtime config unavailable');
            }
        });
        expect(isDiamondScorebookUiEnabled()).toBe(false);
    });

    it('exposes Diamond setup and activation UI only for an explicit boolean true', () => {
        vi.stubGlobal('window', {
            __ALLPLAYS_CONFIG__: { diamondScorebookUiEnabled: true }
        });

        expect(isDiamondScorebookUiEnabled()).toBe(true);
    });
});
