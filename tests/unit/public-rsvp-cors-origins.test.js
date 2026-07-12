import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'functions/index.js'), 'utf8');

function extractAllowedOrigins(functionsSource) {
    const start = functionsSource.indexOf('const PUBLIC_RSVP_ALLOWED_ORIGINS = new Set([');
    expect(start, 'Expected PUBLIC_RSVP_ALLOWED_ORIGINS to exist in functions/index.js').toBeGreaterThanOrEqual(0);

    const setStart = functionsSource.indexOf('new Set([', start);
    expect(setStart, 'Expected PUBLIC_RSVP_ALLOWED_ORIGINS to use a Set literal').toBeGreaterThan(start);
    const setEnd = functionsSource.indexOf('])', setStart);
    expect(setEnd, 'Expected closing ]) for the allowedOrigins Set literal').toBeGreaterThan(setStart);

    const literal = functionsSource.slice(setStart + 'new Set(['.length, setEnd);
    return literal
        .split(',')
        .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
}

function getPattern(patternName) {
    const match = source.match(new RegExp(`const ${patternName} = /(.*)/;`));
    expect(match, `Expected ${patternName} regex literal`).toBeTruthy();
    return new RegExp(match[1]);
}

describe('public RSVP CORS origins', () => {
    const origins = extractAllowedOrigins(source);
    const localDevPattern = getPattern('PUBLIC_RSVP_LOCAL_DEV_ORIGIN_PATTERN');
    const previewPattern = getPattern('PUBLIC_RSVP_PREVIEW_ORIGIN_PATTERN');

    it('allows the production domains and Firebase Hosting default domains', () => {
        expect(origins).toContain('https://allplays.ai');
        expect(origins).toContain('https://www.allplays.ai');
        expect(origins).toContain('https://game-flow-c6311.web.app');
        expect(origins).toContain('https://game-flow-c6311.firebaseapp.com');
    });

    it('allows localhost and loopback dev origins, including Vite app ports', () => {
        expect(localDevPattern.test('http://localhost:5174')).toBe(true);
        expect(localDevPattern.test('http://localhost:5175')).toBe(true);
        expect(localDevPattern.test('http://127.0.0.1:5174')).toBe(true);
        expect(localDevPattern.test('http://127.0.0.1:5175')).toBe(true);
    });

    it('allows Firebase Hosting preview channel origins for pull requests', () => {
        expect(previewPattern.test('https://game-flow-c6311--pr-3864.web.app')).toBe(true);
        expect(previewPattern.test('https://game-flow-c6311--staff-rsvp-cors.web.app')).toBe(true);
    });

    it('rejects arbitrary third-party origins', () => {
        expect(localDevPattern.test('https://localhost:5174')).toBe(false);
        expect(localDevPattern.test('http://evil.example:5174')).toBe(false);
        expect(previewPattern.test('https://game-flow-c6311--pr-3864.firebaseapp.com')).toBe(false);
        expect(previewPattern.test('https://game-flow-c6311--pr-3864.example.com')).toBe(false);
        expect(origins).not.toContain('https://evil.example');
    });

    it('uses the public RSVP origin helper from the CORS writer', () => {
        expect(source).toContain('function isAllowedPublicRsvpOrigin(origin) {');
        expect(source).toContain('isAllowedPublicRsvpOrigin');
        expect(source).toContain('if (isAllowedPublicRsvpOrigin(origin)) {');
    });

    it('no longer allows the retired GitHub Pages origin', () => {
        expect(origins).not.toContain('https://pauljsnider.github.io');
        expect(source).not.toContain('pauljsnider.github.io');
    });
});
