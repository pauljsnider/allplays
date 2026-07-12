import { describe, expect, it, vi } from 'vitest';
import { generateJoinCode } from '../../js/join-code.js';

// The family-plan generator delegates to this shared helper. These behavioral
// tests keep the code format and cryptographic source consistent for every flow.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function runWith(getRandomValues) {
    return generateJoinCode({ getRandomValues });
}

describe('generateHouseholdInviteCode behavior', () => {
    it('requests 8 cryptographically secure bytes', () => {
        const spy = vi.fn((arr) => arr.fill(0));
        runWith(spy);
        expect(spy).toHaveBeenCalledTimes(1);
        const arg = spy.mock.calls[0][0];
        expect(arg).toBeInstanceOf(Uint8Array);
        expect(arg.length).toBe(8);
    });

    it('maps each byte to alphabet[byte % 32]', () => {
        // Known bytes -> deterministic, verifiable output (no modulo bias at 32).
        const bytes = [0, 1, 31, 32, 33, 255, 64, 100];
        const code = runWith((arr) => { bytes.forEach((b, i) => { arr[i] = b; }); });
        const expected = bytes.map((b) => ALPHABET[b % ALPHABET.length]).join('');
        expect(code).toBe(expected);
    });

    it('produces an 8-char code using only the safe alphabet', () => {
        const code = runWith((arr) => { for (let i = 0; i < arr.length; i += 1) arr[i] = i * 17; });
        expect(code).toHaveLength(8);
        expect([...code].every((ch) => ALPHABET.includes(ch))).toBe(true);
        // No visually ambiguous characters.
        expect(/[IO01]/.test(code)).toBe(false);
    });

    it('uses the real Web Crypto RNG when available (high uniqueness)', () => {
        const codes = new Set();
        for (let i = 0; i < 200; i += 1) {
            codes.add(generateJoinCode());
        }
        // Collisions would indicate a broken/weak RNG; expect near-perfect uniqueness.
        expect(codes.size).toBeGreaterThan(195);
    });
});
