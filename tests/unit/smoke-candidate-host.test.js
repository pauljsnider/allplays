import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
    getCandidateHostChecks,
    normalizeCandidateOrigin,
    smokeCandidateHost
} from '../../scripts/smoke-candidate-host.mjs';

const candidateOrigin = 'https://candidate.example.test';
const runtimeConfig = JSON.parse(
    readFileSync(new URL('../../.well-known/allplays-runtime-config.json', import.meta.url), 'utf8')
);

function successfulResponse(path) {
    const check = getCandidateHostChecks().find((candidate) => candidate.path === path);
    const body = path === '/.well-known/allplays-runtime-config.json'
        ? JSON.stringify(runtimeConfig)
        : '<!doctype html>';
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
    it('normalizes the supplied URL to one HTTPS origin for every configured request', async () => {
        const fetchImpl = createFetch();

        const verifiedUrls = await smokeCandidateHost(
            ' https://candidate.example.test/preview/path?channel=test#ignored ',
            { fetchImpl }
        );

        expect(normalizeCandidateOrigin('https://candidate.example.test/')).toBe(candidateOrigin);
        expect(verifiedUrls).toEqual([
            `${candidateOrigin}/`,
            `${candidateOrigin}/login.html`,
            `${candidateOrigin}/teams.html`,
            `${candidateOrigin}/widget-scoreboard.html`,
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

    it('fails with the requested URL when a route is unavailable', async () => {
        const fetchImpl = createFetch({
            '/login.html': () => new Response('missing', { status: 404 })
        });

        await expect(smokeCandidateHost(candidateOrigin, { fetchImpl })).rejects.toThrow(
            `${candidateOrigin}/login.html: expected HTTP 200 but observed HTTP 404`
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
