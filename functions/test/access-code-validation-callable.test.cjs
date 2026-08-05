const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAccessCodeValidationRateLimitBoundaries,
  createAccessCodeValidationHandler
} = require('../access-code-validation.cjs');

class TestHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function makeFirestore(seed = {}) {
  const state = new Map(Object.entries(seed));
  const accessCodeQueries = [];
  let transactionQueue = Promise.resolve();

  function documentSnapshot(ref) {
    const value = state.get(ref.path);
    return {
      id: ref.id,
      exists: value !== undefined,
      data: () => value === undefined ? undefined : { ...value }
    };
  }

  function collection(name) {
    return {
      doc(id) {
        return { id, path: `${name}/${id}` };
      },
      where(field, operator, value) {
        assert.equal(name, 'accessCodes');
        assert.equal(field, 'code');
        assert.equal(operator, '==');
        return {
          async get() {
            accessCodeQueries.push(value);
            const docs = [...state.entries()]
              .filter(([path, data]) => path.startsWith('accessCodes/') && data.code === value)
              .map(([path]) => {
                const id = path.split('/').pop();
                return documentSnapshot({ id, path });
              });
            return { docs };
          }
        };
      }
    };
  }

  function runTransaction(handler) {
    const execute = async () => {
      const writes = [];
      const result = await handler({
        get: async (ref) => documentSnapshot(ref),
        set: (ref, value) => writes.push([ref.path, { ...value }])
      });
      writes.forEach(([path, value]) => state.set(path, value));
      return result;
    };
    const result = transactionQueue.then(execute, execute);
    transactionQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  return { accessCodeQueries, collection, runTransaction, state };
}

function makeHarness({ uidMaxRequests = 10, networkMaxRequests = 10, windowMs = 10_000 } = {}) {
  const firestore = makeFirestore({
    'accessCodes/ADMIN123': {
      code: 'ADMIN123',
      type: 'admin_invite',
      used: false
    },
    'accessCodes/PARENT12': {
      code: 'PARENT12',
      type: 'parent_invite',
      used: false
    }
  });
  let nowMs = 1_000;
  const verifiedTokens = [];
  const auth = {
    async verifyIdToken(token) {
      verifiedTokens.push(token);
      return token === 'native-token' ? { uid: 'native-user' } : null;
    }
  };
  const handler = createAccessCodeValidationHandler({
    firestore,
    auth,
    HttpsError: TestHttpsError,
    now: () => nowMs,
    rateLimitWindowMs: windowMs,
    uidMaxRequests,
    networkMaxRequests
  });
  return {
    firestore,
    handler,
    verifiedTokens,
    setNow(value) {
      nowMs = value;
    }
  };
}

function context(uid, ip) {
  return {
    auth: uid ? { uid } : undefined,
    rawRequest: { ip, headers: {} }
  };
}

test('constructs separate deterministic UID and network boundaries', () => {
  const first = buildAccessCodeValidationRateLimitBoundaries({
    uid: 'user-1',
    requestIp: '203.0.113.10'
  });
  const repeated = buildAccessCodeValidationRateLimitBoundaries({
    uid: 'user-1',
    requestIp: '203.0.113.10'
  });

  assert.deepEqual(first, repeated);
  assert.notEqual(first.uid, first.network);
  assert.match(first.uid, /\nuid\nuser-1$/);
  assert.match(first.network, /\nnetwork\n203\.0\.113\.10$/);
});

test('reserves hashed persistent boundaries before one authenticated invite lookup', async () => {
  const harness = makeHarness();
  const result = await harness.handler(
    { code: 'admin123' },
    context('user-1', '203.0.113.10')
  );

  assert.equal(result.valid, true);
  assert.equal(result.type, 'admin_invite');
  assert.deepEqual(harness.firestore.accessCodeQueries, ['ADMIN123']);
  const persistedLimits = [...harness.firestore.state.entries()]
    .filter(([path]) => path.startsWith('accessCodeValidationRateLimits/'));
  assert.equal(persistedLimits.length, 2);
  for (const [path, value] of persistedLimits) {
    assert.match(path, /^accessCodeValidationRateLimits\/[a-f0-9]{64}$/);
    assert.doesNotMatch(path, /user-1|203\.0\.113\.10/);
    assert.doesNotMatch(JSON.stringify(value), /user-1|203\.0\.113\.10/);
    assert.equal(value.count, 1);
  }
});

test('reserves both boundaries for a native token caller before querying', async () => {
  const harness = makeHarness();
  const result = await harness.handler(
    { code: 'parent12', nativeAuthToken: 'native-token' },
    context('', '198.51.100.24')
  );

  assert.equal(result.valid, true);
  assert.equal(result.type, 'parent_invite');
  assert.deepEqual(harness.verifiedTokens, ['native-token']);
  assert.deepEqual(harness.firestore.accessCodeQueries, ['PARENT12']);
  assert.equal(
    [...harness.firestore.state.keys()]
      .filter((path) => path.startsWith('accessCodeValidationRateLimits/')).length,
    2
  );
});

test('denies an unauthenticated caller before rate-limit or access-code reads', async () => {
  const harness = makeHarness();
  const result = await harness.handler(
    { code: 'ADMIN123' },
    context('', '203.0.113.44')
  );

  assert.deepEqual(result, { valid: false, message: 'Invalid or expired access code' });
  assert.deepEqual(harness.firestore.accessCodeQueries, []);
  assert.equal(
    [...harness.firestore.state.keys()]
      .filter((path) => path.startsWith('accessCodeValidationRateLimits/')).length,
    0
  );
});

test('fails closed before the invite lookup when the persistent limiter is unavailable', async () => {
  const harness = makeHarness();
  harness.firestore.runTransaction = async () => {
    throw new Error('rate-limit store unavailable');
  };

  await assert.rejects(
    harness.handler({ code: 'ADMIN123' }, context('user-1', '203.0.113.10')),
    /rate-limit store unavailable/
  );
  assert.deepEqual(harness.firestore.accessCodeQueries, []);
});

test('exhausted UID boundary returns bounded retry details without an invite lookup', async () => {
  const harness = makeHarness({ uidMaxRequests: 1, networkMaxRequests: 10 });
  await harness.handler({ code: 'ADMIN123' }, context('user-1', '203.0.113.10'));

  await assert.rejects(
    harness.handler({ code: 'PARENT12' }, context('user-1', '203.0.113.11')),
    (error) => error.code === 'resource-exhausted'
      && error.details.retryAfterSeconds >= 1
      && error.details.retryAfterSeconds <= 10
  );
  assert.deepEqual(harness.firestore.accessCodeQueries, ['ADMIN123']);
});

test('exhausted network boundary returns bounded retry details without an invite lookup', async () => {
  const harness = makeHarness({ uidMaxRequests: 10, networkMaxRequests: 1 });
  await harness.handler({ code: 'ADMIN123' }, context('user-1', '203.0.113.10'));

  await assert.rejects(
    harness.handler({ code: 'PARENT12' }, context('user-2', '203.0.113.10')),
    (error) => error.code === 'resource-exhausted'
      && error.details.retryAfterSeconds >= 1
      && error.details.retryAfterSeconds <= 10
  );
  assert.deepEqual(harness.firestore.accessCodeQueries, ['ADMIN123']);
});

test('resets both persistent boundaries after the configured window', async () => {
  const harness = makeHarness({ uidMaxRequests: 1, networkMaxRequests: 1 });
  await harness.handler({ code: 'ADMIN123' }, context('user-1', '203.0.113.10'));
  await assert.rejects(
    harness.handler({ code: 'PARENT12' }, context('user-1', '203.0.113.10')),
    (error) => error.code === 'resource-exhausted'
  );

  harness.setNow(11_000);
  const resetResult = await harness.handler(
    { code: 'PARENT12' },
    context('user-1', '203.0.113.10')
  );

  assert.equal(resetResult.valid, true);
  assert.deepEqual(harness.firestore.accessCodeQueries, ['ADMIN123', 'PARENT12']);
});
