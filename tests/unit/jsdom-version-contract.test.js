import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readJson(relativePath) {
    return JSON.parse(readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8'));
}

describe('root jsdom dependency', () => {
    it('keeps the legacy Vitest harness on jsdom 30', () => {
        const packageJson = readJson('package.json');
        const packageLock = readJson('package-lock.json');

        expect(packageJson.dependencies.jsdom).toMatch(/^\^30\./);
        expect(packageLock.packages[''].dependencies.jsdom).toBe(packageJson.dependencies.jsdom);
        expect(packageLock.packages['node_modules/jsdom'].version).toMatch(/^30\./);
    });
});
