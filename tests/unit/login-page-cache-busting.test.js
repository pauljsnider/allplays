import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('login page cache busting', () => {
    it('loads the current login redirect helper module versions', () => {
        const source = readFileSync(resolve(process.cwd(), 'login.html'), 'utf8');

        expect(source).toContain(
            "import { getPostAuthRedirectUrl } from './js/invite-redirect.js?v=2';"
        );
        expect(source).toContain(
            "import * as loginPageModule from './js/login-page.js?v=6';"
        );
    });

    it('only replays buffered auth after successful redirect processing', () => {
        const source = readFileSync(resolve(process.cwd(), 'login.html'), 'utf8');

        expect(source).toContain('let shouldConsumePendingRedirectUser = false;');
        expect(source).toContain('shouldConsumePendingRedirectUser = true;');
        expect(source).toContain('authState.finishProcessing({ keepPendingRedirectUser: shouldConsumePendingRedirectUser });');
    });
});
