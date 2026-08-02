import { describe, expect, it } from 'vitest';
import { createSecureUploadToken, requireSecureUploadToken } from '../../js/secure-upload-token.js';

describe('secure upload tokens', () => {
    it('uses randomUUID when available', () => {
        expect(createSecureUploadToken({
            randomUUID: () => '12345678-1234-1234-1234-123456789abc'
        })).toBe('12345678123412341234123456789abc');
    });

    it('uses getRandomValues when randomUUID is unavailable', () => {
        expect(createSecureUploadToken({
            getRandomValues: (bytes) => {
                bytes.fill(0xab);
                return bytes;
            }
        })).toBe('ab'.repeat(16));
    });

    it('fails closed when secure randomness is unavailable', () => {
        expect(() => createSecureUploadToken({})).toThrow('Secure random values are required for uploads.');
        expect(() => requireSecureUploadToken('')).toThrow('secure upload attempt identifier');
    });
});
