const assert = require('node:assert/strict');
const test = require('node:test');

const {
    createFirestoreFixedWindowRateLimiter,
    createInMemoryRateLimiter,
    getRequestIp
} = require('../rate-limit.cjs');

function makeAtomicFirestore() {
    const state = new Map();
    let transactionQueue = Promise.resolve();

    function collection(name) {
        return {
            doc(id) {
                return { id, path: `${name}/${id}` };
            }
        };
    }

    function runTransaction(handler) {
        const execute = async () => handler({
            async get(ref) {
                const value = state.get(ref.path);
                return {
                    exists: value !== undefined,
                    data: () => value === undefined ? undefined : { ...value }
                };
            },
            set(ref, value) {
                state.set(ref.path, { ...value });
            }
        });
        const result = transactionQueue.then(execute, execute);
        transactionQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    return { collection, runTransaction, state };
}

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

test('shares an atomic fixed-window count across durable limiter instances', async () => {
    const firestore = makeAtomicFirestore();
    const options = {
        firestore,
        collectionName: 'publicRegistrationRateLimits',
        windowMs: 10_000,
        maxRequests: 3
    };
    const limiterA = createFirestoreFixedWindowRateLimiter(options);
    const limiterB = createFirestoreFixedWindowRateLimiter(options);

    const results = await Promise.all([
        limiterA('form-1|parent@example.com|203.0.113.10', 1_000),
        limiterB('form-1|parent@example.com|203.0.113.10', 1_000),
        limiterA('form-1|parent@example.com|203.0.113.10', 1_000),
        limiterB('form-1|parent@example.com|203.0.113.10', 1_000)
    ]);

    assert.equal(results.filter((result) => result.allowed).length, 3);
    assert.equal(results.filter((result) => !result.allowed).length, 1);
});

test('resets expired windows and isolates different boundaries', async () => {
    const firestore = makeAtomicFirestore();
    const limiter = createFirestoreFixedWindowRateLimiter({
        firestore,
        collectionName: 'publicRegistrationRateLimits',
        windowMs: 10_000,
        maxRequests: 1
    });

    assert.equal((await limiter('boundary-a', 1_000)).allowed, true);
    const rejected = await limiter('boundary-a', 2_500);
    assert.equal(rejected.allowed, false);
    assert.equal(rejected.retryAfterSeconds, 9);
    assert.equal((await limiter('boundary-b', 2_500)).allowed, true);
    assert.equal((await limiter('boundary-a', 11_000)).allowed, true);
});

test('uses hashed document identifiers without persisting boundary values', async () => {
    const firestore = makeAtomicFirestore();
    const limiter = createFirestoreFixedWindowRateLimiter({
        firestore,
        collectionName: 'publicRegistrationRateLimits',
        maxRequests: 3
    });
    const boundary = 'team-1|form-1|parent@example.com|203.0.113.10';

    await limiter(boundary, 1_000);

    const [[path, data]] = [...firestore.state.entries()];
    assert.match(path, /^publicRegistrationRateLimits\/[a-f0-9]{64}$/);
    assert.doesNotMatch(path, /parent@example\.com|203\.0\.113\.10/);
    assert.doesNotMatch(JSON.stringify(data), /parent@example\.com|203\.0\.113\.10/);
});
