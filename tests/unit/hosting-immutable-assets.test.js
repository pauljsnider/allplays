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
    const rewrites = firebaseConfig.hosting?.rewrites ?? [];

    function findRule(source) {
        return headers.find((rule) => rule.source === source);
    }

    function cacheControl(rule) {
        return (rule?.headers ?? []).find((header) => header.key === 'Cache-Control')?.value;
    }

    it('does not put an immutable wildcard header on /app/assets misses', () => {
        expect(findRule('/app/assets/**')).toBeUndefined();
    });

    it('keeps the generic js/css rule short-lived for cache-busted legacy assets', () => {
        const genericRule = findRule('**/*.@(js|css)');
        expect(genericRule).toBeTruthy();
        expect(cacheControl(genericRule)).toBe('max-age=3600');
    });

    it('excludes missing /app/assets files from the app shell rewrite', () => {
        // Stale hashed chunk URLs should 404 instead of rewriting to /index.html
        // while avoiding an immutable wildcard header on the 404 response.
        expect(rewrites).toContainEqual({
            source: '!/app/assets/**',
            destination: '/index.html',
        });
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
