import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { collectAppRuntimeIssues } from '../smoke/helpers/app-auth.js';

const diagnostic = `Framing 'https://www.google.com/' violates the following report-only Content Security Policy directive: "frame-ancestors 'self'". The violation has been logged, but no further action has been taken.
`;
function fixture(top = 'https://allplays.ai/app/#/home', frame = 'https://www.google.com/recaptcha/enterprise/anchor') {
    const page = new EventEmitter();
    page.url = () => top;
    page.frames = () => [{ parentFrame: () => ({}), url: () => frame }];
    return page;
}
function emit(page, text) {
    page.emit('console', { type: () => 'error', text: () => text });
}

describe('Google report-only framing diagnostic in app smoke', () => {
    it('classifies only the observed non-enforcing warning with an embedded anchor', () => {
        const page = fixture();
        const issues = collectAppRuntimeIssues(page);
        emit(page, diagnostic);
        expect(issues).toEqual([]);
    });

    it.each([
        diagnostic.replace('report-only ', ''),
        diagnostic.replace('no further action has been taken.', 'the frame has been blocked.'),
        diagnostic.replace('https://www.google.com/', 'https://evil.test/'),
        diagnostic.replace('https://www.google.com/', 'https://www.google.com.evil.test/'),
        diagnostic.replace('frame-ancestors', 'script-src'),
        diagnostic.replace("'self'", "'none'"),
        diagnostic + 'Additional API failure',
        'Uncaught error: ' + diagnostic,
        'Failed to load resource: the server responded with a status of 403 ()',
        'Content Security Policy blocked a frame'
    ])('retains other console failures: %s', (text) => {
        const page = fixture();
        const issues = collectAppRuntimeIssues(page);
        emit(page, text);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatch(/^console:/);
    });

    it.each([
        ['https://evil.test/app/', 'https://www.google.com/recaptcha/enterprise/anchor'],
        ['https://allplays.ai.evil.test/app/', 'https://www.google.com/recaptcha/enterprise/anchor'],
        ['https://user@allplays.ai/app/', 'https://www.google.com/recaptcha/enterprise/anchor'],
        ['https://allplays.ai/app/', 'https://evil.test/recaptcha/enterprise/anchor'],
        ['https://allplays.ai/app/', 'https://www.google.com/other'],
        ['https://allplays.ai/app/', 'https://user@www.google.com/recaptcha/enterprise/anchor']
    ])('fails closed outside the scoped page/frame: %s %s', (top, frame) => {
        const page = fixture(top, frame);
        const issues = collectAppRuntimeIssues(page);
        emit(page, diagnostic);
        expect(issues).toHaveLength(1);
    });

    it('retains the warning without readable embedded-frame evidence', () => {
        const page = fixture();
        page.frames = () => { throw new Error('unavailable'); };
        const issues = collectAppRuntimeIssues(page);
        emit(page, diagnostic);
        expect(issues).toHaveLength(1);
    });

    it.each([
        { frames: [] },
        { frames: [{ parentFrame: () => null, url: () => 'https://www.google.com/recaptcha/enterprise/anchor' }] }
    ])('requires a child frame, not a top-level Google page: %j', ({ frames }) => {
        const page = fixture();
        page.frames = () => frames;
        const issues = collectAppRuntimeIssues(page);
        emit(page, diagnostic);
        expect(issues).toHaveLength(1);
    });

    it('preserves pageerrors, API failures and enforced CSP beside the diagnostic', () => {
        const page = fixture();
        const issues = collectAppRuntimeIssues(page, [], { includeApiFailures: true });
        emit(page, diagnostic);
        page.emit('pageerror', new Error(diagnostic));
        emit(page, diagnostic.replace('report-only ', ''));
        const request = { resourceType: () => 'fetch', url: () => 'https://example.test/api', failure: () => ({ errorText: 'net::ERR_FAILED' }) };
        page.emit('requestfailed', request);
        page.emit('response', { status: () => 403, url: request.url, request: () => request });
        expect(issues).toHaveLength(4);
        expect(issues.map(issue => issue.split(':')[0])).toEqual(['pageerror', 'console', 'network', 'response']);
    });
});
