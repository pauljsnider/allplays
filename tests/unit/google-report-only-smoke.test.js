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

function pendingAnchor({ url = 'https://www.google.com/recaptcha/enterprise/anchor', type = 'document', navigation = true, parent = true, top } = {}) {
    const page = fixture(top);
    const frame = { parentFrame: () => parent ? {} : null, url: () => 'about:blank', isDetached: () => false };
    page.frames = () => [frame];
    const request = { url: () => url, resourceType: () => type, isNavigationRequest: () => navigation, frame: () => frame };
    const issues = collectAppRuntimeIssues(page, [], { includeApiFailures: true });
    page.emit('request', request);
    return { page, frame, request, issues };
}

describe('Google child navigation evidence before frame commit', () => {
    it('recognizes the exact diagnostic after an observed child anchor navigation', () => {
        const { page, issues } = pendingAnchor();
        emit(page, diagnostic);
        expect(issues).toEqual([]);
    });

    it.each([
        { type: 'fetch' }, { navigation: false }, { parent: false },
        { url: 'https://www.google.com.evil.test/recaptcha/enterprise/anchor' },
        { url: 'https://www.google.com/other' },
        { url: 'https://user:secret@www.google.com/recaptcha/enterprise/anchor' },
        { url: 'http://www.google.com/recaptcha/enterprise/anchor' },
        { top: 'https://evil.test/app/' },
        { top: 'https://user:secret@allplays.ai/app/' }
    ])('does not trust unrelated or unscoped navigation: %j', options => {
        const { page, issues } = pendingAnchor(options);
        emit(page, diagnostic);
        expect(issues).toHaveLength(1);
    });

    it.each(['requestfailed', 'framedetached', 'child-navigation', 'top-navigation'])('retires stale navigation evidence after %s', event => {
        const { page, frame, request, issues } = pendingAnchor();
        if (event === 'requestfailed') {
            request.failure = () => ({ errorText: 'net::ERR_FAILED' });
            page.emit(event, request);
        } else if (event === 'framedetached') page.emit(event, frame);
        else if (event === 'top-navigation') page.emit('framenavigated', { parentFrame: () => null });
        else {
            frame.url = () => 'https://example.test/';
            page.emit('framenavigated', frame);
        }
        emit(page, diagnostic);
        expect(issues.some(issue => issue.startsWith('console:'))).toBe(true);
    });

    it('retains enforced CSP and network failures with valid navigation evidence', () => {
        const { page, request, issues } = pendingAnchor();
        emit(page, diagnostic);
        emit(page, diagnostic.replace('report-only ', ''));
        page.emit('response', { status: () => 503, request: () => request, url: request.url });
        expect(issues.map(issue => issue.split(':')[0])).toEqual(['console', 'response']);
    });

    it.each(['new-navigation', 'detached-state', 'unreadable-frame', 'changed-top'])('rejects unusable navigation evidence: %s', state => {
        const { page, frame, request, issues } = pendingAnchor();
        if (state === 'new-navigation') page.emit('request', { ...request, url: () => 'https://example.test/' });
        else if (state === 'detached-state') frame.isDetached = () => true;
        else if (state === 'unreadable-frame') frame.isDetached = () => { throw new Error('unavailable'); };
        else page.url = () => 'https://evil.test/app/';
        emit(page, diagnostic);
        expect(issues).toHaveLength(1);
    });
});

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

    it.each(['', 'not a URL', 'about:blank'])('checks later frame evidence after an unrelated frame URL %j', (url) => {
        const page = fixture();
        page.frames = () => [
            { parentFrame: () => ({}), url: () => url },
            { parentFrame: () => ({}), url: () => 'https://www.google.com/recaptcha/enterprise/anchor' }
        ];
        const issues = collectAppRuntimeIssues(page);
        emit(page, diagnostic);
        expect(issues).toEqual([]);
    });

    it.each(['', 'not a URL', 'about:blank'])('never treats an unrelated frame URL %j as anchor evidence', (url) => {
        const page = fixture();
        page.frames = () => [{ parentFrame: () => ({}), url: () => url }];
        const issues = collectAppRuntimeIssues(page);
        emit(page, diagnostic);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toContain('frames=no-anchor');
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


describe('rejected Google diagnostic evidence', () => {
    it('captures missing frame evidence without later reclassifying the issue', () => {
        const page = fixture();
        page.frames = () => [];
        const issues = collectAppRuntimeIssues(page);
        emit(page, diagnostic);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toContain('[google-frame-context:top=allowed;frames=no-anchor;location=unavailable]');
        page.frames = () => [{ parentFrame: () => ({}), url: () => 'https://www.google.com/recaptcha/enterprise/anchor' }];
        expect(issues).toHaveLength(1);
        expect(issues[0]).toContain('frames=no-anchor');
    });

    it('records only fixed categories for credential-bearing and unknown URLs', () => {
        const page = fixture('https://secret:short@allplays.ai/app/?token=abc#private',
            'https://secret:short@www.google.com/recaptcha/enterprise/anchor?token=abc');
        const issues = collectAppRuntimeIssues(page);
        page.emit('console', {
            type: () => 'error', text: () => diagnostic,
            location: () => ({ url: 'https://private.example/child-name?token=abc' })
        });
        expect(issues).toHaveLength(1);
        expect(issues[0]).toContain('[google-frame-context:top=rejected;frames=no-anchor;location=other]');
        for (const secret of ['secret', 'short', 'private.example', 'child-name', 'token=abc']) {
            expect(issues[0]).not.toContain(secret);
        }
    });

    it('retains errors when page and frame access throw, without serializing their contents', () => {
        const page = fixture();
        page.url = () => { throw new Error('secret-page'); };
        page.frames = () => { throw new Error('secret-frame'); };
        const issues = collectAppRuntimeIssues(page);
        emit(page, diagnostic);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toContain('[google-frame-context:top=unavailable;frames=unavailable;location=unavailable]');
        expect(issues[0]).not.toContain('secret');
    });

    it('does not attach context to different console errors', () => {
        const page = fixture();
        const issues = collectAppRuntimeIssues(page);
        emit(page, 'Content Security Policy blocked a frame');
        expect(issues).toEqual(['console:Content Security Policy blocked a frame']);
    });
});
