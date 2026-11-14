import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@playwright/test', async () => ({ expect: (await import('vitest')).expect, test: {} }));
const { collectAppRuntimeIssues } = await import('../smoke/helpers/app-auth.js');

const anchor = 'https://www.google.com/recaptcha/enterprise/anchor?public=fixture';
const warning = 'requestStorageAccess: Permission denied.';
function fixture({ source = anchor, frame = anchor, parent = true, origin = 'https://allplays.ai/app/' } = {}) {
    const page = new EventEmitter();
    page.url = () => origin;
    page.frames = () => [{ url: () => frame, parentFrame: () => parent ? {} : null }];
    const issues = collectAppRuntimeIssues(page, [], { includeApiFailures: true });
    const emit = (text = warning, url = source) => page.emit('console', {
        type: () => 'error', text: () => text, location: () => ({ url })
    });
    return { page, issues, emit };
}

describe('reCAPTCHA iframe optional storage permission diagnostic', () => {
    it('does not treat the exact embedded Google storage denial as an application failure', () => {
        const { issues, emit } = fixture();
        emit();
        expect(issues).toEqual([]);
    });

    it.each([
        { source: 'https://allplays.ai/app/app.js' },
        { source: 'https://www.google.com.evil.invalid/recaptcha/enterprise/anchor' },
        { source: 'http://www.google.com/recaptcha/enterprise/anchor' },
        { source: 'https://www.google.com/recaptcha/enterprise/other' },
        { source: 'https://user:password@www.google.com/recaptcha/enterprise/anchor' },
        { source: '' },
        { frame: 'https://www.google.com/other' },
        { parent: false },
        { origin: 'https://untrusted.invalid/' }
    ])('keeps the warning fatal without exact trusted embedded-frame provenance: %j', (options) => {
        const { issues, emit } = fixture(options);
        emit();
        expect(issues).toEqual([`console:${warning}`]);
    });

    it('retains real exchange, auth, application, page and network errors beside the warning', () => {
        const { page, issues, emit } = fixture();
        emit();
        emit('Failed to load resource: the server responded with a status of 403 ()');
        emit('FirebaseError: AppCheck token exchange failed');
        emit('auth/invalid-credential');
        page.emit('pageerror', new Error(warning));
        const url = 'https://content-firebaseappcheck.googleapis.com/v1/exchangeDebugToken';
        page.emit('response', { status: () => 403, url: () => url, request: () => ({ resourceType: () => 'fetch' }) });
        page.emit('requestfailed', { resourceType: () => 'fetch', url: () => url, failure: () => ({ errorText: 'ERR_FAILED' }) });
        expect(issues).toHaveLength(6);
        expect(issues).toContain(`pageerror:${warning}`);
        expect(issues).toContain(`response:403:${url}`);
        expect(issues).toContain(`network:ERR_FAILED:${url}`);
        expect(issues.filter(x => x.startsWith('console:'))).toHaveLength(3);
    });

    it('fails closed when source location or frame APIs are unavailable', () => {
        const { page, issues } = fixture();
        page.frames = undefined;
        page.emit('console', { type: () => 'error', text: () => warning });
        expect(issues).toEqual([`console:${warning}`]);
    });
});
