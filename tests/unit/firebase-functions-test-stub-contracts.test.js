import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const functionsTestDir = new URL('../../functions/test/', import.meta.url);

function discoverIndexLoadingFunctionsStubs() {
    return readdirSync(functionsTestDir)
        .filter((name) => /\.test\.(?:cjs|js)$/.test(name))
        .map((name) => ({
            name,
            source: readFileSync(new URL(name, functionsTestDir), 'utf8')
        }))
        .filter(({ source }) => (
            source.includes("'firebase-functions'")
            && source.includes('const triggerChain =')
            && source.includes('runWith: () => triggerChain')
            && (source.includes("require('../index.js')") || source.includes('require(repoIndexPath)'))
        ));
}

describe('Firebase Functions index-loader test stubs', () => {
    it('supports Auth triggers chained after runWith in every custom loader', () => {
        const stubs = discoverIndexLoadingFunctionsStubs();

        expect(stubs.length).toBeGreaterThan(0);
        for (const { name, source } of stubs) {
            expect(source, `${path.basename(name)} must expose Auth on the runWith trigger chain`)
                .toContain('triggerChain.auth = triggerChain;');
            expect(source, `${path.basename(name)} must support runWith(...).auth.user()`)
                .toMatch(/user\(\)\s*\{\s*return this;/);
        }
    });
});
