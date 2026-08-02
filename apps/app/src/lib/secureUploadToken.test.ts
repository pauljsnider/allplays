import { describe, expect, it } from 'vitest';
import { createSecureUploadToken } from './secureUploadToken';

describe('createSecureUploadToken', () => {
  it('uses randomUUID when available', () => {
    const cryptoSource = {
      randomUUID: () => '12345678-1234-1234-1234-123456789abc'
    } as unknown as Crypto;

    expect(createSecureUploadToken(cryptoSource)).toBe('12345678123412341234123456789abc');
  });

  it('uses getRandomValues when randomUUID is unavailable', () => {
    const cryptoSource = {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xab);
        return bytes;
      }
    } as unknown as Crypto;

    expect(createSecureUploadToken(cryptoSource)).toBe('ab'.repeat(16));
  });

  it('fails closed when secure randomness is unavailable', () => {
    expect(() => createSecureUploadToken({} as Crypto)).toThrow('Secure random values are required for uploads.');
  });
});
