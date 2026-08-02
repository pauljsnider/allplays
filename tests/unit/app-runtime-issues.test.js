import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { collectAppRuntimeIssues } from '../../tests/smoke/helpers/app-auth.js';

function request(resourceType, url, failure = null) {
    return {
        resourceType: () => resourceType,
        url: () => url,
        failure: () => failure
    };
}

describe('app runtime issue collection', () => {
    it('captures sanitized browser, API, and image failures without query data', () => {
        const page = new EventEmitter();
        const issues = collectAppRuntimeIssues(page, ['private-value'], { includeApiFailures: true });

        page.emit('pageerror', new Error('private-value crashed'));
        page.emit('console', { type: () => 'error', text: () => 'private-value console failure' });
        page.emit('requestfailed', request(
            'fetch',
            'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=private-value',
            { errorText: 'net::ERR_FAILED' }
        ));
        page.emit('response', {
            status: () => 503,
            url: () => 'https://firebasestorage.googleapis.com/v0/b/project/o/image.png?token=private-value',
            request: () => request('image', '')
        });

        expect(issues).toEqual([
            'pageerror:[REDACTED] crashed',
            'console:[REDACTED] console failure',
            'network:net::ERR_FAILED:https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode',
            'response:503:https://firebasestorage.googleapis.com/v0/b/project/o/image.png'
        ]);
        expect(issues.join(' ')).not.toContain('private-value');
        expect(issues.join(' ')).not.toContain('?');
    });

    it('ignores successful requests and the narrow known-benign console allowlist', () => {
        const page = new EventEmitter();
        const issues = collectAppRuntimeIssues(page, [], { includeApiFailures: true });

        page.emit('console', { type: () => 'error', text: () => 'messaging/unsupported-browser' });
        page.emit('response', {
            status: () => 204,
            url: () => 'https://example.test/ok',
            request: () => request('xhr', '')
        });

        expect(issues).toEqual([]);
    });

    it('keeps broad API monitoring opt-in for the parent census', () => {
        const page = new EventEmitter();
        const issues = collectAppRuntimeIssues(page);

        page.emit('response', {
            status: () => 500,
            url: () => 'https://example.test/api',
            request: () => request('xhr', '')
        });
        page.emit('requestfailed', request('script', 'https://example.test/app.js', { errorText: 'failed' }));

        expect(issues).toEqual(['asset:failed:https://example.test/app.js']);
    });
});
