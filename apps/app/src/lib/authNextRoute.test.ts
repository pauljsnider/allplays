import { describe, expect, it } from 'vitest';
import { getSafeAuthNextRoute } from './authNextRoute';

describe('getSafeAuthNextRoute', () => {
  it('allows local opportunity routes with queries', () => {
    expect(getSafeAuthNextRoute('/discover/opportunities/listing-1?contact=1')).toBe('/discover/opportunities/listing-1?contact=1');
  });

  it('rejects external, protocol-relative, backslash, and oversized routes', () => {
    expect(getSafeAuthNextRoute('https://evil.example')).toBe('');
    expect(getSafeAuthNextRoute('//evil.example/path')).toBe('');
    expect(getSafeAuthNextRoute('/\\evil')).toBe('');
    expect(getSafeAuthNextRoute(`/${'a'.repeat(600)}`)).toBe('');
  });
});
