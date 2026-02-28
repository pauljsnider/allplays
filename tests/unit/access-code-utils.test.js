import { describe, it, expect } from 'vitest';
import { isAccessCodeExpired } from '../../js/access-code-utils.js';

describe('access code expiration helper', () => {
    it('returns true when expiresAt is in the past (Timestamp-like)', () => {
        const nowMs = Date.UTC(2026, 1, 28, 20, 20, 0);
        const expired = { toMillis: () => nowMs - 1000 };
        expect(isAccessCodeExpired(expired, nowMs)).toBe(true);
    });

    it('returns false when expiresAt is in the future (Timestamp-like)', () => {
        const nowMs = Date.UTC(2026, 1, 28, 20, 20, 0);
        const active = { toMillis: () => nowMs + 1000 };
        expect(isAccessCodeExpired(active, nowMs)).toBe(false);
    });

    it('returns false when expiresAt is missing', () => {
        expect(isAccessCodeExpired(null, Date.UTC(2026, 1, 28, 20, 20, 0))).toBe(false);
    });
});
