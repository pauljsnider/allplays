import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    isDiamondScorebookUiEnabled,
    readStagedLaunchFeatureConfig,
    resolveLaunchFeatureFlag
} from '../../js/launch-features.js';

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

    it('reads only an exact staged boolean from the artifact meta', () => {
        const documentWithValue = (value) => ({
            querySelector: vi.fn(() => value === undefined ? null : {
                getAttribute: vi.fn(() => value)
            })
        });

        expect(readStagedLaunchFeatureConfig(documentWithValue('true')))
            .toEqual({ diamondScorebookUiEnabled: true });
        expect(readStagedLaunchFeatureConfig(documentWithValue('false')))
            .toEqual({ diamondScorebookUiEnabled: false });
        expect(readStagedLaunchFeatureConfig(documentWithValue('TRUE'))).toBeUndefined();
        expect(readStagedLaunchFeatureConfig(documentWithValue('1'))).toBeUndefined();
        expect(readStagedLaunchFeatureConfig(documentWithValue(undefined))).toBeUndefined();
        expect(readStagedLaunchFeatureConfig({
            querySelector() {
                throw new Error('document unavailable');
            }
        })).toBeUndefined();
    });

    it('uses staged true synchronously while preserving an explicit window false override', () => {
        vi.stubGlobal('document', {
            querySelector: vi.fn(() => ({
                getAttribute: vi.fn(() => 'true')
            }))
        });
        vi.stubGlobal('window', {});
        expect(isDiamondScorebookUiEnabled()).toBe(true);

        window.__ALLPLAYS_CONFIG__ = { diamondScorebookUiEnabled: false };
        expect(isDiamondScorebookUiEnabled()).toBe(false);

        window.__ALLPLAYS_CONFIG__ = { diamondScorebookUiEnabled: 'true' };
        expect(isDiamondScorebookUiEnabled()).toBe(false);
    });

    it('does not perform or await a network read during module or page bootstrap', () => {
        const source = readFileSync(new URL('../../js/launch-features.js', import.meta.url), 'utf8');
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        vi.stubGlobal('document', {
            querySelector: vi.fn(() => ({
                getAttribute: vi.fn(() => 'false')
            }))
        });
        vi.stubGlobal('window', {});

        expect(isDiamondScorebookUiEnabled()).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(source).not.toContain('fetch(');
        expect(source).not.toContain('await ');
    });

    it('uses staged configuration only when no explicit runtime value is present', () => {
        expect(resolveLaunchFeatureFlag(
            'diamondScorebookUiEnabled',
            undefined,
            { diamondScorebookUiEnabled: true }
        )).toBe(true);
        expect(resolveLaunchFeatureFlag(
            'diamondScorebookUiEnabled',
            undefined,
            { diamondScorebookUiEnabled: 'true' }
        )).toBe(false);
        expect(resolveLaunchFeatureFlag(
            'diamondScorebookUiEnabled',
            { diamondScorebookUiEnabled: false },
            { diamondScorebookUiEnabled: true }
        )).toBe(false);
        expect(resolveLaunchFeatureFlag(
            'diamondScorebookUiEnabled',
            { diamondScorebookUiEnabled: 'true' },
            { diamondScorebookUiEnabled: true }
        )).toBe(false);
    });

    it('keeps every legacy consumer on the staged-config-aware module key', () => {
        for (const page of ['edit-team.html', 'edit-schedule.html']) {
            const source = readFileSync(new URL(`../../${page}`, import.meta.url), 'utf8');
            expect(source).toContain("from './js/launch-features.js?v=3'");
            expect(source).not.toContain('launch-features.js?v=2');
        }
    });
});
