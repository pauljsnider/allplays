'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildOfficialPhoneCandidates,
  createOfficialTeamDiscoveryHandler
} = require('../official-team-discovery-core.cjs');

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function makeFirestore(records = [], { failField = null } = {}) {
  return {
    collectionGroup(name) {
      assert.equal(name, 'officials');
      const filters = [];
      let queryLimit = Infinity;
      return {
        where(field, operator, value) {
          filters.push({ field, operator, value });
          return this;
        },
        limit(value) {
          queryLimit = value;
          return this;
        },
        async get() {
          if (filters.some(({ field }) => field === failField)) throw new Error('query failed');
          const docs = records
            .filter(({ data }) => filters.every(({ field, operator, value }) => {
              if (operator === '==') return data[field] === value;
              if (operator === 'in') return value.includes(data[field]);
              return false;
            }))
            .slice(0, queryLimit)
            .map(({ path, data }) => ({ ref: { path }, data: () => data }));
          return { docs, size: docs.length, empty: docs.length === 0 };
        }
      };
    }
  };
}

function makeHandler(records, authUser, options = {}) {
  return createOfficialTeamDiscoveryHandler({
    firestore: makeFirestore(records, options),
    auth: { getUser: async () => authUser },
    HttpsError,
    maxDocumentsPerQuery: options.maxDocumentsPerQuery
  });
}

const context = { auth: { uid: 'official-1', token: { email: 'stale@example.com' } } };

test('official discovery uses the current enabled Auth email instead of stale token or profile identity', async () => {
  const handler = makeHandler([
    { path: 'teams/old-team/officials/old', data: { email: 'stale@example.com' } },
    { path: 'teams/new-team/officials/current', data: { email: 'current@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    disabled: false
  });

  assert.deepEqual(await handler({}, context), {
    teamIds: ['new-team'],
    teamCount: 1,
    isPartial: false
  });
});

test('official discovery supports normalized and common formatted Auth phone variants', async () => {
  assert.ok(buildOfficialPhoneCandidates({ phoneNumber: '+1 (816) 555-0123' }).includes('(816) 555-0123'));
  const handler = makeHandler([
    { path: 'teams/phone-team/officials/phone', data: { phone: '(816) 555-0123' } }
  ], {
    uid: 'official-1',
    phoneNumber: '+18165550123',
    disabled: false
  });

  assert.deepEqual((await handler({}, context)).teamIds, ['phone-team']);
});

test('official discovery denies disabled accounts', async () => {
  const handler = makeHandler([], { uid: 'official-1', email: 'current@example.com', disabled: true });
  await assert.rejects(handler({}, context), (error) => error.code === 'permission-denied');
});

test('official discovery propagates any query failure instead of returning partial empty access', async () => {
  const handler = makeHandler([], {
    uid: 'official-1',
    email: 'current@example.com',
    disabled: false
  }, { failField: 'emailLower' });

  await assert.rejects(handler({}, context), (error) => (
    error.code === 'unavailable'
    && /could not be verified/i.test(error.message)
  ));
});

test('official discovery fails closed when a bounded query cannot prove completeness', async () => {
  const records = [1, 2, 3].map((index) => ({
    path: `teams/team-${index}/officials/official-${index}`,
    data: { email: 'current@example.com' }
  }));
  const handler = makeHandler(records, {
    uid: 'official-1',
    email: 'current@example.com',
    disabled: false
  }, { maxDocumentsPerQuery: 2 });

  await assert.rejects(handler({}, context), (error) => error.code === 'resource-exhausted');
});

test('official discovery ignores malformed collection-group paths', async () => {
  const handler = makeHandler([
    { path: 'organizations/org-1/officials/not-a-team', data: { email: 'current@example.com' } },
    { path: 'teams/team-1/officials/valid', data: { email: 'current@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    disabled: false
  });

  assert.deepEqual((await handler({}, context)).teamIds, ['team-1']);
});
