import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const firebaseConfig = JSON.parse(
    readFileSync(new URL('../../firebase.json', import.meta.url), 'utf8')
);
const firebaseAuthVendor = readFileSync(
    new URL('../../js/vendor/firebase-auth.js', import.meta.url),
    'utf8'
);

function headerMapFor(source) {
    const rule = firebaseConfig.hosting.headers.find((candidate) => candidate.source === source);
    return new Map((rule?.headers || []).map((header) => [header.key, header.value]));
}

describe('Firebase Hosting security headers', () => {
    const globalHeaders = headerMapFor('**');
    const globalCsp = globalHeaders.get('Content-Security-Policy') || '';

    it('enforces baseline browser security headers on every hosted response', () => {
        expect(globalHeaders.get('Strict-Transport-Security')).toBe('max-age=31536000');
        expect(globalHeaders.get('X-Content-Type-Options')).toBe('nosniff');
        expect(globalHeaders.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
        expect(globalHeaders.get('Permissions-Policy')).toContain('camera=(self)');
        expect(globalCsp).toContain("default-src 'self'");
        expect(globalCsp).toContain("object-src 'none'");
        expect(globalCsp).toContain("frame-ancestors 'self'");
        expect(globalCsp).toContain('upgrade-insecure-requests');
    });

    it('preserves Firebase Auth, App Check, AI, analytics, media, and legacy Tailwind dependencies', () => {
        expect(globalCsp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
        expect(globalCsp).toContain('https://cdn.tailwindcss.com');
        expect(globalCsp).toContain('https://www.gstatic.com');
        expect(globalCsp).toContain('https://www.google.com');
        expect(globalCsp).toContain('https://apis.google.com');
        expect(globalCsp).toContain('https://www.googletagmanager.com');
        expect(globalCsp).toContain('https://*.firebaseapp.com');
        expect(globalCsp).toContain('https://www.youtube.com');
        expect(globalCsp).toContain('https://player.twitch.tv');
        expect(globalCsp).toContain("connect-src 'self' https: wss:");
        expect(globalCsp).not.toContain("default-src *");
    });

    it('allows the exact Google API loader used by Firebase Auth popup flows', () => {
        const loaderUrl = firebaseAuthVendor.match(/gapiScript:"(https:\/\/[^\"]+)"/)?.[1];

        expect(loaderUrl).toBe('https://apis.google.com/js/api.js');
        expect(globalCsp).toContain(new URL(loaderUrl).origin);
    });

    it('keeps the documented external scoreboard iframe functional', () => {
        const widgetCsp = headerMapFor('/widget-scoreboard.html').get('Content-Security-Policy');
        expect(widgetCsp).toContain('frame-ancestors *');
        expect(widgetCsp).not.toContain("frame-ancestors 'self'");
        expect(widgetCsp).toContain('https://www.google.com');
        expect(widgetCsp).toContain('https://*.firebaseapp.com');
    });

    it('prevents caching the staged runtime configuration', () => {
        const runtimeHeaders = headerMapFor('/.well-known/allplays-runtime-config.json');
        expect(runtimeHeaders.get('Cache-Control')).toBe('no-store');
        expect(runtimeHeaders.get('Content-Security-Policy')).toContain("default-src 'none'");
        expect(runtimeHeaders.get('Strict-Transport-Security')).toBe('max-age=31536000');
        expect(runtimeHeaders.get('X-Content-Type-Options')).toBe('nosniff');
    });
});
