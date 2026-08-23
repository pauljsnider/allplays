import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
    configuredHeadersFor,
    getExpectedRuntimeConfig,
    getCandidateHostChecks,
    loadJson,
    normalizeCandidateOrigin,
    smokeCandidateHost
} from '../../scripts/smoke-candidate-host.mjs';

const candidateOrigin = 'https://candidate.example.test';
const successfulHtmlByPath = {
    '/': '<!doctype html><title>ALL PLAYS</title><body></body>',
    '/app/': '<!doctype html><title>ALL PLAYS APP</title><main id="root"></main>',
    '/teams.html': '<!doctype html><title>Browse Teams - ALL PLAYS</title><div id="teams-list"></div>',
    '/privacy.html': '<!doctype html><title>Privacy Policy | ALL PLAYS</title><main><h1>Privacy Policy</h1></main>',
    '/terms.html': '<!doctype html><title>Terms of Use | ALL PLAYS</title><main><h1>Terms of Use</h1></main>',
    '/support.html': '<!doctype html><title>Support | ALL PLAYS</title><main><h1>Support</h1></main>',
    '/account-deletion.html': '<!doctype html><title>Delete Account | ALL PLAYS</title><main><h1>Delete account</h1></main>',
    '/widget-scoreboard.html': '<!doctype html><title>ALL PLAYS Scoreboard Widget</title><main id="scoreboard-widget"></main>',
    '/live-game-overlay.html': '<!doctype html><title>Live Game Broadcast - ALL PLAYS</title><main id="broadcast-stage"><div id="score-bug"></div><iframe id="overlay-video"></iframe></main>',
    '/compare.html': '<!doctype html><title>ALL PLAYS — Explore the platform</title><div id="header-container"></div><footer></footer>',
    '/about.html': '<!doctype html><title>ALL PLAYS — About</title><div id="header-container"></div><footer></footer>',
    '/app.html': '<!doctype html><title>ALL PLAYS — Use the web app</title><div id="header-container"></div><footer></footer>'
};

function successfulResponse(path) {
    const check = getCandidateHostChecks().find(
        (candidate) => new URL(candidate.path, candidateOrigin).pathname === path
    );
    if (!check) throw new Error(`Test setup error: path ${path} not found in checks`);
    const body = path === '/.well-known/allplays-runtime-config.json'
        ? JSON.stringify(getExpectedRuntimeConfig())
        : successfulHtmlByPath[path];
    if (!body) throw new Error(`Test setup error: no successful body for path ${path}`);
    return new Response(body, {
        status: 200,
        headers: Object.fromEntries(check.expectedHeaders)
    });
}

function createFetch(overrides = {}) {
    return vi.fn(async (input) => {
        const path = new URL(input).pathname;
        return overrides[path]?.(path) ?? successfulResponse(path);
    });
}

