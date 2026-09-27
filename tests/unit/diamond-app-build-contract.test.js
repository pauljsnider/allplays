import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Diamond compatibility generation', () => {
    it('injects the same explicit hosted-web generation into every Vite entrypoint', () => {
        const appPackage = JSON.parse(readFileSync(new URL('../../apps/app/package.json', import.meta.url), 'utf8'));
        for (const script of ['dev', 'build', 'build:native', 'build:native-debug']) {
            expect(appPackage.scripts[script]).toContain('VITE_ALLPLAYS_APP_BUILD=2');
        }
    });

    it('keeps the legacy browser generation aligned with Diamond v2', () => {
        const source = readFileSync(new URL('../../js/diamond-scorebook-client.js', import.meta.url), 'utf8');
        expect(source).toContain('export const DIAMOND_LEGACY_APP_BUILD = 2;');
    });
});
