import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// Node env (default): import.meta.url is a file URL for readFileSync, and
// Node 20 exposes globalThis.crypto (Web Crypto) for the real-RNG test.

// Behavioral tests for generateHouseholdInviteCode (not exported, so extracted
// and executed with an injected `globalThis` so we control the RNG). Verifies it
// consumes the crypto RNG correctly and never falls back to a weak source.

function extractGenerator() {
    const source = readFileSync(new URL('../../js/family-plan.js', import.meta.url), 'utf8');
    const match = source.match(/function generateHouseholdInviteCode\(\) \{[\s\S]*?\n\}/);
    expect(match, 'generateHouseholdInviteCode should exist').toBeTruthy();
    return match[0];
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Run the extracted function with a controllable globalThis.crypto.
function runWith(getRandomValues) {
    const fnSource = extractGenerator();
    const factory = new Function('globalThis', `${fnSource}\nreturn generateHouseholdInviteCode();`);
    return factory({ crypto: { getRandomValues } });
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
        const fnSource = extractGenerator();
        const factory = new Function('globalThis', `${fnSource}\nreturn generateHouseholdInviteCode();`);
        const codes = new Set();
        for (let i = 0; i < 200; i += 1) {
            codes.add(factory(globalThis)); // real globalThis.crypto in jsdom
        }
        // Collisions would indicate a broken/weak RNG; expect near-perfect uniqueness.
        expect(codes.size).toBeGreaterThan(195);
    });
});
