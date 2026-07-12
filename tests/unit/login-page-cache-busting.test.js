import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('login page cache busting', () => {
    it('loads the current login redirect helper module versions', () => {
        const source = readFileSync(resolve(process.cwd(), 'login.html'), 'utf8');

        expect(source).toContain(
            "import { getPostAuthRedirectUrl } from './js/invite-redirect.js?v=3';"
        );
        expect(source).toContain(
            "import * as loginPageModule from './js/login-page.js?v=7';"
        );
    });

    it('sets the buffered auth replay flag before follow-up Google redirect work that can fail', () => {
        const source = readFileSync(resolve(process.cwd(), 'login.html'), 'utf8');
        const successBlock = source.slice(
            source.indexOf('if (result && result.user) {'),
            source.indexOf('} else {')
        );

        expect(source).toContain('let shouldConsumePendingRedirectUser = false;');
        expect(successBlock.indexOf('shouldConsumePendingRedirectUser = true;'))
            .toBeLessThan(successBlock.indexOf("const profile = await getUserProfile(result.user.uid);"));
        expect(source).toContain('authState.finishProcessing({ keepPendingRedirectUser: shouldConsumePendingRedirectUser });');
    });
});
