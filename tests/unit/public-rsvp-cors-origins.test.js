import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const functionsSource = readFileSync(resolve(process.cwd(), 'functions/index.js'), 'utf8');
const corsCoreSource = readFileSync(resolve(process.cwd(), 'functions/public-rsvp-cors-core.cjs'), 'utf8');
const { isAllowedPublicRsvpOrigin } = require(resolve(process.cwd(), 'functions/public-rsvp-cors-core.cjs'));

function extractPublicRsvpCorsWrapper(functionsFileSource) {
    const start = functionsFileSource.indexOf('function writePublicRsvpCors(req, res)');
    expect(start, 'Expected writePublicRsvpCors to exist in functions/index.js').toBeGreaterThanOrEqual(0);

    const end = functionsFileSource.indexOf('\nfunction publicRsvpJsonError', start);
    expect(end, 'Expected writePublicRsvpCors to end before publicRsvpJsonError').toBeGreaterThan(start);
    return functionsFileSource.slice(start, end);
}

describe('public RSVP CORS origins', () => {
    it('keeps the HTTPS function wrapper delegated to the shared origin allowlist', () => {
        const publicRsvpCorsWrapper = extractPublicRsvpCorsWrapper(functionsSource);

        expect(functionsSource).toContain("require('./public-rsvp-cors-core.cjs')");
        expect(publicRsvpCorsWrapper).toContain('function writePublicRsvpCors(req, res)');
        expect(publicRsvpCorsWrapper).toContain('isAllowedPublicRsvpOrigin(origin)');
        expect(publicRsvpCorsWrapper).not.toContain("Access-Control-Allow-Origin', '*'");
        expect(corsCoreSource).not.toContain("Access-Control-Allow-Origin': '*'");
    });

    it('allows the production domains and Firebase Hosting default domains', () => {
        expect(isAllowedPublicRsvpOrigin('https://allplays.ai')).toBe(true);
        expect(isAllowedPublicRsvpOrigin('https://www.allplays.ai')).toBe(true);
        expect(isAllowedPublicRsvpOrigin('https://game-flow-c6311.web.app')).toBe(true);
        expect(isAllowedPublicRsvpOrigin('https://game-flow-c6311.firebaseapp.com')).toBe(true);
    });

    it('allows expected dev and Firebase preview origins without widening to lookalikes', () => {
        expect(isAllowedPublicRsvpOrigin('http://localhost:5174')).toBe(true);
        expect(isAllowedPublicRsvpOrigin('http://127.0.0.1:5174')).toBe(true);
        expect(isAllowedPublicRsvpOrigin('https://game-flow-c6311--pr-3864-abc123.web.app')).toBe(true);
        expect(isAllowedPublicRsvpOrigin('*')).toBe(false);
        expect(isAllowedPublicRsvpOrigin('https://game-flow-c6311--x.web.app.evil.com')).toBe(false);
        expect(isAllowedPublicRsvpOrigin('http://localhost:5174.evil.com')).toBe(false);
    });

    it('no longer allows the retired GitHub Pages origin', () => {
        expect(isAllowedPublicRsvpOrigin('https://pauljsnider.github.io')).toBe(false);
        expect(functionsSource).not.toContain('pauljsnider.github.io');
        expect(corsCoreSource).not.toContain('pauljsnider.github.io');
    });
});