describe('candidate host public smoke', () => {
    it.each([
        'firebase.json',
        '/.well-known/allplays-runtime-config.json'
    ])('reports %s parse failures with the source name', (sourceName) => {
        expect(() => loadJson(
            new URL('../../firebase.json', import.meta.url),
            sourceName,
            { readFile: () => '{invalid' }
        )).toThrow(`Failed to load ${sourceName}:`);
    });

    it('treats a missing Firebase hosting header configuration as no expected headers', () => {
        expect(configuredHeadersFor('/teams.html', {})).toEqual(new Map());
        expect(configuredHeadersFor('/teams.html', { hosting: {} })).toEqual(new Map());
    });

    it('keeps the expected runtime configuration paused without the rollout-ready gate', () => {
        expect(getExpectedRuntimeConfig({
            siteKey: ' public-site-key_123 '
        })).toMatchObject({
            appCheck: {
                enabled: false,
                isTokenAutoRefreshEnabled: true
            }
        });
    });

    it('expects an enabled runtime configuration only with a rollout-ready key', () => {
        expect(getExpectedRuntimeConfig({
            siteKey: ' public-site-key_123 ',
            enforcementReady: true
        })).toMatchObject({
            appCheck: {
                enabled: true,
                recaptchaEnterpriseSiteKey: 'public-site-key_123',
                isTokenAutoRefreshEnabled: true
            }
        });
        expect(() => getExpectedRuntimeConfig({
            siteKey: 'invalid key',
            enforcementReady: true
        })).toThrow(/enforcement-ready staging requires a valid/);
    });

    it('normalizes the supplied URL to one HTTPS origin for every configured request', async () => {
        const fetchImpl = createFetch();

        const verifiedUrls = await smokeCandidateHost(
            ' https://candidate.example.test/preview/path?channel=test#ignored ',
            { fetchImpl }
        );

        expect(normalizeCandidateOrigin('https://candidate.example.test/')).toBe(candidateOrigin);
        expect(verifiedUrls).toEqual([
            `${candidateOrigin}/`,
            `${candidateOrigin}/app/#/auth`,
            `${candidateOrigin}/teams.html`,
            `${candidateOrigin}/widget-scoreboard.html`,
            `${candidateOrigin}/live-game-overlay.html?demo=1`,
            `${candidateOrigin}/privacy.html`,
            `${candidateOrigin}/terms.html`,
            `${candidateOrigin}/support.html`,
            `${candidateOrigin}/account-deletion.html`,
            `${candidateOrigin}/compare.html`,
            `${candidateOrigin}/about.html`,
            `${candidateOrigin}/app.html`,
            `${candidateOrigin}/.well-known/allplays-runtime-config.json`
        ]);
        expect(fetchImpl.mock.calls.every(([url]) => new URL(url).origin === candidateOrigin)).toBe(true);
    });

    it('reports the failing URL, header name, expected value, and observed value', async () => {
        const fetchImpl = createFetch({
            '/teams.html': (path) => {
                const response = successfulResponse(path);
                response.headers.set('X-Content-Type-Options', 'unsafe');
                return response;
            }
        });

        await expect(smokeCandidateHost(candidateOrigin, { fetchImpl })).rejects.toThrow(
            `${candidateOrigin}/teams.html: header "X-Content-Type-Options" expected "nosniff" but observed "unsafe"`
        );
    });

    it('accepts a stronger Firebase-managed HSTS policy', async () => {
        const fetchImpl = createFetch({
            '/': (path) => {
                const response = successfulResponse(path);
                response.headers.set(
                    'Strict-Transport-Security',
                    'max-age=31556926; includeSubDomains; preload'
                );
                return response;
            }
        });

        await expect(smokeCandidateHost(candidateOrigin, { fetchImpl })).resolves.toHaveLength(13);
    });

    it('rejects an HSTS policy below the configured max-age', async () => {
        const fetchImpl = createFetch({
            '/': (path) => {
                const response = successfulResponse(path);
                response.headers.set('Strict-Transport-Security', 'max-age=300');
                return response;
            }
        });

        await expect(smokeCandidateHost(candidateOrigin, { fetchImpl })).rejects.toThrow(
            `${candidateOrigin}/: header "Strict-Transport-Security" expected max-age at least 31536000 but observed "max-age=300"`
        );
    });

    it('rejects an invalid HSTS max-age value', async () => {
        const fetchImpl = createFetch({
            '/': (path) => {
                const response = successfulResponse(path);
                response.headers.set('Strict-Transport-Security', 'max-age=31536000invalid');
                return response;
            }
        });

        await expect(smokeCandidateHost(candidateOrigin, { fetchImpl })).rejects.toThrow(
            `${candidateOrigin}/: header "Strict-Transport-Security" expected max-age at least 31536000 but observed "max-age=31536000invalid"`
        );
    });

    it('rejects duplicate HSTS max-age directives', async () => {
        const fetchImpl = createFetch({
            '/': (path) => {
                const response = successfulResponse(path);
                response.headers.set(
                    'Strict-Transport-Security',
                    'max-age=0; max-age=31536000; includeSubDomains'
                );
                return response;
            }
        });

        await expect(smokeCandidateHost(candidateOrigin, { fetchImpl })).rejects.toThrow(
            `${candidateOrigin}/: header "Strict-Transport-Security" rejected duplicate directive "max-age"`
        );
    });

    it('rejects duplicate required HSTS directives', async () => {
        const fetchImpl = createFetch({
            '/': (path) => {
                const response = successfulResponse(path);
                response.headers.set(
                    'Strict-Transport-Security',
                    'max-age=31536000; includeSubDomains; IncludeSubDomains'
                );
                return response;
            }
        });

        await expect(smokeCandidateHost(candidateOrigin, { fetchImpl })).rejects.toThrow(
            `${candidateOrigin}/: header "Strict-Transport-Security" rejected duplicate directive "includesubdomains"`
        );
    });

    it('fails with the requested URL when a route is unavailable', async () => {
        const fetchImpl = createFetch({
            '/app/': () => new Response('missing', { status: 404 })
        });

        await expect(smokeCandidateHost(candidateOrigin, { fetchImpl })).rejects.toThrow(
            `${candidateOrigin}/app/#/auth: expected HTTP 200 but observed HTTP 404`
        );
    });

    it('rejects a catch-all rewrite that serves homepage HTML for a public route', async () => {
        const fetchImpl = createFetch({
            '/app/': (path) => {
                const response = successfulResponse(path);
                return new Response(successfulHtmlByPath['/'], {
                    status: 200,
                    headers: response.headers
                });
            }
        });

        await expect(smokeCandidateHost(candidateOrigin, { fetchImpl })).rejects.toThrow(
            `${candidateOrigin}/app/#/auth: title expected /ALL PLAYS APP/i but observed "ALL PLAYS"`
        );
    });

    it('rejects route HTML that has the expected title but not its readiness marker', async () => {
        const fetchImpl = createFetch({
            '/teams.html': (path) => {
                const response = successfulResponse(path);
                return new Response('<title>Teams - ALL PLAYS</title><body></body>', {
                    status: 200,
                    headers: response.headers
                });
            }
        });

        await expect(smokeCandidateHost(candidateOrigin, { fetchImpl })).rejects.toThrow(
            `${candidateOrigin}/teams.html: expected at least one readiness selector: #teams-list`
        );
    });

    it('fails when the candidate runtime configuration differs from the staged contract', async () => {
        const fetchImpl = createFetch({
            '/.well-known/allplays-runtime-config.json': (path) => {
                const response = successfulResponse(path);
                return new Response(JSON.stringify({ appCheck: { enabled: true } }), {
                    status: 200,
                    headers: response.headers
                });
            }
        });

        await expect(smokeCandidateHost(candidateOrigin, { fetchImpl })).rejects.toThrow(
            `${candidateOrigin}/.well-known/allplays-runtime-config.json: runtime configuration expected`
        );
    });

    it('exposes a package command and rejects insecure candidate origins', () => {
        const packageJson = JSON.parse(
            readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
        );

        expect(packageJson.scripts['smoke:candidate-host'])
            .toBe('node scripts/smoke-candidate-host.mjs');
        expect(() => normalizeCandidateOrigin('http://candidate.example.test'))
            .toThrow('Candidate origin must use HTTPS');
    });
});
