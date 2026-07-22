import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { verifyResponseHeaders } from '../../scripts/verify-response-headers.mjs';

const candidateOrigin = 'https://candidate.example.test';
const baselineCsp = "default-src 'self'; object-src 'none'; frame-ancestors 'self'; upgrade-insecure-requests";
const widgetCsp = "default-src 'self'; object-src 'none'; script-src 'self' https://www.gstatic.com; connect-src 'self' https:; frame-src 'self' https://*.firebaseapp.com https://recaptcha.google.com; frame-ancestors *; upgrade-insecure-requests";
const runtimeCsp = "default-src 'none'; frame-ancestors 'none'";

function securityHeaders(csp = baselineCsp, overrides = {}) {
    return {
        'Content-Security-Policy': csp,
        'Strict-Transport-Security': 'max-age=31556926; includeSubDomains; preload',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
        ...overrides
    };
}

function responseFor(path, overrides = {}) {
    if (path === '/app/') {
        return new Response('<link rel="stylesheet" href="./assets/app.css"><script src="./assets/app.js"></script>', {
            status: 200,
            headers: securityHeaders()
        });
    }
    if (path === '/widget-scoreboard.html') {
        return new Response('widget', { status: 200, headers: securityHeaders(widgetCsp) });
    }
    if (path === '/.well-known/allplays-runtime-config.json') {
        return new Response('{}', {
            status: 200,
            headers: securityHeaders(runtimeCsp, {
                'Cache-Control': 'no-store',
                'Referrer-Policy': 'no-referrer'
            })
        });
    }
    return new Response('ok', { status: 200, headers: securityHeaders() });
}

function createFetch(overrides = {}) {
    return vi.fn(async (input) => {
        const path = new URL(input).pathname;
        return overrides[path]?.(path) ?? responseFor(path);
    });
}

describe('candidate response header verification', () => {
    it('runs against the candidate origin after a successful deployment', () => {
        const workflow = readFileSync(
            new URL('../../.github/workflows/post-deploy-smoke.yml', import.meta.url),
            'utf8'
        );

        expect(workflow).toContain('node scripts/verify-response-headers.mjs https://game-flow-c6311.web.app');
        expect(workflow.indexOf('node scripts/verify-response-headers.mjs'))
            .toBeLessThan(workflow.indexOf('Run production smoke'));
    });

    it('validates root, React routes, discovered assets, widget, and runtime config', async () => {
        const fetchImpl = createFetch();

        const verifiedPaths = await verifyResponseHeaders(candidateOrigin, { fetchImpl });

        expect(verifiedPaths).toEqual([
            '/',
            '/app/',
            '/app/teams',
            '/app/assets/app.css',
            '/widget-scoreboard.html',
            '/.well-known/allplays-runtime-config.json'
        ]);
        expect(fetchImpl).toHaveBeenCalledTimes(6);
    });

    it('reports the path when a common security header is missing', async () => {
        const fetchImpl = createFetch({
            '/app/teams': () => new Response('ok', {
                status: 200,
                headers: securityHeaders(baselineCsp, { 'Permissions-Policy': '' })
            })
        });

        await expect(verifyResponseHeaders(candidateOrigin, { fetchImpl }))
            .rejects.toThrow('/app/teams: missing Permissions-Policy response header');
    });

    it('rejects weak HSTS and permissive framing on baseline responses', async () => {
        const weakHstsFetch = createFetch({
            '/': () => new Response('ok', {
                status: 200,
                headers: securityHeaders(baselineCsp, { 'Strict-Transport-Security': 'max-age=300' })
            })
        });
        const leakedWidgetPolicyFetch = createFetch({
            '/app/teams': () => new Response('ok', {
                status: 200,
                headers: securityHeaders(widgetCsp)
            })
        });

        await expect(verifyResponseHeaders(candidateOrigin, { fetchImpl: weakHstsFetch }))
            .rejects.toThrow('/: Strict-Transport-Security max-age must be at least 31536000 seconds');
        await expect(verifyResponseHeaders(candidateOrigin, { fetchImpl: leakedWidgetPolicyFetch }))
            .rejects.toThrow('/app/teams: baseline CSP must not allow frame-ancestors *');
    });

    it('rejects a restrictive or incomplete scoreboard embed policy', async () => {
        const fetchImpl = createFetch({
            '/widget-scoreboard.html': () => new Response('widget', {
                status: 200,
                headers: securityHeaders(baselineCsp)
            })
        });

        await expect(verifyResponseHeaders(candidateOrigin, { fetchImpl }))
            .rejects.toThrow('/widget-scoreboard.html: widget CSP must allow frame-ancestors *');
    });

    it('requires exact scoreboard CSP source values', async () => {
        const spoofedSourceCsp = widgetCsp.replace(
            'https://www.gstatic.com',
            'https://www.gstatic.com.evil.example'
        );
        const fetchImpl = createFetch({
            '/widget-scoreboard.html': () => new Response('widget', {
                status: 200,
                headers: securityHeaders(spoofedSourceCsp)
            })
        });

        await expect(verifyResponseHeaders(candidateOrigin, { fetchImpl }))
            .rejects.toThrow('/widget-scoreboard.html: widget CSP must preserve https://www.gstatic.com');
    });

    it('rejects duplicate scoreboard CSP directives', async () => {
        const duplicateFrameAncestorsCsp = widgetCsp.replace(
            'frame-ancestors *',
            "frame-ancestors 'self'; frame-ancestors *"
        );
        const fetchImpl = createFetch({
            '/widget-scoreboard.html': () => new Response('widget', {
                status: 200,
                headers: securityHeaders(duplicateFrameAncestorsCsp)
            })
        });

        await expect(verifyResponseHeaders(candidateOrigin, { fetchImpl }))
            .rejects.toThrow('/widget-scoreboard.html: CSP must not contain duplicate frame-ancestors directives');
    });

    it('rejects cacheable or frameable runtime configuration', async () => {
        const cacheableFetch = createFetch({
            '/.well-known/allplays-runtime-config.json': () => new Response('{}', {
                status: 200,
                headers: securityHeaders(runtimeCsp, {
                    'Cache-Control': 'public, max-age=300',
                    'Referrer-Policy': 'no-referrer'
                })
            })
        });
        const frameableFetch = createFetch({
            '/.well-known/allplays-runtime-config.json': () => new Response('{}', {
                status: 200,
                headers: securityHeaders("default-src 'none'; frame-ancestors *", {
                    'Cache-Control': 'no-store',
                    'Referrer-Policy': 'no-referrer'
                })
            })
        });

        await expect(verifyResponseHeaders(candidateOrigin, { fetchImpl: cacheableFetch }))
            .rejects.toThrow('/.well-known/allplays-runtime-config.json: Cache-Control must include no-store');
        await expect(verifyResponseHeaders(candidateOrigin, { fetchImpl: frameableFetch }))
            .rejects.toThrow("/.well-known/allplays-runtime-config.json: runtime CSP must include frame-ancestors 'none'");
    });

    it('fails when the React shell does not expose a deployed asset', async () => {
        const fetchImpl = createFetch({
            '/app/': () => new Response('<main>App</main>', {
                status: 200,
                headers: securityHeaders()
            })
        });

        await expect(verifyResponseHeaders(candidateOrigin, { fetchImpl }))
            .rejects.toThrow('/app/: no /app/assets/ URL was found in the React shell');
    });
});
