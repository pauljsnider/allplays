import { test } from 'vitest';
import assert from 'node:assert';
import { promises as dns } from 'node:dns';
import * as https from 'node:https';
import * as http from 'node:http';
import * as net from 'node:net';
import { EventEmitter } from 'node:events';
import * as securityUtils from '../utils/security-utils.js';
const { fetchWithTimeout, normalizeTargetUrl, assertPublicHost, isPrivateIpAddress, _setClientModulesForTesting } = securityUtils;

function createMockRequest() {
  const mockRequest = new EventEmitter();
  mockRequest.end = () => {};
  return mockRequest;
}

test('isPrivateIpAddress correctly identifies private IPs', () => {
  assert.strictEqual(isPrivateIpAddress('10.0.0.1'), true, '10.0.0.1 should be private');
  assert.strictEqual(isPrivateIpAddress('172.16.0.1'), true, '172.16.0.1 should be private');
  assert.strictEqual(isPrivateIpAddress('172.31.255.255'), true, '172.31.255.255 should be private');
  assert.strictEqual(isPrivateIpAddress('192.168.1.1'), true, '192.168.1.1 should be private');
  assert.strictEqual(isPrivateIpAddress('127.0.0.1'), true, '127.0.0.1 should be private');
  assert.strictEqual(isPrivateIpAddress('0.0.0.0'), true, '0.0.0.0 should be private');
  assert.strictEqual(isPrivateIpAddress('169.254.1.1'), true, '169.254.1.1 should be private');
  assert.strictEqual(isPrivateIpAddress('8.8.8.8'), false, '8.8.8.8 should be public');
  assert.strictEqual(isPrivateIpAddress('203.0.113.1'), false, '203.0.113.1 should be public');

  assert.strictEqual(isPrivateIpAddress('::1'), true, '::1 should be private (IPv6 loopback)');
  assert.strictEqual(isPrivateIpAddress('fe80::1'), true, 'fe80::1 should be private (IPv6 link-local)');
  assert.strictEqual(isPrivateIpAddress('fc00::1'), true, 'fc00::1 should be private (IPv6 ULA)');
  assert.strictEqual(isPrivateIpAddress('fd00::1'), true, 'fd00::1 should be private (IPv6 ULA)');
  assert.strictEqual(isPrivateIpAddress('fec0::1'), true, 'fec0::1 should be private (IPv6 site-local)');
  assert.strictEqual(isPrivateIpAddress('feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'), true, 'feff::/16 upper bound should be private (IPv6 site-local)');
  assert.strictEqual(isPrivateIpAddress('2001:0db8::1'), false, '2001:0db8::1 should be public');

  assert.strictEqual(isPrivateIpAddress('::ffff:127.0.0.1'), true, 'IPv4-mapped IPv6 loopback should be private');
  assert.strictEqual(isPrivateIpAddress('::ffff:10.0.0.1'), true, 'IPv4-mapped IPv6 RFC1918 should be private');
  assert.strictEqual(isPrivateIpAddress('::ffff:192.168.1.1'), true, 'IPv4-mapped IPv6 RFC1918 should be private');
  assert.strictEqual(isPrivateIpAddress('::ffff:169.254.169.254'), true, 'IPv4-mapped IPv6 link-local should be private');
  assert.strictEqual(isPrivateIpAddress('0000:0000:0000:0000:0000:ffff:7f00:0001'), true, 'zero-padded IPv4-mapped IPv6 loopback should be private');
  assert.strictEqual(isPrivateIpAddress('0000:0000:0000:0000:0000:ffff:0a00:0001'), true, 'zero-padded IPv4-mapped IPv6 RFC1918 should be private');
  assert.strictEqual(isPrivateIpAddress('::ffff:8.8.8.8'), false, 'IPv4-mapped IPv6 public address should be public');
  assert.strictEqual(isPrivateIpAddress('0000:0000:0000:0000:0000:ffff:0808:0808'), false, 'zero-padded IPv4-mapped IPv6 public address should be public');
});

test('assertPublicHost prevents blocked hosts and private IPs', async () => {
  await assert.rejects(assertPublicHost('localhost'), { message: 'Blocked host' }, 'localhost should be blocked');
  await assert.rejects(assertPublicHost('127.0.0.1'), { message: 'Blocked host' }, '127.0.0.1 should be blocked');
  await assert.rejects(assertPublicHost('192.168.1.1'), { message: 'Blocked host address' }, 'private IP should be blocked');
  await assert.rejects(assertPublicHost('evil.local'), { message: 'Blocked host' }, '.local should be blocked');

  await assert.rejects(assertPublicHost('::ffff:127.0.0.1'), { message: 'Blocked host address' }, 'IPv4-mapped IPv6 loopback should be blocked');
  await assert.rejects(assertPublicHost('::ffff:169.254.169.254'), { message: 'Blocked host address' }, 'IPv4-mapped IPv6 link-local should be blocked');
  await assert.rejects(assertPublicHost('0000:0000:0000:0000:0000:ffff:7f00:0001'), { message: 'Blocked host address' }, 'zero-padded IPv4-mapped IPv6 loopback should be blocked');
  await assert.rejects(assertPublicHost('fec0::1234'), { message: 'Blocked host address' }, 'IPv6 site-local should be blocked');

  const publicIp = await assertPublicHost('8.8.8.8');
  assert.deepStrictEqual(publicIp, ['8.8.8.8'], 'public IP should be allowed');
});

