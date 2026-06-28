import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Security regression guard (CWE-338): household invite codes become access
// codes for family-plan linking, so they must be generated with a
// cryptographically secure RNG. Math.random() is predictable from observed
// outputs and must never be used for these codes.

function readFamilyPlanSource() {
    return readFileSync(new URL('../../js/family-plan.js', import.meta.url), 'utf8');
}

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    expect(start, `${name} should exist`).toBeGreaterThan(-1);
    // Capture up to the next top-level function declaration.
    const rest = source.slice(start + 1);
    const next = rest.indexOf('\nfunction ');
    return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

describe('household invite code randomness', () => {
    const body = extractFunction(readFamilyPlanSource(), 'generateHouseholdInviteCode');

    it('uses a cryptographically secure RNG', () => {
        expect(body).toContain('getRandomValues');
    });

    it('does not use Math.random for the invite code', () => {
        expect(body).not.toContain('Math.random');
    });

    it('uses a 32-char alphabet so byte % length is unbiased', () => {
        const match = body.match(/const chars = '([^']+)'/);
        expect(match, 'alphabet literal should be present').toBeTruthy();
        const alphabet = match[1];
        expect(alphabet.length).toBe(32);
        // 256 divides evenly by the alphabet length -> no modulo bias.
        expect(256 % alphabet.length).toBe(0);
        // No ambiguous characters (I/O/0/1) in the alphabet.
        expect(/[IO01]/.test(alphabet)).toBe(false);
    });
});
