// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAuthBootstrapHint, readAuthBootstrapHint, writeAuthBootstrapHint } from './authBootstrapHint';

function installThrowingLocalStorageGetter() {
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
            throw new DOMException('Access denied', 'SecurityError');
        }
    });
}

describe('authBootstrapHint storage access', () => {
    beforeEach(() => {
        installThrowingLocalStorageGetter();
    });

    it('returns null when reading storage throws a SecurityError', () => {
        expect(readAuthBootstrapHint()).toBeNull();
    });

    it('swallows SecurityError when writing storage', () => {
        expect(() => writeAuthBootstrapHint({ uid: 'user-1', email: 'parent@example.com', displayName: 'Pat Parent', roles: ['parent'] })).not.toThrow();
    });

    it('swallows SecurityError when clearing storage', () => {
        expect(() => clearAuthBootstrapHint()).not.toThrow();
    });
});