test('fetchWithTimeout uses validated IPs and falls back across failures', async () => {
  const originalDnsLookup = dns.lookup;
  const originalSetClientModules = _setClientModulesForTesting;

  try {
    const publicIp = '203.0.113.1';
    const fallbackPublicIp = '198.51.100.2';
    const privateIp = '192.168.1.1';
    const maliciousHost = 'attacker.com';
    const maliciousUrl = `https://${maliciousHost}/evil_feed.ics`;

    const requestOptionsUsed = [];

    // Mock http and https modules to capture request options
    const mockHttp = {
      request: (options, callback) => {
        requestOptionsUsed.push(options);
        assert.ok([publicIp, fallbackPublicIp].includes(options.host), 'HTTP request should connect only to validated public IPs');
        assert.strictEqual(options.headers['Host'], maliciousHost, 'HTTP request should use original hostname in Host header');
        const mockResponse = new http.IncomingMessage(new net.Socket());
        mockResponse.statusCode = 200;
        mockResponse.statusMessage = 'OK';
        mockResponse.headers = { 'content-type': 'text/calendar' };
        const mockRequest = createMockRequest();
        setImmediate(() => {
          callback(mockResponse);
          mockResponse.emit('data', 'BEGIN:VCALENDAR\nSUMMARY:Test Event\nEND:VCALENDAR');
          mockResponse.emit('end');
        });
        return mockRequest;
      },
    };
    const mockHttps = {
      request: (options, callback) => {
        requestOptionsUsed.push(options);
        assert.ok([publicIp, fallbackPublicIp].includes(options.host), 'HTTPS request should connect only to validated public IPs');
        assert.strictEqual(options.servername, maliciousHost, 'HTTPS request should use original hostname for SNI');
        assert.strictEqual(options.headers['Host'], maliciousHost, 'HTTPS request should use original hostname in Host header');
        const mockRequest = createMockRequest();

        if (options.host === publicIp) {
          setImmediate(() => {
            mockRequest.emit('error', new Error('connect ECONNREFUSED'));
          });
          return mockRequest;
        }

        const mockResponse = new http.IncomingMessage(new net.Socket());
        mockResponse.statusCode = 200;
        mockResponse.statusMessage = 'OK';
        mockResponse.headers = { 'content-type': 'text/calendar' };
        setImmediate(() => {
          callback(mockResponse);
          mockResponse.emit('data', 'BEGIN:VCALENDAR\nSUMMARY:Test Event\nEND:VCALENDAR');
          mockResponse.emit('end');
        });
        return mockRequest;
      },
    };

    _setClientModulesForTesting(mockHttp, mockHttps);

    // Mock dns.lookup to initially return a public IP
    dns.lookup = async (hostname, options) => {
      if (hostname === maliciousHost) {
        return [
          { address: publicIp, family: 4 },
          { address: fallbackPublicIp, family: 4 },
        ];
      }
      return originalDnsLookup(hostname, options);
    };

    // First, call normalizeTargetUrl to perform initial validation
    const { url: normalizedUrl, hostname, publicIps } = await normalizeTargetUrl(maliciousUrl);

    // Verify initial validation passed and public IP was resolved
    assert.deepStrictEqual(publicIps, [publicIp, fallbackPublicIp], 'normalizeTargetUrl should return all validated public IPs after initial DNS lookup');
    assert.strictEqual(hostname, maliciousHost, 'hostname should be preserved');


    // Now, simulate the DNS rebinding BEFORE fetchWithTimeout is called
    // (This part is crucial for testing the TOCTOU vulnerability)
    dns.lookup = async (hostname, options) => {
      if (hostname === maliciousHost) {
        return [{ address: privateIp, family: 4 }]; // Now resolves to private IP
      }
      return originalDnsLookup(hostname, options);
    };

    const response = await fetchWithTimeout(normalizedUrl, hostname, publicIps);

    // Assert that https.request was indeed called with the public IP
    assert.strictEqual(requestOptionsUsed.length, 2, 'https.request should retry the next validated IP after a connection failure');
    assert.deepStrictEqual(requestOptionsUsed.map((options) => options.host), [publicIp, fallbackPublicIp], 'https.request should try validated IPs in resolution order');
    assert.ok(response.ok, 'fetchWithTimeout should return ok response');
    const icsText = await response.text();
    assert.ok(icsText.includes('BEGIN:VCALENDAR'), 'ICS text should be present');

    // Test redirect handling: fetchWithTimeout should reject redirects
    // Re-configure mocks for redirect test
    requestOptionsUsed.length = 0;
    mockHttps.request = (options, callback) => {
      requestOptionsUsed.push(options);
      assert.strictEqual(options.host, publicIp, 'HTTPS request for redirect should connect to pre-validated IP');

      const mockResponse = new http.IncomingMessage(new net.Socket());
      mockResponse.statusCode = 302;
      mockResponse.statusMessage = 'Found';
      mockResponse.headers = { 'location': 'https://new.example.com/redirected.ics' };

      const mockRequest = createMockRequest();
      setImmediate(() => {
        callback(mockResponse);
        mockResponse.emit('end');
      });
      return mockRequest;
    };
    _setClientModulesForTesting(mockHttp, mockHttps); // Re-apply mocks with redirect behavior

    const redirectResponse = await fetchWithTimeout(normalizedUrl, hostname, publicIps);
    assert.strictEqual(redirectResponse.ok, false, 'Redirect response should not be ok');
    assert.strictEqual(redirectResponse.status, 302, 'Redirect response status should be 302');
    const redirectText = await redirectResponse.text();
    assert.ok(redirectText.includes('Redirect to https://new.example.com/redirected.ics'), 'Redirect text should contain new location');

  } finally {
    dns.lookup = originalDnsLookup;
    _setClientModulesForTesting(null, null); // Restore original modules
  }
});
