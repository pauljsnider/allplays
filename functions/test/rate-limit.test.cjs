const assert = require('node:assert/strict');
const test = require('node:test');

const { getRequestIp } = require('../rate-limit.cjs');

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
