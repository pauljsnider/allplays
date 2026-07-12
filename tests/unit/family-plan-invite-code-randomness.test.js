import { describe, expect, it, vi } from 'vitest';
import { generateJoinCode, JOIN_CODE_CHARS } from '../../js/join-code.js';

// Security regression guard (CWE-338): household invite codes become access
// codes for family-plan linking, so they must be generated with a
// cryptographically secure RNG. Math.random() is predictable from observed
// outputs and must never be used for these codes.

describe('household invite code randomness', () => {
    it('uses a cryptographically secure RNG', () => {
        const getRandomValues = vi.fn((values) => values.fill(0));
        generateJoinCode({ getRandomValues });
        expect(getRandomValues).toHaveBeenCalled();
    });

    it('does not use Math.random for the invite code', () => {
        expect(String(generateJoinCode)).not.toContain('Math.random');
    });

    it('uses a 32-char alphabet so byte % length is unbiased', () => {
        const alphabet = JOIN_CODE_CHARS;
        expect(alphabet.length).toBe(32);
        // 256 divides evenly by the alphabet length -> no modulo bias.
        expect(256 % alphabet.length).toBe(0);
        // No ambiguous characters (I/O/0/1) in the alphabet.
        expect(/[IO01]/.test(alphabet)).toBe(false);
    });
});
