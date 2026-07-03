import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const firebaseConfig = JSON.parse(
    readFileSync(new URL('../../firebase.json', import.meta.url), 'utf8')
);

/**
 * Regression guard for #3418. Vite emits content-hashed, immutable bundles under
 * apps/app/dist/assets, which stage to /app/assets. Those files can be cached for a
 * year with `immutable`, but were served with the generic js/css `max-age=3600`
 * rule, forcing returning users to re-validate the whole app shell hourly.
 */
describe('hosting cache headers for hashed app assets', () => {
    const headers = firebaseConfig.hosting?.headers ?? [];

    function findRule(source) {
        return headers.find((rule) => rule.source === source);
    }

    function cacheControl(rule) {
        return (rule?.headers ?? []).find((header) => header.key === 'Cache-Control')?.value;
    }

    it('serves /app/assets with an immutable one-year cache lifetime', () => {
        const assetsRule = findRule('/app/assets/**');
        expect(assetsRule).toBeTruthy();
        const value = cacheControl(assetsRule);
        expect(value).toContain('immutable');
        expect(value).toContain('max-age=31536000');
    });

    it('keeps the generic js/css rule short-lived for cache-busted legacy assets', () => {
        const genericRule = findRule('**/*.@(js|css)');
        expect(genericRule).toBeTruthy();
        expect(cacheControl(genericRule)).toBe('max-age=3600');
    });

    it('orders the immutable /app/assets rule after the generic js/css rule so it wins', () => {
        // Firebase Hosting applies the last matching source for a given header key,
        // so the specific immutable rule must appear after the generic js/css rule
        // for hashed /app/assets/*.js files to receive the long cache lifetime.
        const genericIndex = headers.findIndex((rule) => rule.source === '**/*.@(js|css)');
        const assetsIndex = headers.findIndex((rule) => rule.source === '/app/assets/**');
        expect(genericIndex).toBeGreaterThan(-1);
        expect(assetsIndex).toBeGreaterThan(genericIndex);
    });

    it('does not put unknown keys in header rule objects (keeps firebase deploy valid)', () => {
        const allowedKeys = new Set(['source', 'headers', 'glob', 'regex']);
        headers.forEach((rule) => {
            Object.keys(rule).forEach((key) => {
                expect(allowedKeys.has(key)).toBe(true);
            });
        });
    });
});
