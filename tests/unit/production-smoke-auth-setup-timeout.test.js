import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const helper = readFileSync('tests/smoke/helpers/app-auth.js', 'utf8');
const authenticatedCore = readFileSync('tests/smoke/app-authenticated-core.spec.js', 'utf8');
const adminCore = readFileSync('tests/smoke/app-admin-core.spec.js', 'utf8');
const authenticatedExtended = readFileSync('tests/smoke/app-authenticated-extended.spec.js', 'utf8');

describe('production smoke authenticated setup timeout', () => {
    it('uses an explicit bounded setup budget for every credentialed role suite', () => {
        expect(helper).toContain('export const AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS = 180_000;');

        for (const source of [authenticatedCore, adminCore, authenticatedExtended]) {
            expect(source).toContain('AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS');
            expect(source).toMatch(
                /test\.beforeAll\(async \(\) => \{\s+test\.setTimeout\(AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS\);/
            );
        }
    });

    it('keeps Firebase authentication in a live context without serializing IndexedDB state', () => {
        const authenticatedSessionHelper = helper.slice(
            helper.indexOf('export async function createAuthenticatedAppSession'),
            helper.indexOf('export async function openAuthenticatedAppRoute')
        );

        expect(authenticatedSessionHelper).toContain('await signInToApp(page, credentials);');
        expect(authenticatedSessionHelper).toContain('return { context, page };');
        expect(authenticatedSessionHelper).not.toContain('storageState(');
        expect(authenticatedSessionHelper).not.toContain('page.reload(');

        for (const source of [authenticatedCore, adminCore, authenticatedExtended]) {
            expect(source).toContain('createAuthenticatedAppSession');
            expect(source).not.toContain('createAuthenticatedStorageState');
            expect(source).not.toContain('storageState:');
        }
    });
});
