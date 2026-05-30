import { describe, it, expect } from 'vitest';
import { resolveZip } from './utils';

describe('resolveZip', () => {
  it('should return full city and state for recognized cities', () => {
    expect(resolveZip('atlanta')).toBe('Atlanta, GA');
    expect(resolveZip('New York')).toBe('New York, NY');
    expect(resolveZip('LA')).toBe('Los Angeles, CA');
    expect(resolveZip('chicago')).toBe('Chicago, IL');
  });

  it('should return full city and state for recognized zip codes', () => {
    expect(resolveZip('30303')).toBe('Atlanta, GA');
    expect(resolveZip('10001')).toBe('New York, NY');
    expect(resolveZip('90012')).toBe('Los Angeles, CA');
    expect(resolveZip('60601')).toBe('Chicago, IL');
  });

  it('should return capitalized input for unrecognized city names', () => {
    expect(resolveZip('dallas')).toBe('Dallas');
    expect(resolveZip('san francisco')).toBe('San Francisco');
  });

  it('should return \'ZIP: \' for unrecognized 5-digit zip codes', () => {
    expect(resolveZip('90210')).toBe('ZIP: 90210');
    expect(resolveZip('12345')).toBe('ZIP: 12345');
  });

  it('should handle mixed case input gracefully', () => {
    expect(resolveZip('Atlanta')).toBe('Atlanta, GA');
    expect(resolveZip('new york')).toBe('New York, NY');
    expect(resolveZip('la')).toBe('Los Angeles, CA');
  });

  it('should return empty string for null, undefined or empty input', () => {
    expect(resolveZip(null as any)).toBe(''); // Type assertion for null
    expect(resolveZip(undefined as any)).toBe(''); // Type assertion for undefined
    expect(resolveZip('')).toBe('');
    expect(resolveZip('   ')).toBe('');
  });
});