const assert = require('node:assert/strict');
const test = require('node:test');

const { createInMemoryRateLimiter, getRequestIp } = require('../rate-limit.cjs');

test('uses the public address immediately before the trusted proxy hop', () => {
    const request = {
        ip: '10.0.0.5',
        headers: {
            // The first value could be supplied by the caller. The proxy-appended
            // client and proxy values are the trusted suffix of this chain.
            'x-forwarded-for': '198.51.100.99, 203.0.113.10, 10.0.0.5'
        },
        socket: { remoteAddress: '10.0.0.5' }
    };

    assert.equal(getRequestIp(request), '203.0.113.10');
});

test('ignores forwarded values when the chain has no trusted proxy hop', () => {
    const request = {
        ip: '10.0.0.5',
        headers: {
            'x-forwarded-for': '198.51.100.99'
        },
        socket: { remoteAddress: '10.0.0.5' }
    };

    assert.equal(getRequestIp(request), '10.0.0.5');
});

test('does not skip a private intermediate hop to reach an untrusted prefix', () => {
    const request = {
        ip: '10.0.0.5',
        headers: {
            'x-forwarded-for': '198.51.100.99, 10.0.0.6, 10.0.0.5'
        },
        socket: { remoteAddress: '10.0.0.5' }
    };

    assert.equal(getRequestIp(request), '10.0.0.5');
});

test('rejects a trusted proxy value that is not the terminal forwarded hop', () => {
    const request = {
        ip: '10.0.0.5',
        headers: {
            'x-forwarded-for': '198.51.100.99, 10.0.0.5, 203.0.113.10'
        },
        socket: { remoteAddress: '10.0.0.5' }
    };

    assert.equal(getRequestIp(request), '10.0.0.5');
});

test('allows requests through the threshold, rejects excess, and resets after the window', () => {
    const checkRateLimit = createInMemoryRateLimiter({
        windowMs: 1_000,
        maxRequests: 2,
        maxKeys: 2
    });
    const request = { ip: '203.0.113.10' };

    assert.equal(checkRateLimit(request, 1_000).allowed, true);
    assert.equal(checkRateLimit(request, 1_100).allowed, true);
    const rejected = checkRateLimit(request, 1_200);
    assert.equal(rejected.allowed, false);
    assert.equal(rejected.retryAfterSeconds, 1);
    assert.equal(checkRateLimit(request, 2_000).allowed, true);
});
