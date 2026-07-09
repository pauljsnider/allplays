import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'functions/index.js'), 'utf8');

function extractAllowedOrigins(functionsSource) {
    const start = functionsSource.indexOf('function writePublicRsvpCors(');
    expect(start, 'Expected writePublicRsvpCors to exist in functions/index.js').toBeGreaterThanOrEqual(0);

    const setStart = functionsSource.indexOf('new Set([', start);
    expect(setStart, 'Expected an allowedOrigins Set literal in writePublicRsvpCors').toBeGreaterThan(start);
    const setEnd = functionsSource.indexOf('])', setStart);
    expect(setEnd, 'Expected closing ]) for the allowedOrigins Set literal').toBeGreaterThan(setStart);

    const literal = functionsSource.slice(setStart + 'new Set(['.length, setEnd);
    return literal
        .split(',')
        .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
}

describe('public RSVP CORS origins', () => {
    const origins = extractAllowedOrigins(source);

    it('allows the production domains and Firebase Hosting default domains', () => {
        expect(origins).toContain('https://allplays.ai');
        expect(origins).toContain('https://www.allplays.ai');
        expect(origins).toContain('https://game-flow-c6311.web.app');
        expect(origins).toContain('https://game-flow-c6311.firebaseapp.com');
    });

    it('no longer allows the retired GitHub Pages origin', () => {
        expect(origins).not.toContain('https://pauljsnider.github.io');
        expect(source).not.toContain('pauljsnider.github.io');
    });
});
