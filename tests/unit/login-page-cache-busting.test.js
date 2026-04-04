import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('login page cache busting', () => {
    it('loads the current login-page coordinator module version', () => {
        const source = readFileSync(resolve(process.cwd(), 'login.html'), 'utf8');

        expect(source).toContain(
            "import { createForgotPasswordHandler, createLoginRedirectCoordinator } from './js/login-page.js?v=2';"
        );
    });
});
