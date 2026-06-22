import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Firebase Functions vendor module', () => {
    it('uses the real Functions SDK bundle instead of the dummy callable shim', () => {
        const source = readFileSync(new URL('../../js/vendor/firebase-functions.js', import.meta.url), 'utf8');

        expect(source).toContain('from"./firebase-app.js"');
        expect(source).toContain('function getFunctions');
        expect(source).toContain('function httpsCallable');
        expect(source).toContain('registerFunctions');
        expect(source).not.toContain('Dummy function called successfully');
        expect(source).not.toContain('Dummy getFunctions called');
        expect(source).not.toContain('Dummy httpsCallable');
    });
});
