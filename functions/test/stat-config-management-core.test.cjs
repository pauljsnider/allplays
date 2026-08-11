'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { hasTeamAdminAccess } = require('../team-admin-access-core.cjs');
const { createStatConfigManagementHandlers } = require('../stat-config-management-core.cjs');

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeFirestore(seed = {}, { failQuery = null } = {}) {
  const state = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));

  function doc(path) {
    return { path, id: path.split('/').pop() };
  }

  function makeQuery(source, { collectionGroup = false, filters = [], queryLimit = Infinity } = {}) {
    return {
      source,
      collectionGroup,
      filters,
      queryLimit,
      where(field, operator, value) {
        return makeQuery(source, { collectionGroup, filters: [...filters, { field, operator, value }], queryLimit });
      },
      limit(value) {
        return makeQuery(source, { collectionGroup, filters, queryLimit: value });
      }
    };
  }

  function getSnapshot(ref) {
    if (ref.filters) {
      if (typeof failQuery === 'function' && failQuery(ref)) throw new Error('forced query failure');
      const sourceDepth = ref.source.split('/').length;
      const docs = [...state.entries()]
        .filter(([path]) => ref.collectionGroup
          ? path.split('/').at(-2) === ref.source
          : path.startsWith(`${ref.source}/`) && path.split('/').length === sourceDepth + 1)
        .map(([path, data]) => ({ ref: doc(path), id: path.split('/').pop(), data: () => clone(data) }))
        .filter((snapshot) => ref.filters.every(({ field, operator, value }) => {
          const actual = snapshot.data()[field];
          if (operator === '==') return actual === value;
          if (operator === 'in') return value.includes(actual);
          if (operator === 'array-contains') return Array.isArray(actual) && actual.includes(value);
          return false;
        }))
        .slice(0, ref.queryLimit);
      return { docs, size: docs.length, empty: docs.length === 0 };
    }
    const data = state.get(ref.path);
    return {
      ref,
      id: ref.id,
      exists: data !== undefined,
      data: () => clone(data)
    };
  }

  return {
    _state: state,
    doc,
    collection: (path) => makeQuery(path),
    collectionGroup: (name) => makeQuery(name, { collectionGroup: true }),
    async runTransaction(callback) {
      const deletes = [];
      const result = await callback({
        get: async (ref) => getSnapshot(ref),
        delete: (ref) => deletes.push(ref.path)
      });
      deletes.forEach((path) => state.delete(path));
      return result;
    }
  };
}

function makeHandlers(seed, options = {}) {
  const firestore = makeFirestore(seed, options);
  const authUser = options.authUser || { uid: 'owner-1', email: 'owner@example.com', emailVerified: true, disabled: false };
  const handlers = createStatConfigManagementHandlers({
    firestore,
    auth: { getUser: async () => authUser },
    hasTeamAdminAccess,
    HttpsError,
    maxConfigs: options.maxConfigs,
    maxSharedGamesPerQuery: options.maxSharedGamesPerQuery
  });
  return { firestore, handlers };
}

const context = { auth: { uid: 'owner-1' } };
const baseSeed = {
  'users/owner-1': { email: 'stale-profile@example.com' },
  'teams/team-1': { ownerId: 'owner-1' }
};

test('delete blocks a legacy shared game linked only through teamIds', async () => {
  const { firestore, handlers } = makeHandlers({
    ...baseSeed,
    'teams/team-1/statTrackerConfigs/config-1': { name: 'Basketball' },
    'organizations/org-1/sharedGames/game-1': { teamIds: ['team-1'], statTrackerConfigId: 'config-1' }
  });

  await assert.rejects(
    handlers.deleteStatConfig({ teamId: 'team-1', configId: 'config-1' }, context),
    (error) => error.code === 'failed-precondition'
  );
  assert.ok(firestore._state.has('teams/team-1/statTrackerConfigs/config-1'));
});

test('delete is atomic and fails closed when reference verification errors', async () => {
  const { firestore, handlers } = makeHandlers({
    ...baseSeed,
    'teams/team-1/statTrackerConfigs/config-1': { name: 'Basketball' }
  }, {
    failQuery: (query) => query.collectionGroup && query.filters.some(({ field }) => field === 'statTrackerConfigId')
  });

  await assert.rejects(
    handlers.deleteStatConfig({ teamId: 'team-1', configId: 'config-1' }, context),
    (error) => error.code === 'unavailable'
  );
  assert.ok(firestore._state.has('teams/team-1/statTrackerConfigs/config-1'));
});

