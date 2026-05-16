import { describe, it, expect } from 'vitest';
import { isPrivateIpAddress } from '../../functions/utils/ip-address-validation.js';

describe('isPrivateIpAddress', () => {
  // Public IPv4 addresses
  it('should return false for public IPv4 addresses', () => {
    expect(isPrivateIpAddress('1.1.1.1')).toBe(false);
    expect(isPrivateIpAddress('8.8.8.8')).toBe(false);
    expect(isPrivateIpAddress('203.0.113.42')).toBe(false);
  });

  // Private IPv4 addresses
  it('should return true for private IPv4 addresses (10.0.0.0/8)', () => {
    expect(isPrivateIpAddress('10.0.0.1')).toBe(true);
    expect(isPrivateIpAddress('10.255.255.254')).toBe(true);
  });

  it('should return true for private IPv4 addresses (172.16.0.0/12)', () => {
    expect(isPrivateIpAddress('172.16.0.1')).toBe(true);
    expect(isPrivateIpAddress('172.31.255.254')).toBe(true);
  });

  it('should return true for private IPv4 addresses (192.168.0.0/16)', () => {
    expect(isPrivateIpAddress('192.168.1.1')).toBe(true);
    expect(isPrivateIpAddress('192.168.255.254')).toBe(true);
  });

  it('should return true for IPv4 loopback (127.0.0.1)', () => {
    expect(isPrivateIpAddress('127.0.0.1')).toBe(true);
  });

  it('should return true for IPv4 unspecified (0.0.0.0)', () => {
    expect(isPrivateIpAddress('0.0.0.0')).toBe(true);
  });

  it('should return true for IPv4 link-local (169.254.0.0/16)', () => {
    expect(isPrivateIpAddress('169.254.1.1')).toBe(true);
  });

  // Public IPv6 addresses
  it('should return false for public IPv6 addresses', () => {
    expect(isPrivateIpAddress('2001:0db8::1')).toBe(false);
    expect(isPrivateIpAddress('2606:4700::6810:8000')).toBe(false);
  });

  // Private IPv6 addresses
  it('should return true for IPv6 loopback (::1)', () => {
    expect(isPrivateIpAddress('::1')).toBe(true);
  });

  it('should return true for IPv6 unspecified (::)', () => {
    expect(isPrivateIpAddress('::')).toBe(true);
  });

  it('should return true for IPv6 link-local (fe80::/10)', () => {
    expect(isPrivateIpAddress('fe80::abcd')).toBe(true);
    expect(isPrivateIpAddress('fe80:0000:0000:0000:0202:b3ff:fe1e:8329')).toBe(true);
  });

  it('should return true for IPv6 unique local addresses (fc00::/7)', () => {
    expect(isPrivateIpAddress('fc00::1')).toBe(true);
    expect(isPrivateIpAddress('fd00::1')).toBe(true);
  });

  // NEW: IPv6 site-local (fec0::/10)
  it('should return true for IPv6 site-local addresses (fec0::/10)', () => {
    expect(isPrivateIpAddress('fec0::1')).toBe(true);
    expect(isPrivateIpAddress('fec0:0:0:1::1')).toBe(true);
    expect(isPrivateIpAddress('fec1::1')).toBe(true);
    expect(isPrivateIpAddress('fecf::1')).toBe(true);
    expect(isPrivateIpAddress('feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(true);
  });

  // Invalid IP addresses
  it('should return true for invalid IP addresses', () => {
    expect(isPrivateIpAddress('invalid-ip')).toBe(true);
    expect(isPrivateIpAddress('192.168.1')).toBe(true);
    expect(isPrivateIpAddress('2001:db8:::1')).toBe(true);
    expect(isPrivateIpAddress('')).toBe(true);
    expect(isPrivateIpAddress(null)).toBe(true);
    expect(isPrivateIpAddress(undefined)).toBe(true);
  });
});