test('delete succeeds only after complete local and shared reference checks', async () => {
  const { firestore, handlers } = makeHandlers({
    ...baseSeed,
    'teams/team-1/statTrackerConfigs/config-1': { name: 'Basketball' },
    'organizations/org-1/sharedGames/unrelated': { homeTeamId: 'team-2', statTrackerConfigId: 'config-1' }
  });

  assert.deepEqual(
    await handlers.deleteStatConfig({ teamId: 'team-1', configId: 'config-1' }, context),
    { deleted: true, configId: 'config-1' }
  );
  assert.equal(firestore._state.has('teams/team-1/statTrackerConfigs/config-1'), false);
});

test('destructive config handlers deny disabled Auth users before mutation', async () => {
  const { firestore, handlers } = makeHandlers({
    ...baseSeed,
    'teams/team-1/statTrackerConfigs/config-1': { name: 'Basketball' }
  }, { authUser: { uid: 'owner-1', email: 'owner@example.com', disabled: true } });

  await assert.rejects(
    handlers.deleteStatConfig({ teamId: 'team-1', configId: 'config-1' }, context),
    (error) => error.code === 'permission-denied'
  );
  assert.ok(firestore._state.has('teams/team-1/statTrackerConfigs/config-1'));
});

test('reset blocks legacy shared history and deletes no configs', async () => {
  const { firestore, handlers } = makeHandlers({
    ...baseSeed,
    'teams/team-1/statTrackerConfigs/config-1': { name: 'One' },
    'teams/team-1/statTrackerConfigs/config-2': { name: 'Two' },
    'organizations/org-1/sharedGames/game-1': { teamIds: ['team-1'], statTrackerConfigId: 'config-2' }
  });

  await assert.rejects(
    handlers.resetTeamStatConfigs({ teamId: 'team-1' }, context),
    (error) => error.code === 'failed-precondition'
  );
  assert.ok(firestore._state.has('teams/team-1/statTrackerConfigs/config-1'));
  assert.ok(firestore._state.has('teams/team-1/statTrackerConfigs/config-2'));
});

test('reset deletes every config in one successful transaction after complete-empty history', async () => {
  const { firestore, handlers } = makeHandlers({
    ...baseSeed,
    'teams/team-1/statTrackerConfigs/config-1': { name: 'One' },
    'teams/team-1/statTrackerConfigs/config-2': { name: 'Two' }
  });

  assert.deepEqual(await handlers.resetTeamStatConfigs({ teamId: 'team-1' }, context), { resetCount: 2 });
  assert.equal(firestore._state.has('teams/team-1/statTrackerConfigs/config-1'), false);
  assert.equal(firestore._state.has('teams/team-1/statTrackerConfigs/config-2'), false);
});

test('reset preserves all configs when bounded shared history cannot prove completeness', async () => {
  const sharedGames = Object.fromEntries([1, 2, 3].map((index) => [
    `organizations/org-1/sharedGames/game-${index}`,
    { homeTeamId: 'team-1', statTrackerConfigId: null }
  ]));
  const { firestore, handlers } = makeHandlers({
    ...baseSeed,
    'teams/team-1/statTrackerConfigs/config-1': { name: 'One' },
    ...sharedGames
  }, { maxSharedGamesPerQuery: 2 });

  await assert.rejects(
    handlers.resetTeamStatConfigs({ teamId: 'team-1' }, context),
    (error) => error.code === 'resource-exhausted'
  );
  assert.ok(firestore._state.has('teams/team-1/statTrackerConfigs/config-1'));
});

test('current Auth email cannot recover access through a stale profile alias', async () => {
  const { firestore, handlers } = makeHandlers({
    'users/owner-1': { email: 'old-admin@example.com' },
    'teams/team-1': { adminEmails: ['old-admin@example.com'] },
    'teams/team-1/statTrackerConfigs/config-1': { name: 'One' }
  }, { authUser: { uid: 'owner-1', email: 'new-email@example.com', disabled: false } });

  await assert.rejects(
    handlers.deleteStatConfig({ teamId: 'team-1', configId: 'config-1' }, context),
    (error) => error.code === 'permission-denied'
  );
  assert.ok(firestore._state.has('teams/team-1/statTrackerConfigs/config-1'));
});

test('destructive config handlers deny unverified admin-email grants', async () => {
  const { firestore, handlers } = makeHandlers({
    'users/owner-1': {},
    'teams/team-1': { adminEmails: ['owner@example.com'] },
    'teams/team-1/statTrackerConfigs/config-1': { name: 'One' }
  }, { authUser: { uid: 'owner-1', email: 'owner@example.com', emailVerified: false, disabled: false } });

  await assert.rejects(
    handlers.deleteStatConfig({ teamId: 'team-1', configId: 'config-1' }, context),
    (error) => error.code === 'permission-denied'
  );
  assert.ok(firestore._state.has('teams/team-1/statTrackerConfigs/config-1'));
});
