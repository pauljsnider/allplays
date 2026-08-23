const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { DEFAULT_MAX_ICS_BYTES } = require('../calendar-ics-fetch-core.cjs');
const {
  FAMILY_SHARE_PROJECTION_INCOMPLETE_WARNING,
  hashFamilyShareCalendarEventUid
} = require('../family-share-view-core.cjs');

const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;

let adminStub = null;
let functionsStub = null;
let StripeStub = null;
let securityUtilsStub = null;

function patchedModuleLoad(request, parent, isMain) {
  if (request === 'firebase-admin' && adminStub) return adminStub;
  if (request === 'firebase-functions' && functionsStub) return functionsStub;
  if (request === 'stripe' && StripeStub) return StripeStub;
  if (request === 'resend') return { Resend: class ResendStub {} };
  if (request === './utils/security-utils' && securityUtilsStub) return securityUtilsStub;
  return originalModuleLoad(request, parent, isMain);
}

class FakeTimestamp {
  constructor(milliseconds) {
    this.milliseconds = Number(milliseconds);
  }

  toMillis() {
    return this.milliseconds;
  }

  toDate() {
    return new Date(this.milliseconds);
  }

  static fromMillis(value) {
    return new FakeTimestamp(value);
  }
}

function clone(value) {
  if (value instanceof FakeTimestamp) return new FakeTimestamp(value.toMillis());
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function makeFirestore(seed = {}, metrics = {}) {
  const state = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  metrics.queryReadCount = 0;
  metrics.docReadCount = 0;
  metrics.rateLimitReadCount = 0;
  metrics.queries = [];
  metrics.activeQueryCount = 0;
  metrics.maxConcurrentQueries = 0;

  function doc(path) {
    return {
      path,
      id: path.split('/').pop(),
      get: async () => {
        if (path.startsWith('familyShareRequestRateLimits/')) {
          metrics.rateLimitReadCount += 1;
        } else {
          metrics.docReadCount += 1;
        }
        const value = state.get(path);
        return {
          id: path.split('/').pop(),
          exists: value !== undefined,
          ref: { path },
          data: () => clone(value)
        };
      },
      collection: (name) => collection(`${path}/${name}`)
    };
  }

  function collection(path, limitCount = Number.POSITIVE_INFINITY, conditions = []) {
    const group = {
      doc: (id) => doc(`${path}/${id}`),
      where(field, operator, expected) {
        return collection(path, limitCount, [...conditions, { field, operator, expected }]);
      },
      limit(count) {
        return collection(path, Math.max(0, Math.floor(Number(count) || 0)), conditions);
      },
      async get() {
        metrics.activeQueryCount += 1;
        metrics.maxConcurrentQueries = Math.max(metrics.maxConcurrentQueries, metrics.activeQueryCount);
        await Promise.resolve();
        const forcedFailure = (Array.isArray(metrics.queryFailures) ? metrics.queryFailures : []).find((failure) => (
          failure?.path === path && (!failure.field || conditions.some(({ field, operator }) => (
            field === failure.field && (!failure.operator || operator === failure.operator)
          )))
        ));
        if (forcedFailure) {
          metrics.activeQueryCount -= 1;
          throw new Error(forcedFailure.message || 'Forced query failure');
        }
        const depth = path.split('/').length + 1;
        const docs = [...state.keys()]
          .filter((entryPath) => entryPath.startsWith(`${path}/`) && entryPath.split('/').length === depth)
          .filter((entryPath) => conditions.every(({ field, operator, expected }) => {
            const actual = state.get(entryPath)?.[field];
            if (operator === '==') return actual === expected;
            if (operator === 'in') return Array.isArray(expected) && expected.includes(actual);
            if (operator === 'array-contains') return Array.isArray(actual) && actual.includes(expected);
            throw new Error(`Unsupported fake query operator: ${operator}`);
          }))
          .map((entryPath) => {
            const value = state.get(entryPath);
            return {
              id: entryPath.split('/').pop(),
              exists: true,
              ref: { path: entryPath },
              data: () => clone(value)
            };
          })
          .slice(0, limitCount);
        metrics.queryReadCount += docs.length;
        metrics.queries.push({
          kind: 'collection',
          path,
          conditions: clone(conditions),
          limit: limitCount,
          returned: docs.length
        });
        metrics.activeQueryCount -= 1;
        return { docs, size: docs.length, empty: docs.length === 0 };
      }
    };
    return group;
  }

  function collectionGroup(name, conditions = [], limitCount = Number.POSITIVE_INFINITY) {
    const group = {
      where(field, operator, expected) {
        return collectionGroup(name, [...conditions, { field, operator, expected }], limitCount);
      },
      limit(count) {
        return collectionGroup(name, conditions, Math.max(0, Math.floor(Number(count) || 0)));
      },
      async get() {
        metrics.activeQueryCount += 1;
        metrics.maxConcurrentQueries = Math.max(metrics.maxConcurrentQueries, metrics.activeQueryCount);
        await Promise.resolve();
        const docs = [...state.entries()]
          .filter(([entryPath]) => entryPath.split('/').at(-2) === name)
          .filter(([, value]) => conditions.every(({ field, operator, expected }) => {
            const actual = value?.[field];
            if (operator === '==') return actual === expected;
            if (operator === 'array-contains') return Array.isArray(actual) && actual.includes(expected);
            throw new Error(`Unsupported fake query operator: ${operator}`);
          }))
          .map(([entryPath, value]) => ({
            id: entryPath.split('/').pop(),
            exists: true,
            ref: { path: entryPath },
            data: () => clone(value)
          }))
          .slice(0, limitCount);
        metrics.queryReadCount += docs.length;
        metrics.queries.push({
          kind: 'collectionGroup',
          path: name,
          conditions: clone(conditions),
          limit: limitCount,
          returned: docs.length
        });
        metrics.activeQueryCount -= 1;
        return { docs, size: docs.length, empty: docs.length === 0 };
      }
    };
    return group;
  }

  return {
    doc,
    collection,
    collectionGroup,
    runTransaction: async (operation) => operation({
      get: (ref) => ref.get(),
      set: (ref, value) => state.set(ref.path, clone(value))
    })
  };
}

function makeFunctionsStub() {
  class HttpsError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }

  const triggerChain = {
    onCall: (fn) => fn,
    onRequest: (fn) => fn,
    onCreate: (fn) => fn,
    onUpdate: (fn) => fn,
    onWrite: (fn) => fn,
    onDelete: (fn) => fn,
    onRun: (fn) => fn,
    document() { return this; },
    schedule() { return this; },
    timeZone() { return this; },
    user() { return this; }
  };
  triggerChain.https = triggerChain;
  triggerChain.auth = triggerChain;
  triggerChain.firestore = triggerChain;
  triggerChain.pubsub = triggerChain;

  return {
    config: () => ({ stripe: { secret_key: 'sk_test_123', app_url: 'https://allplays.test' } }),
    auth: { user: () => triggerChain },
    https: { HttpsError, onCall: (fn) => fn, onRequest: (fn) => fn },
    firestore: { document: () => triggerChain },
    pubsub: { schedule: () => triggerChain },
    runWith: () => triggerChain,
    logger: { error() {}, warn() {}, info() {} }
  };
}

function loadCallables(seed = {}, { metrics = {}, securityUtils = null, firestore: firestoreOverride = null } = {}) {
  delete require.cache[repoIndexPath];
  const firestore = firestoreOverride || makeFirestore(seed, metrics);
  adminStub = {
    apps: [true],
    initializeApp() {},
    firestore: Object.assign(() => firestore, {
      FieldValue: {
        serverTimestamp: () => new FakeTimestamp(Date.now()),
        delete: () => ({ __op: 'delete' }),
        increment: (amount) => ({ __op: 'increment', amount }),
        arrayUnion: (...items) => ({ __op: 'arrayUnion', items })
      },
      Timestamp: FakeTimestamp,
      FieldPath: { documentId: () => '__name__' }
    }),
    auth: () => ({ verifyIdToken: async () => null }),
    messaging: () => ({})
  };
  functionsStub = makeFunctionsStub();
  StripeStub = class StripeMock {
    constructor() {
      return {
        checkout: { sessions: { create: async () => ({}) } },
        webhooks: { constructEvent: () => { throw new Error('Not implemented in test.'); } }
      };
    }
  };
  securityUtilsStub = securityUtils;
  return require('../index.js');
}

function makeCalendarSecurityUtilsStub(icsText, counters = {}) {
  counters.fetchCount = 0;
  counters.normalizeCount = 0;
  return {
    isPrivateIpAddress: () => false,
    isBlockedHostname: () => false,
    assertPublicHost: async () => ['203.0.113.10'],
    normalizeTargetUrl: async (rawUrl) => {
      counters.normalizeCount += 1;
      let normalizedRawUrl = String(rawUrl || '').trim();
      if (/^webcals?:\/\//i.test(normalizedRawUrl)) {
        normalizedRawUrl = normalizedRawUrl.replace(/^webcals?:\/\//i, 'https://');
      } else if (/^http:\/\//i.test(normalizedRawUrl)) {
        normalizedRawUrl = normalizedRawUrl.replace(/^http:\/\//i, 'https://');
      }
      const url = new URL(normalizedRawUrl);
      url.hash = '';
      return { url: url.toString(), hostname: url.hostname, publicIps: ['203.0.113.10'] };
    },
    fetchWithTimeout: async () => {
      counters.fetchCount += 1;
      return {
        ok: true,
        status: 200,
        text: async () => icsText
      };
    }
  };
}

function makeDenseFamilyShareSeed(tokenId) {
  const seed = {
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'budget-parent',
      children: [
        { teamId: 'team-a', playerId: 'player-a' },
        { teamId: 'team-b', playerId: 'player-b' }
      ]
    },
    'users/budget-parent': {
      parentPlayerKeys: ['team-a::player-a', 'team-b::player-b']
    },
    'teams/team-a': { name: 'Team A', isPublic: false },
    'teams/team-b': { name: 'Team B', isPublic: false },
    'teams/team-a/players/player-a': { name: 'Player A' },
    'teams/team-b/players/player-b': { name: 'Player B' }
  };
  ['team-a', 'team-b'].forEach((teamId) => {
    for (let index = 0; index < 300; index += 1) {
      seed[`teams/${teamId}/games/direct-${String(index).padStart(3, '0')}`] = {
        type: 'game',
        date: new FakeTimestamp(Date.parse('2026-07-20T18:00:00Z') + index * 60_000),
        opponent: `Direct ${index}`
      };
      seed[`organizations/budget/sharedGames/${teamId}-shared-${String(index).padStart(3, '0')}`] = {
        type: 'game',
        date: new FakeTimestamp(Date.parse('2026-08-20T18:00:00Z') + index * 60_000),
        homeTeamId: teamId,
        homeTeamName: teamId === 'team-a' ? 'Team A' : 'Team B',
        awayTeamId: `${teamId}-opponent`,
        awayTeamName: `Shared ${index}`,
        teamIds: [teamId, `${teamId}-opponent`]
      };
    }
  });
  return seed;
}

test.beforeEach(() => {
  delete require.cache[repoIndexPath];
  Module._load = patchedModuleLoad;
  adminStub = null;
  functionsStub = null;
  StripeStub = null;
  securityUtilsStub = null;
});

test.afterEach(() => {
  delete require.cache[repoIndexPath];
  Module._load = originalModuleLoad;
  adminStub = null;
  functionsStub = null;
  StripeStub = null;
  securityUtilsStub = null;
});

test('family share schedule callable validates bearer token and projects private team games', async () => {
  const tokenId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'parent-1',
      children: [
        { teamId: 'private-team', teamName: 'Old Bears', playerId: 'player-1', playerName: 'Sam Player' }
      ]
    },
    'users/parent-1': {
      parentPlayerKeys: ['private-team::player-1']
    },
    'teams/private-team': {
      name: 'Bears',
      isPublic: false,
      calendarUrls: ['https://calendar.example.test/team.ics'],
      adminEmails: ['coach@example.test']
    },
    'teams/private-team/players/player-1': {
      name: 'Sam Player'
    },
    'teams/private-team/games/game-1': {
      type: 'game',
      date: new FakeTimestamp(Date.parse('2026-07-13T18:00:00Z')),
      opponent: 'Tigers',
      location: 'Private Field',
      status: 'scheduled',
      homeScore: 4,
      awayScore: 2,
      assignments: [{ private: true }],
      internalNotes: 'staff-only'
    }
  });

  const result = await callables.getFamilyShareSchedule({ tokenId }, {});

  assert.deepEqual(result.children, [
    {
      teamId: 'private-team',
      teamName: 'Bears',
      playerId: 'player-1',
      playerName: 'Sam Player',
      playerNumber: '',
      playerPhotoUrl: null
    }
  ]);
  assert.equal(result.teams[0].teamId, 'private-team');
  assert.equal(result.teams[0].teamName, 'Bears');
  assert.deepEqual(result.teams[0].calendarUrls, []);
  assert.deepEqual(result.teams[0].games, [
    {
      id: 'game-1',
      gameId: 'game-1',
      type: 'game',
      date: '2026-07-13T18:00:00.000Z',
      opponent: 'Tigers',
      location: 'Private Field',
      status: 'scheduled',
      homeScore: 4,
      awayScore: 2
    }
  ]);
});

for (const [callableName, tokenId] of [
  ['getFamilyShareView', '5555555555555555555555555555555555555555'],
  ['getFamilyShareSchedule', '6666666666666666666666666666666666666666'],
  ['resolveFamilyShareTokenChildren', '7777777777777777777777777777777777777777']
]) {
  test(`${callableName} rejects an exhausted shared family request bucket before datastore reads`, async () => {
    const metrics = {};
    const callables = loadCallables({
      [`familyShareTokens/${tokenId}`]: {
        active: true,
        ownerUserId: 'quota-parent',
        children: [{ teamId: 'quota-team', playerId: 'quota-player' }]
      },
      'users/quota-parent': { parentPlayerKeys: ['quota-team::quota-player'] },
      'teams/quota-team': { name: 'Quota Team', isPublic: false },
      'teams/quota-team/players/quota-player': { name: 'Quota Player' }
    }, { metrics });
    const context = { rawRequest: { ip: `203.0.113.${callableName.length}` } };

    for (let attempt = 0; attempt < 60; attempt += 1) {
      await callables[callableName]({ tokenId }, context);
    }
    const readsBeforeRejection = {
      docReadCount: metrics.docReadCount,
      queryReadCount: metrics.queryReadCount,
      rateLimitReadCount: metrics.rateLimitReadCount
    };

    await assert.rejects(
      callables[callableName]({ tokenId }, context),
      (error) => error.code === 'resource-exhausted'
        && Number.isFinite(error.details?.retryAfterSeconds)
        && error.details.retryAfterSeconds > 0
    );
    assert.deepEqual({
      docReadCount: metrics.docReadCount,
      queryReadCount: metrics.queryReadCount
    }, {
      docReadCount: readsBeforeRejection.docReadCount,
      queryReadCount: readsBeforeRejection.queryReadCount
    });
    assert.equal(metrics.rateLimitReadCount, readsBeforeRejection.rateLimitReadCount + 1);
  });
}

test('alternating family share callables across independently loaded handlers cannot multiply the shared request allowance', async () => {
  const tokenId = '8888888888888888888888888888888888888888';
  const metrics = {};
  const seed = {
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'alternating-parent',
      children: [{ teamId: 'alternating-team', playerId: 'alternating-player' }]
    },
    'users/alternating-parent': { parentPlayerKeys: ['alternating-team::alternating-player'] },
    'teams/alternating-team': { name: 'Alternating Team', isPublic: false },
    'teams/alternating-team/players/alternating-player': { name: 'Alternating Player' }
  };
  const sharedFirestore = makeFirestore(seed, metrics);
  const firstHandler = loadCallables({}, { metrics, firestore: sharedFirestore });
  const secondHandler = loadCallables({}, { metrics, firestore: sharedFirestore });
  const handlers = [firstHandler, secondHandler];
  const callableNames = ['getFamilyShareView', 'getFamilyShareSchedule', 'resolveFamilyShareTokenChildren'];
  const context = { rawRequest: { ip: '203.0.113.90' } };

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const handler = handlers[attempt % handlers.length];
    await handler[callableNames[attempt % callableNames.length]]({ tokenId }, context);
  }
  const readsBeforeRejection = {
    docReadCount: metrics.docReadCount,
    queryReadCount: metrics.queryReadCount,
    rateLimitReadCount: metrics.rateLimitReadCount
  };

  await assert.rejects(
    secondHandler.getFamilyShareSchedule({ tokenId }, context),
    (error) => error.code === 'resource-exhausted'
  );
  assert.deepEqual({
    docReadCount: metrics.docReadCount,
    queryReadCount: metrics.queryReadCount
  }, {
    docReadCount: readsBeforeRejection.docReadCount,
    queryReadCount: readsBeforeRejection.queryReadCount
  });
  assert.equal(metrics.rateLimitReadCount, readsBeforeRejection.rateLimitReadCount + 1);
});

test('family share child resolution rejects links outside the owner scope', async () => {
  const tokenId = '9999999999999999999999999999999999999999';
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'scope-parent',
      children: [{ teamId: 'other-team', playerId: 'other-player' }]
    },
    'users/scope-parent': { parentPlayerKeys: ['owned-team::owned-player'] },
    'teams/owned-team': { name: 'Owned Team' },
    'teams/owned-team/players/owned-player': { name: 'Owned Player' },
    'teams/other-team': { name: 'Other Team' },
    'teams/other-team/players/other-player': { name: 'Other Player' }
  });

  const result = await callables.resolveFamilyShareTokenChildren(
    { tokenId },
    { rawRequest: { ip: '203.0.113.91' } }
  );

  assert.deepEqual(result, { children: [] });
});

for (const [label, tokenCharacter, children] of [
  ['empty', 'e', []],
  ['null', 'b', null],
  ['malformed', 'c', [{ teamId: '', playerId: 'player-1' }]]
]) {
  test(`family share ${label} stored child scope cannot expand to all owner children`, async () => {
    const tokenId = tokenCharacter.repeat(40);
    const callables = loadCallables({
      [`familyShareTokens/${tokenId}`]: {
        active: true,
        ownerUserId: 'scoped-parent',
        children
      },
      'users/scoped-parent': {
        parentOf: [{ teamId: 'owned-team', playerId: 'owned-player' }]
      },
      'teams/owned-team': { name: 'Owned Team' },
      'teams/owned-team/players/owned-player': { name: 'Owned Player' }
    });

    const result = await callables.resolveFamilyShareTokenChildren(
      { tokenId },
      { rawRequest: { ip: '203.0.113.95' } }
    );

    assert.deepEqual(result, { children: [] });
  });
}

test('family share token without a children property shares nothing', async () => {
  const tokenId = '9696969696969696969696969696969696969696';
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'legacy-parent'
    },
    'users/legacy-parent': {
      parentOf: [{ teamId: 'legacy-team', playerId: 'legacy-player' }]
    },
    'teams/legacy-team': { name: 'Legacy Team' },
    'teams/legacy-team/players/legacy-player': { name: 'Legacy Player' }
  });

  const result = await callables.resolveFamilyShareTokenChildren(
    { tokenId },
    { rawRequest: { ip: '203.0.113.96' } }
  );

  assert.deepEqual(result, { children: [] });
});

test('family share empty child scope cannot expose token-level calendar URLs', async () => {
  const tokenId = '9797979797979797979797979797979797979797';
  const sentinelUrl = 'https://calendar.example.test/private.ics?token=EMPTY_SCOPE_SECRET';
  let normalizeCalls = 0;
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'empty-calendar-parent',
      children: [],
      extraCalendarUrls: [sentinelUrl]
    },
    'users/empty-calendar-parent': {
      parentOf: [{ teamId: 'owned-team', playerId: 'owned-player' }]
    },
    'teams/owned-team': { name: 'Owned Team' },
    'teams/owned-team/players/owned-player': { name: 'Owned Player' }
  }, {
    securityUtils: {
      isPrivateIpAddress: () => false,
      isBlockedHostname: () => false,
      assertPublicHost: async () => ['203.0.113.10'],
      normalizeTargetUrl: async () => {
        normalizeCalls += 1;
        throw new Error('Empty capability scope must not inspect calendar URLs');
      },
      fetchWithTimeout: async () => {
        throw new Error('Empty capability scope must not fetch calendar URLs');
      }
    }
  });

  const result = await callables.getFamilyShareView(
    { tokenId },
    { rawRequest: { ip: '203.0.113.97' } }
  );

  assert.deepEqual(result.children, []);
  assert.deepEqual(result.externalEvents, []);
  assert.equal(normalizeCalls, 0);
  assert.equal(JSON.stringify(result).includes('EMPTY_SCOPE_SECRET'), false);
});

test('family share view does not expose stale parentOf children after canonical access is revoked', async () => {
  const tokenId = '9191919191919191919191919191919191919191';
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'revoked-parent',
      children: [{ teamId: 'private-team', playerId: 'removed-player' }]
    },
    'users/revoked-parent': {
      parentOf: [{ teamId: 'private-team', playerId: 'removed-player' }],
      parentTeamIds: [],
      parentPlayerKeys: []
    },
    'teams/private-team': { name: 'Private Team', isPublic: false },
    'teams/private-team/players/removed-player': { name: 'Removed Player' },
    'teams/private-team/games/private-game': {
      type: 'game',
      date: new FakeTimestamp(Date.parse('2026-09-01T18:00:00Z')),
      opponent: 'Private Opponent'
    }
  });

  const result = await callables.getFamilyShareView(
    { tokenId },
    { rawRequest: { ip: '203.0.113.92' } }
  );

  assert.deepEqual(result.children, []);
  assert.deepEqual(result.teams, []);
  assert.deepEqual(result.externalEvents, []);
});

test('family share view does not restore a removed sibling through same-team access', async () => {
  const tokenId = '9292929292929292929292929292929292929292';
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'sibling-parent',
      children: [
        { teamId: 'private-team', playerId: 'removed-player' },
        { teamId: 'private-team', playerId: 'current-player' }
      ]
    },
    'users/sibling-parent': {
      parentOf: [
        { teamId: 'private-team', playerId: 'removed-player' },
        { teamId: 'private-team', playerId: 'current-player' }
      ],
      parentTeamIds: ['private-team'],
      parentPlayerKeys: ['private-team::current-player']
    },
    'teams/private-team': { name: 'Private Team', isPublic: false },
    'teams/private-team/players/removed-player': { name: 'Removed Player' },
    'teams/private-team/players/current-player': { name: 'Current Player' }
  });

  const result = await callables.getFamilyShareView(
    { tokenId },
    { rawRequest: { ip: '203.0.113.93' } }
  );

  assert.deepEqual(result.children.map((child) => child.playerId), ['current-player']);
});

test('family share view does not infer child access from team-only canonical scope', async () => {
  const tokenId = '9393939393939393939393939393939393939393';
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'team-only-parent',
      children: [{ teamId: 'private-team', playerId: 'stale-player' }]
    },
    'users/team-only-parent': {
      parentOf: [{ teamId: 'private-team', playerId: 'stale-player' }],
      parentTeamIds: ['private-team']
    },
    'teams/private-team': { name: 'Private Team', isPublic: false },
    'teams/private-team/players/stale-player': { name: 'Stale Player' }
  });

  const result = await callables.getFamilyShareView(
    { tokenId },
    { rawRequest: { ip: '203.0.113.94' } }
  );

  assert.deepEqual(result.children, []);
  assert.deepEqual(result.teams, []);
});

test('family share view projection omits owner UID and raw calendar URLs from the network payload', async () => {
  const tokenId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const sentinelUrl = 'https://calendar.example.test/feed.ics?secret=SENTINEL_CALENDAR_SECRET';
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'SENTINEL_OWNER_UID',
      label: 'Grandma',
      expiresAt: new FakeTimestamp(Date.parse('2099-08-20T00:00:00Z')),
      children: [{ teamId: 'private-team', playerId: 'player-1' }],
      extraCalendarUrls: []
    },
    'users/SENTINEL_OWNER_UID': {
      parentPlayerKeys: ['private-team::player-1']
    },
    'teams/private-team': {
      name: 'Bears',
      isPublic: false,
      calendarUrls: [sentinelUrl]
    },
    'teams/private-team/players/player-1': { name: 'Sam Player' },
    'teams/private-team/games/game-1': {
      type: 'game',
      date: new FakeTimestamp(Date.parse('2026-07-20T18:00:00Z')),
      opponent: 'Tigers',
      internalNotes: 'SENTINEL_STAFF_NOTE'
    }
  });

  const result = await callables.getFamilyShareView({ tokenId }, { rawRequest: { ip: '203.0.113.8' } });
  const payload = JSON.stringify(result);

  assert.equal(result.projectionVersion, 2);
  assert.equal(result.presentation.label, 'Grandma');
  assert.equal(payload.includes('SENTINEL_OWNER_UID'), false);
  assert.equal(payload.includes('SENTINEL_CALENDAR_SECRET'), false);
  assert.equal(payload.includes('SENTINEL_STAFF_NOTE'), false);
  assert.equal(payload.includes('ownerUserId'), false);
  assert.equal(payload.includes('extraCalendarUrls'), false);
  assert.equal(payload.includes('calendarUrls'), false);
});

test('family share schedule callable includes organization shared games for scoped teams', async () => {
  const tokenId = 'dddddddddddddddddddddddddddddddddddddddd';
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'parent-1',
      children: [
        { teamId: 'private-team', playerId: 'player-1', playerName: 'Sam Player' }
      ]
    },
    'users/parent-1': {
      parentPlayerKeys: ['private-team::player-1']
    },
    'teams/private-team': {
      name: 'Bears',
      isPublic: false
    },
    'teams/private-team/players/player-1': {
      name: 'Sam Player'
    },
    'teams/private-team/games/local-game': {
      type: 'game',
      date: new FakeTimestamp(Date.parse('2026-07-13T18:00:00Z')),
      opponent: 'Tigers',
      location: 'Private Field'
    },
    'organizations/org-1/sharedGames/shared-game': {
      date: new FakeTimestamp(Date.parse('2026-07-14T19:00:00Z')),
      location: 'Org Field',
      homeTeamId: 'private-team',
      homeTeamName: 'Bears',
      awayTeamId: 'away-team',
      awayTeamName: 'Wolves',
      teamIds: ['private-team', 'away-team'],
      assignments: [{ private: true }]
    }
  });

  const result = await callables.getFamilyShareSchedule({ tokenId }, {});
  const games = result.teams[0].games;

  assert.equal(games.length, 2);
  assert.deepEqual(games[1], {
    id: 'shared_organizations%2Forg-1%2FsharedGames%2Fshared-game',
    gameId: 'shared_organizations%2Forg-1%2FsharedGames%2Fshared-game',
    type: 'game',
    date: '2026-07-14T19:00:00.000Z',
    location: 'Org Field',
    opponent: 'Wolves',
    sharedGameId: 'shared-game',
    sharedGamePath: 'organizations/org-1/sharedGames/shared-game',
    teamId: 'private-team',
    opponentTeamId: 'away-team',
    opponentTeamName: 'Wolves',
    opponentTeamPhoto: null,
    isHome: true,
    isSharedGame: true,
    competitionType: 'tournament',
    countsTowardSeasonRecord: true
  });
});

for (const callableName of ['getFamilyShareSchedule', 'getFamilyShareView']) {
  test(`${callableName} shares one bounded read budget fairly across teams and game sources`, async () => {
    const tokenId = callableName === 'getFamilyShareView'
      ? 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
      : 'ffffffffffffffffffffffffffffffffffffffff';
    const metrics = {};
    const callables = loadCallables(makeDenseFamilyShareSeed(tokenId), { metrics });

    const result = await callables[callableName](
      { tokenId },
      { rawRequest: { ip: '203.0.113.31' } }
    );
    const teamsById = new Map(result.teams.map((team) => [team.teamId, team]));

    assert.equal(metrics.queryReadCount, 500);
    assert.ok(teamsById.get('team-a').games.some((game) => game.id.startsWith('direct-')));
    assert.ok(teamsById.get('team-a').games.some((game) => game.id.startsWith('shared_')));
    assert.ok(teamsById.get('team-b').games.some((game) => game.id.startsWith('direct-')));
    assert.ok(teamsById.get('team-b').games.some((game) => game.id.startsWith('shared_')));
    assert.ok(result.teams.flatMap((team) => team.games).length <= 500);
    assert.equal(metrics.queries.filter((query) => query.kind === 'collectionGroup').length, 6);
    assert.ok(metrics.queries.every((query) => Number.isFinite(query.limit) && query.limit <= 500));
    assert.ok(metrics.maxConcurrentQueries >= 2);
    if (callableName === 'getFamilyShareView') {
      assert.deepEqual(result.calendarWarnings, [FAMILY_SHARE_PROJECTION_INCOMPLETE_WARNING]);
    }
  });
}

test('family share view reports bounded authorized children and teams as incomplete', async () => {
  const tokenId = 'abababababababababababababababababababab';
  const children = [];
  const parentPlayerKeys = [];
  const seed = {
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'bounded-parent'
    }
  };
  for (let index = 0; index < 51; index += 1) {
    const teamIndex = index < 21 ? index : 0;
    const teamId = `bounded-team-${teamIndex}`;
    const playerId = `bounded-player-${index}`;
    children.push({ teamId, playerId });
    parentPlayerKeys.push(`${teamId}::${playerId}`);
    seed[`teams/${teamId}`] = { name: `Bounded Team ${teamIndex}`, isPublic: false };
    seed[`teams/${teamId}/players/${playerId}`] = { name: `Bounded Player ${index}` };
  }
  seed[`familyShareTokens/${tokenId}`].children = children;
  seed['users/bounded-parent'] = { parentPlayerKeys };
  const callables = loadCallables(seed);

  const result = await callables.getFamilyShareView(
    { tokenId },
    { rawRequest: { ip: '203.0.113.38' } }
  );

  assert.equal(result.children.length, 50);
  assert.equal(result.teams.length, 20);
  assert.deepEqual(result.calendarWarnings, [FAMILY_SHARE_PROJECTION_INCOMPLETE_WARNING]);
});

test('family share calendar target quota is charged only for cache-miss outbound work', async () => {
  const tokenId = '1111111111111111111111111111111111111111';
  const calendarUrl = 'https://203.0.113.10/cache-quota.ics';
  const counters = {};
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'parent-cache',
      children: [{ teamId: 'team-cache', playerId: 'player-cache' }]
    },
    'users/parent-cache': { parentPlayerKeys: ['team-cache::player-cache'] },
    'teams/team-cache': { name: 'Cache Team', isPublic: false, calendarUrls: [calendarUrl] },
    'teams/team-cache/players/player-cache': { name: 'Cache Player' }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub([
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:cache-quota-event',
      'DTSTART:20260720T180000Z',
      'SUMMARY:Practice',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n'), counters)
  });

  const request = () => callables.getFamilyShareView(
    { tokenId },
    { rawRequest: { ip: '203.0.113.32' } }
  );
  const coalescedResults = await Promise.all(Array.from({ length: 21 }, request));
  const cachedResult = await request();

  assert.equal(counters.fetchCount, 1);
  [...coalescedResults, cachedResult].forEach((result) => {
    assert.equal(result.externalEvents.length, 1);
    assert.deepEqual(result.calendarWarnings, []);
  });
});

test('family share view reports stale calendar cache as incomplete', async () => {
  const tokenId = '7777777777777777777777777777777777777777';
  const calendarUrl = 'https://203.0.113.10/stale-family-share.ics';
  let upstreamFails = false;
  let fetchCount = 0;
  const securityUtils = makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS);
  securityUtils.fetchWithTimeout = async () => {
    fetchCount += 1;
    if (upstreamFails) throw new Error('temporary provider failure');
    return {
      ok: true,
      status: 200,
      text: async () => VALID_TEAM_CALENDAR_ICS
    };
  };
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'parent-stale-family',
      children: [{ teamId: 'team-stale-family', playerId: 'player-stale-family' }]
    },
    'users/parent-stale-family': {
      parentPlayerKeys: ['team-stale-family::player-stale-family']
    },
    'teams/team-stale-family': {
      name: 'Stale Family Team',
      isPublic: false,
      calendarUrls: [calendarUrl]
    },
    'teams/team-stale-family/players/player-stale-family': { name: 'Stale Family Player' }
  }, { securityUtils });
  const context = { rawRequest: { ip: '203.0.113.36' } };

  const live = await callables.getFamilyShareView({ tokenId }, context);
  assert.equal(live.externalEvents.length, 1);
  assert.deepEqual(live.calendarWarnings, []);

  upstreamFails = true;
  const originalDateNow = Date.now;
  Date.now = () => originalDateNow() + (10 * 60_000);
  try {
    const stale = await callables.getFamilyShareView({ tokenId }, context);
    assert.deepEqual(stale.externalEvents, []);
    assert.equal(stale.calendarWarnings.length, 1);
  } finally {
    Date.now = originalDateNow;
  }
  assert.equal(fetchCount, 2);
});

test('family share view reports bounded calendar source truncation as incomplete', async () => {
  const tokenId = '9999999999999999999999999999999999999999';
  const calendarUrls = Array.from(
    { length: 9 },
    (_entry, index) => `https://203.0.113.10/family-source-${index + 1}.ics`
  );
  const counters = {};
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'parent-bounded-family',
      children: [{ teamId: 'team-bounded-family', playerId: 'player-bounded-family' }]
    },
    'users/parent-bounded-family': {
      parentPlayerKeys: ['team-bounded-family::player-bounded-family']
    },
    'teams/team-bounded-family': {
      name: 'Bounded Family Team',
      isPublic: false,
      calendarUrls
    },
    'teams/team-bounded-family/players/player-bounded-family': { name: 'Bounded Family Player' }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS, counters)
  });

  const result = await callables.getFamilyShareView(
    { tokenId },
    { rawRequest: { ip: '203.0.113.37' } }
  );

  assert.equal(counters.fetchCount, 8);
  assert.equal(result.calendarWarnings.length, 1);
  assert.match(result.calendarWarnings[0], /could not be loaded/i);
});

for (const [label, tokenId, icsText] of [
  [
    'oversized',
    '3333333333333333333333333333333333333333',
    `BEGIN:VCALENDAR\r\n${'X'.repeat(DEFAULT_MAX_ICS_BYTES + 1)}\r\nEND:VCALENDAR`
  ],
  [
    'malformed',
    '4444444444444444444444444444444444444444',
    'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:missing-calendar-end\r\nEND:VEVENT'
  ]
]) {
  test(`family share calendar projection rejects ${label} ICS before caching`, async () => {
    const calendarUrl = `https://203.0.113.10/${label}.ics`;
    const counters = {};
    const callables = loadCallables({
      [`familyShareTokens/${tokenId}`]: {
        active: true,
        ownerUserId: `parent-${label}`,
        children: [{ teamId: `team-${label}`, playerId: `player-${label}` }]
      },
      [`users/parent-${label}`]: { parentPlayerKeys: [`team-${label}::player-${label}`] },
      [`teams/team-${label}`]: { name: `${label} Team`, isPublic: false, calendarUrls: [calendarUrl] },
      [`teams/team-${label}/players/player-${label}`]: { name: `${label} Player` }
    }, {
      securityUtils: makeCalendarSecurityUtilsStub(icsText, counters)
    });

    const result = await callables.getFamilyShareView(
      { tokenId },
      { rawRequest: { ip: label === 'oversized' ? '203.0.113.34' : '203.0.113.35' } }
    );

    assert.equal(counters.fetchCount, 1);
    assert.deepEqual(result.externalEvents, []);
    assert.equal(result.calendarWarnings.length, 1);
  });
}

test('family share view rejects an over-limit recurrence as partial instead of returning a complete prefix', async () => {
  const tokenId = 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd';
  const calendarUrl = 'https://203.0.113.10/over-limit-recurrence.ics';
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'parent-over-limit',
      children: [{ teamId: 'team-over-limit', playerId: 'player-over-limit' }]
    },
    'users/parent-over-limit': { parentPlayerKeys: ['team-over-limit::player-over-limit'] },
    'teams/team-over-limit': { name: 'Over Limit Team', isPublic: false, calendarUrls: [calendarUrl] },
    'teams/team-over-limit/players/player-over-limit': { name: 'Over Limit Player' }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub([
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:over-limit-series',
      'DTSTART:20260720T180000Z',
      'RRULE:FREQ=DAILY;COUNT=367',
      'SUMMARY:Practice',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n'))
  });

  const result = await callables.getFamilyShareView(
    { tokenId },
    { rawRequest: { ip: '203.0.113.39' } }
  );

  assert.deepEqual(result.externalEvents, []);
  assert.equal(result.calendarWarnings.length, 1);
  assert.match(result.calendarWarnings[0], /could not be loaded/i);
});

test('family share view retains a bounded external prefix and reports aggregate response truncation', async () => {
  const tokenId = 'dededededededededededededededededededede';
  const calendarUrls = [
    'https://203.0.113.10/aggregate-one.ics',
    'https://203.0.113.10/aggregate-two.ics'
  ];
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'parent-aggregate',
      children: [{ teamId: 'team-aggregate', playerId: 'player-aggregate' }]
    },
    'users/parent-aggregate': { parentPlayerKeys: ['team-aggregate::player-aggregate'] },
    'teams/team-aggregate': { name: 'Aggregate Team', isPublic: false, calendarUrls },
    'teams/team-aggregate/players/player-aggregate': { name: 'Aggregate Player' }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub([
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:aggregate-series',
      'DTSTART:20260720T180000Z',
      'RRULE:FREQ=DAILY;COUNT=300',
      'SUMMARY:Practice',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n'))
  });

  const result = await callables.getFamilyShareView(
    { tokenId },
    { rawRequest: { ip: '203.0.113.40' } }
  );

  assert.equal(result.externalEvents.length, 500);
  assert.deepEqual(result.calendarWarnings, [FAMILY_SHARE_PROJECTION_INCOMPLETE_WARNING]);
});

test('family share callables omit database calendar UIDs and de-duplicate ICS privately', async () => {
  const tokenId = '2222222222222222222222222222222222222222';
  const rawUid = 'SENTINEL_PARENT_EMAIL@example.test';
  const calendarUrl = 'https://203.0.113.10/private-dedup.ics';
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'parent-dedup',
      children: [{ teamId: 'team-dedup', playerId: 'player-dedup' }]
    },
    'users/parent-dedup': { parentPlayerKeys: ['team-dedup::player-dedup'] },
    'teams/team-dedup': { name: 'Dedup Team', isPublic: false, calendarUrls: [calendarUrl] },
    'teams/team-dedup/players/player-dedup': { name: 'Dedup Player' },
    'teams/team-dedup/games/tracked-game': {
      type: 'game',
      date: new FakeTimestamp(Date.parse('2026-07-20T18:00:00Z')),
      opponent: 'Tracked Opponent',
      calendarEventUid: rawUid
    }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub([
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      `UID:${rawUid}`,
      'DTSTART:20260820T180000Z',
      'SUMMARY:Different timestamp proves UID dedup',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n'))
  });

  const legacyResult = await callables.getFamilyShareSchedule({ tokenId }, {});
  const viewResult = await callables.getFamilyShareView(
    { tokenId },
    { rawRequest: { ip: '203.0.113.33' } }
  );
  const payload = JSON.stringify({ legacyResult, viewResult });

  assert.equal(viewResult.externalEvents.length, 0);
  assert.equal(payload.includes(rawUid), false);
  assert.equal(payload.includes(hashFamilyShareCalendarEventUid(rawUid)), false);
  assert.equal(payload.includes('calendarEventUid'), false);
  assert.equal(payload.includes('calendarUidHash'), false);
});

test('family share schedule callable rejects client-stored teams outside the token owner parent scope', async () => {
  const tokenId = 'cccccccccccccccccccccccccccccccccccccccc';
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'parent-1',
      children: [
        { teamId: 'private-team', playerId: 'player-1', playerName: 'Target Player' }
      ]
    },
    'users/parent-1': {
      parentPlayerKeys: ['owned-team::owned-player']
    },
    'teams/owned-team': { name: 'Owned Team' },
    'teams/owned-team/players/owned-player': { name: 'Owned Player' },
    'teams/private-team': { name: 'Private Team', isPublic: false },
    'teams/private-team/players/player-1': { name: 'Target Player' },
    'teams/private-team/games/private-game': {
      date: new FakeTimestamp(Date.parse('2026-07-13T18:00:00Z')),
      opponent: 'Secret Opponent',
      location: 'Private Field'
    }
  });

  const result = await callables.getFamilyShareSchedule({ tokenId }, {});

  assert.deepEqual(result, { children: [], teams: [] });
});

test('family share schedule callable strips private nested fields from recurring-game projections', async () => {
  const tokenId = 'dddddddddddddddddddddddddddddddddddddddd';
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'parent-1',
      children: [{ teamId: 'team-1', playerId: 'player-1' }]
    },
    'users/parent-1': { parentPlayerKeys: ['team-1::player-1'] },
    'teams/team-1': { name: 'Bears', isPublic: false },
    'teams/team-1/players/player-1': { name: 'Sam Player' },
    'teams/team-1/games/series-1': {
      type: 'practice',
      date: new FakeTimestamp(Date.parse('2026-07-13T18:00:00Z')),
      startTime: '18:00',
      endTime: '19:30',
      endDayOffset: 0,
      isSeriesMaster: true,
      recurrence: {
        freq: 'weekly',
        interval: 1,
        byDays: ['MO'],
        until: new FakeTimestamp(Date.parse('2026-08-31T23:59:59Z')),
        staffRule: 'do not expose'
      },
      exDates: ['2026-07-27'],
      overrides: {
        '2026-07-20': {
          title: 'Evening practice',
          location: 'Main Gym',
          startTime: '18:30',
          notes: 'Private coach note',
          assignments: [{ userId: 'coach-1' }]
        }
      },
      internalNotes: 'Staff only',
      assignments: [{ userId: 'coach-1' }]
    }
  });

  const result = await callables.getFamilyShareSchedule({ tokenId }, {});
  const projectedGame = result.teams[0].games[0];

  assert.equal(projectedGame.startTime, '18:00');
  assert.equal(projectedGame.endTime, '19:30');
  assert.equal(projectedGame.endDayOffset, 0);
  assert.deepEqual(projectedGame.recurrence, {
    freq: 'weekly',
    interval: 1,
    byDays: ['MO'],
    until: '2026-08-31T23:59:59.000Z'
  });
  assert.deepEqual(projectedGame.overrides, {
    '2026-07-20': {
      title: 'Evening practice',
      location: 'Main Gym',
      startTime: '18:30'
    }
  });
  assert.equal('notes' in projectedGame.overrides['2026-07-20'], false);
  assert.equal('assignments' in projectedGame.overrides['2026-07-20'], false);
  assert.equal('internalNotes' in projectedGame, false);
  assert.equal('assignments' in projectedGame, false);
});

test('family share schedule callable rejects inactive bearer tokens before schedule projection', async () => {
  const tokenId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: false,
      children: [{ teamId: 'private-team', playerId: 'player-1' }]
    },
    'teams/private-team': { name: 'Bears', isPublic: false }
  });

  await assert.rejects(
    callables.getFamilyShareSchedule({ tokenId }, {}),
    (error) => error.code === 'permission-denied'
  );
});

const VALID_TEAM_CALENDAR_ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:authenticated-team-event',
  'DTSTART:20260820T180000Z',
  'SUMMARY:Private practice',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

function teamCalendarContext(uid, email = '', emailVerified = true, ipSuffix = '40') {
  return {
    auth: {
      uid,
      token: {
        email,
        email_verified: emailVerified
      }
    },
    rawRequest: { ip: `203.0.113.${ipSuffix}` }
  };
}

function createCalendarHttpResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function invokeCalendarHttp(handler, {
  origin,
  method = 'GET',
  ip = '203.0.113.80',
  url = 'https://203.0.113.10/native-calendar.ics'
} = {}) {
  const req = {
    method,
    ip,
    headers: { origin },
    query: { url }
  };
  const res = createCalendarHttpResponse();
  await handler(req, res);
  return res;
}

test('legacy calendar HTTP bridge accepts exact native origins for preflight and GET requests', async () => {
  const counters = {};
  const callables = loadCallables({}, {
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS, counters)
  });
  const nativeOrigins = ['https://localhost', 'capacitor://localhost'];

  for (const [index, origin] of nativeOrigins.entries()) {
    const optionsResponse = await invokeCalendarHttp(callables.fetchCalendarIcs, {
      origin,
      method: 'OPTIONS',
      ip: `203.0.113.${80 + index}`
    });
    assert.equal(optionsResponse.statusCode, 204);
    assert.equal(optionsResponse.headers['Access-Control-Allow-Origin'], origin);
    assert.equal(optionsResponse.headers.Vary, 'Origin');

    const getResponse = await invokeCalendarHttp(callables.fetchCalendarIcs, {
      origin,
      ip: `203.0.113.${82 + index}`,
      url: `https://203.0.113.10/native-calendar-${index}.ics`
    });
    assert.equal(getResponse.statusCode, 200);
    assert.equal(getResponse.headers['Access-Control-Allow-Origin'], origin);
    assert.equal(getResponse.headers.Vary, 'Origin');
    assert.equal(getResponse.body.ok, true);
    assert.equal(getResponse.body.icsText, VALID_TEAM_CALENDAR_ICS);
  }

  assert.equal(counters.normalizeCount, 2);
  assert.equal(counters.fetchCount, 2);
});

test('legacy calendar HTTP bridge denies native-origin lookalikes and wrong schemes without reflection', async () => {
  const counters = {};
  const callables = loadCallables({}, {
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS, counters)
  });
  const deniedOrigins = [
    'http://localhost',
    'https://localhost:444',
    'https://localhost.evil.test',
    'capacitor://localhost.evil.test',
    'https://127.0.0.1',
    'capacitor://127.0.0.1'
  ];

  for (const [originIndex, origin] of deniedOrigins.entries()) {
    for (const method of ['OPTIONS', 'GET']) {
      const response = await invokeCalendarHttp(callables.fetchCalendarIcs, {
        origin,
        method,
        ip: `198.51.100.${90 + originIndex}`
      });
      assert.equal(response.statusCode, 403);
      assert.deepEqual(response.body, { ok: false, error: 'Origin not allowed' });
      assert.equal(response.headers['Access-Control-Allow-Origin'], undefined);
      assert.equal(response.headers.Vary, undefined);
    }
  }

  assert.equal(counters.normalizeCount, 0);
  assert.equal(counters.fetchCount, 0);
});

test('authenticated team calendar callable validates auth UID and request field types before loading data', async () => {
  const callables = loadCallables();

  await assert.rejects(
    callables.getTeamCalendarIcs({
      teamId: 'team-auth',
      calendarUrl: 'https://203.0.113.10/team.ics'
    }, {}),
    (error) => error.code === 'unauthenticated'
  );
  await assert.rejects(
    callables.getTeamCalendarIcs({
      teamId: 'team-auth',
      calendarUrl: 'https://203.0.113.10/team.ics'
    }, teamCalendarContext('bad/uid')),
    (error) => error.code === 'unauthenticated'
  );

  for (const data of [
    { teamId: 123, calendarUrl: 'https://203.0.113.10/team.ics' },
    { teamId: 'bad/team', calendarUrl: 'https://203.0.113.10/team.ics' },
    { teamId: 'team-auth', calendarUrl: 123 },
    { teamId: 'team-auth', calendarUrl: 'https://203.0.113.10/team.ics', forceRefresh: 'true' }
  ]) {
    await assert.rejects(
      callables.getTeamCalendarIcs(data, teamCalendarContext('valid.uid:1')),
      (error) => error.code === 'invalid-argument'
    );
  }
});

test('authenticated team calendar callable allows canonical owner, verified admin, and platform admin without returning the source URL', async () => {
  const storedCalendarUrl = 'WEBCALS://203.0.113.10/private-team.ics?token=SENTINEL_SOURCE_URL#stored-fragment';
  const requestedCalendarUrl = 'http://203.0.113.10/private-team.ics?token=SENTINEL_SOURCE_URL#request-fragment';
  const counters = {};
  const callables = loadCallables({
    'users/owner-1': {},
    'users/admin-1': { coachOf: ['private-team'] },
    'users/platform-1': { isAdmin: true },
    'teams/private-team': {
      active: true,
      isPublic: false,
      ownerId: 'owner-1',
      adminEmails: ['admin@example.test'],
      calendarUrls: [storedCalendarUrl]
    },
    'accessCodes/stale-admin-invite': {
      type: 'admin_invite',
      teamId: 'private-team',
      used: true,
      revoked: true,
      usedBy: 'admin-1'
    }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS, counters)
  });

  const results = await Promise.all([
    callables.getTeamCalendarIcs(
      { teamId: 'private-team', calendarUrl: requestedCalendarUrl },
      teamCalendarContext('owner-1', '', false, '41')
    ),
    callables.getTeamCalendarIcs(
      { teamId: 'private-team', calendarUrl: requestedCalendarUrl },
      teamCalendarContext('admin-1', 'ADMIN@example.test', true, '42')
    ),
    callables.getTeamCalendarIcs(
      { teamId: 'private-team', calendarUrl: requestedCalendarUrl },
      teamCalendarContext('platform-1', '', false, '43')
    )
  ]);

  assert.equal(counters.fetchCount, 1);
  results.forEach((result) => {
    assert.equal(result.version, 1);
    assert.ok(['live', 'cache'].includes(result.source));
    assert.match(result.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(result.icsText, VALID_TEAM_CALENDAR_ICS);
    assert.equal(result.complete, true);
    assert.deepEqual(Object.keys(result).sort(), ['complete', 'fetchedAt', 'icsText', 'source', 'version']);
    assert.equal(JSON.stringify(result).includes('SENTINEL_SOURCE_URL'), false);
  });
});

test('authenticated team calendar callable allows a bounded coachOf-only grant after authoritative lifecycle verification', async () => {
  const calendarUrl = 'https://203.0.113.10/legacy-coach.ics';
  const metrics = {};
  const callables = loadCallables({
    'users/legacy-coach': {
      coachOf: ['legacy-coach-team']
    },
    'teams/legacy-coach-team': {
      active: true,
      isPublic: false,
      ownerId: 'owner-elsewhere',
      adminEmails: [],
      calendarUrls: [calendarUrl]
    }
  }, {
    metrics,
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS)
  });

  const result = await callables.getTeamCalendarIcs(
    { teamId: 'legacy-coach-team', calendarUrl },
    teamCalendarContext('legacy-coach', '', false, '63')
  );

  assert.equal(result.complete, true);
  assert.equal(result.icsText, VALID_TEAM_CALENDAR_ICS);
  const evidenceQuery = metrics.queries.find((query) => query.path === 'accessCodes');
  assert.deepEqual(evidenceQuery.conditions, [
    { field: 'type', operator: '==', expected: 'admin_invite' },
    { field: 'teamId', operator: 'in', expected: ['legacy-coach-team'] }
  ]);
  assert.equal(evidenceQuery.limit, 201);
});

test('authenticated team calendar callable accepts slash-free dotted and colon team IDs without coercion', async () => {
  const teamId = 'legacy.team:2026';
  const calendarUrl = 'https://203.0.113.10/punctuated-team.ics';
  const callables = loadCallables({
    'users/legacy-coach': {
      coachOf: [teamId, 12345, ' whitespace-team ']
    },
    [`teams/${teamId}`]: {
      active: true,
      ownerId: 'owner-elsewhere',
      adminEmails: [],
      calendarUrls: [calendarUrl]
    },
    'accessCodes/punctuated-team-other-principal': {
      type: 'admin_invite',
      teamId,
      used: true,
      usedBy: 'other.user:1'
    }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS)
  });

  const result = await callables.getTeamCalendarIcs(
    { teamId, calendarUrl },
    teamCalendarContext('legacy-coach', '', false, '69')
  );
  assert.equal(result.complete, true);
});

test('authenticated team calendar callable ignores stable invite evidence bound to another principal', async () => {
  const calendarUrl = 'https://203.0.113.10/other-principal.ics';
  const callables = loadCallables({
    'users/legacy-coach': {
      coachOf: ['legacy-coach-team']
    },
    'teams/legacy-coach-team': {
      active: true,
      ownerId: 'owner-elsewhere',
      adminEmails: [],
      calendarUrls: [calendarUrl]
    },
    'accessCodes/other-principal-invite': {
      type: 'admin_invite',
      teamId: 'legacy-coach-team',
      used: true,
      usedBy: 'other.user:1'
    },
    'accessCodes/unrelated-ambiguous-invite': {
      type: 'admin_invite',
      teamId: 'different-team',
      used: false
    }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS)
  });

  const result = await callables.getTeamCalendarIcs(
    { teamId: 'legacy-coach-team', calendarUrl },
    teamCalendarContext('legacy-coach', '', false, '64')
  );
  assert.equal(result.complete, true);
});

for (const [label, invite] of [
  ['caller-bound accepted', { used: true, usedBy: 'legacy-coach' }],
  ['caller-bound revoked', { used: true, revoked: true, usedBy: 'legacy-coach' }],
  ['unbound', { used: false }],
  ['malformed-principal', { used: true, usedBy: 'not/a/uid' }],
  ['non-string-principal', { used: true, usedBy: 12345 }]
]) {
  test(`authenticated team calendar callable denies ${label} lifecycle evidence for a coachOf-only grant`, async () => {
    const calendarUrl = `https://203.0.113.10/denied-${label.replace(/[^a-z]+/g, '-')}.ics`;
    const counters = {};
    const callables = loadCallables({
      'users/legacy-coach': {
        coachOf: ['legacy-coach-team']
      },
      'teams/legacy-coach-team': {
        active: true,
        ownerId: 'owner-elsewhere',
        adminEmails: [],
        calendarUrls: [calendarUrl]
      },
      'accessCodes/candidate-invite': {
        type: 'admin_invite',
        teamId: 'legacy-coach-team',
        ...invite
      }
    }, {
      securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS, counters)
    });

    await assert.rejects(
      callables.getTeamCalendarIcs(
        { teamId: 'legacy-coach-team', calendarUrl },
        teamCalendarContext('legacy-coach', '', false, '65')
      ),
      (error) => error.code === 'permission-denied'
    );
    assert.equal(counters.fetchCount, 0);
  });
}

test('authenticated team calendar callable denies a coachOf-only grant when lifecycle evidence overflows', async () => {
  const calendarUrl = 'https://203.0.113.10/overflow.ics';
  const inviteHistory = Object.fromEntries(Array.from({ length: 201 }, (_entry, index) => [
    `accessCodes/other-principal-${index}`,
    {
      type: 'admin_invite',
      teamId: 'legacy-coach-team',
      used: true,
      usedBy: `former-coach-${index}`
    }
  ]));
  const counters = {};
  const callables = loadCallables({
    ...inviteHistory,
    'users/legacy-coach': { coachOf: ['legacy-coach-team'] },
    'teams/legacy-coach-team': {
      active: true,
      ownerId: 'owner-elsewhere',
      adminEmails: [],
      calendarUrls: [calendarUrl]
    }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS, counters)
  });

  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: 'legacy-coach-team', calendarUrl },
      teamCalendarContext('legacy-coach', '', false, '66')
    ),
    (error) => error.code === 'permission-denied'
  );
  assert.equal(counters.fetchCount, 0);
});

test('authenticated team calendar callable denies a coachOf-only grant when lifecycle evidence cannot be read', async () => {
  const calendarUrl = 'https://203.0.113.10/read-failed.ics';
  const counters = {};
  const metrics = {
    queryFailures: [{
      path: 'accessCodes',
      field: 'teamId',
      operator: 'in',
      message: 'invite evidence unavailable'
    }]
  };
  const callables = loadCallables({
    'users/legacy-coach': { coachOf: ['legacy-coach-team'] },
    'teams/legacy-coach-team': {
      active: true,
      ownerId: 'owner-elsewhere',
      adminEmails: [],
      calendarUrls: [calendarUrl]
    }
  }, {
    metrics,
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS, counters)
  });

  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: 'legacy-coach-team', calendarUrl },
      teamCalendarContext('legacy-coach', '', false, '67')
    ),
    (error) => error.code === 'permission-denied'
  );
  assert.equal(counters.fetchCount, 0);
});

test('authenticated team calendar callable keeps coachOf recovery inside the managed-team bound', async () => {
  const calendarUrl = 'https://203.0.113.10/outside-bound.ics';
  const coachOf = Array.from({ length: 181 }, (_entry, index) => `legacy-team-${index}`);
  const counters = {};
  const callables = loadCallables({
    'users/legacy-coach': { coachOf },
    'teams/legacy-team-180': {
      active: true,
      ownerId: 'owner-elsewhere',
      adminEmails: [],
      calendarUrls: [calendarUrl]
    }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS, counters)
  });

  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: 'legacy-team-180', calendarUrl },
      teamCalendarContext('legacy-coach', '', false, '68')
    ),
    (error) => error.code === 'permission-denied'
  );
  assert.equal(counters.fetchCount, 0);
});

test('authenticated team calendar callable rejects even an early coachOf target when the staff scope overflows', async () => {
  const calendarUrl = 'https://203.0.113.10/early-overflow-target.ics';
  const targetTeamId = 'legacy-target';
  const coachOf = [
    targetTeamId,
    ...Array.from({ length: 180 }, (_entry, index) => `other-legacy-team-${index}`)
  ];
  const counters = {};
  const metrics = {};
  const callables = loadCallables({
    'users/legacy-coach': { coachOf },
    [`teams/${targetTeamId}`]: {
      active: true,
      ownerId: 'owner-elsewhere',
      adminEmails: [],
      calendarUrls: [calendarUrl]
    }
  }, {
    metrics,
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS, counters)
  });

  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: targetTeamId, calendarUrl },
      teamCalendarContext('legacy-coach', '', false, '70')
    ),
    (error) => error.code === 'permission-denied'
  );
  assert.equal(counters.fetchCount, 0);
  assert.equal(metrics.queries.some((query) => query.path === 'accessCodes'), false);
});

test('authenticated team calendar callable allows a stable linked parent for a private active team', async () => {
  const calendarUrl = 'https://203.0.113.10/parent-team.ics';
  const callables = loadCallables({
    'users/parent-1': {
      parentTeamIds: ['private-parent-team']
    },
    'users/legacy-parent': {
      parentOf: [{ teamId: 'private-parent-team', childId: 'player-1' }]
    },
    'teams/private-parent-team': {
      active: true,
      isPublic: false,
      ownerId: 'owner-elsewhere',
      calendarUrls: [calendarUrl]
    }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS)
  });

  const result = await callables.getTeamCalendarIcs(
    { teamId: 'private-parent-team', calendarUrl },
    teamCalendarContext('parent-1', 'parent@example.test', true, '44')
  );

  assert.equal(result.complete, true);
  assert.equal(result.icsText, VALID_TEAM_CALENDAR_ICS);

  const legacyResult = await callables.getTeamCalendarIcs(
    { teamId: 'private-parent-team', calendarUrl },
    teamCalendarContext('legacy-parent', 'legacy-parent@example.test', true, '61')
  );
  assert.equal(legacyResult.complete, true);
});

test('authenticated team calendar callable preserves source 52 with one guarded target resolution', async () => {
  const calendarUrls = Array.from(
    { length: 52 },
    (_entry, index) => `https://203.0.113.10/source-${index + 1}.ics`
  );
  const counters = {};
  const callables = loadCallables({
    'users/owner-52': {},
    'teams/team-52': {
      active: true,
      ownerId: 'owner-52',
      calendarUrls
    }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS, counters)
  });

  const result = await callables.getTeamCalendarIcs(
    { teamId: 'team-52', calendarUrl: calendarUrls[51] },
    teamCalendarContext('owner-52', '', false, '58')
  );

  assert.equal(result.complete, true);
  assert.equal(counters.normalizeCount, 1);
  assert.equal(counters.fetchCount, 1);
});

test('authenticated team calendar callable denies unrelated users and revoked legacy parent links', async () => {
  const calendarUrl = 'https://203.0.113.10/revoked-parent-team.ics';
  const callables = loadCallables({
    'users/unrelated-1': {},
    'users/revoked-parent': {
      parentTeamIds: [],
      parentOf: [{ teamId: 'private-team', playerId: 'player-1' }]
    },
    'users/malformed-parent': {
      parentTeamIds: null,
      parentOf: [{ teamId: 'private-team', playerId: 'player-1' }]
    },
    'users/key-revoked-parent': {
      parentPlayerKeys: ['private-team::player-1::junk'],
      parentOf: [{ teamId: 'private-team', playerId: 'player-1' }]
    },
    'users/numeric-parent': {
      parentPlayerKeys: [123],
      parentOf: [{ teamId: 'private-team', playerId: 'player-1' }]
    },
    'users/incomplete-legacy-parent': {
      parentOf: [{ teamId: 'private-team' }]
    },
    'users/valid-key-parent': {
      parentPlayerKeys: ['private-team::player-1']
    },
    'teams/private-team': {
      active: true,
      isPublic: false,
      ownerId: 'owner-elsewhere',
      calendarUrls: [calendarUrl]
    }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS)
  });

  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: 'private-team', calendarUrl },
      teamCalendarContext('unrelated-1', 'unrelated@example.test', true, '45')
    ),
    (error) => error.code === 'permission-denied'
  );
  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: 'private-team', calendarUrl },
      teamCalendarContext('revoked-parent', 'parent@example.test', true, '46')
    ),
    (error) => error.code === 'permission-denied'
  );
  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: 'private-team', calendarUrl },
      teamCalendarContext('malformed-parent', 'malformed@example.test', true, '62')
    ),
    (error) => error.code === 'permission-denied'
  );
  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: 'private-team', calendarUrl },
      teamCalendarContext('key-revoked-parent', 'key-revoked@example.test', true, '63')
    ),
    (error) => error.code === 'permission-denied'
  );
  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: 'private-team', calendarUrl },
      teamCalendarContext('numeric-parent', 'numeric@example.test', true, '64')
    ),
    (error) => error.code === 'permission-denied'
  );
  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: 'private-team', calendarUrl },
      teamCalendarContext('incomplete-legacy-parent', 'incomplete@example.test', true, '69')
    ),
    (error) => error.code === 'permission-denied'
  );
  const validKeyResult = await callables.getTeamCalendarIcs(
    { teamId: 'private-team', calendarUrl },
    teamCalendarContext('valid-key-parent', 'valid-key@example.test', true, '65')
  );
  assert.equal(validKeyResult.complete, true);
});

test('authenticated team calendar callable does not restore access from stale profile email or legacy owner aliases beside ownerId', async () => {
  const calendarUrl = 'https://203.0.113.10/identity-boundary.ics';
  const callables = loadCallables({
    'users/stale-admin': {
      email: 'old-admin@example.test',
      profileEmail: 'old-admin@example.test'
    },
    'users/legacy-owner': {
      email: 'legacy-owner@example.test',
      profileEmail: 'legacy-owner@example.test'
    },
    'teams/admin-team': {
      active: true,
      ownerId: 'owner-elsewhere',
      adminEmails: ['old-admin@example.test'],
      calendarUrls: [calendarUrl]
    },
    'teams/canonical-owner-team': {
      active: true,
      ownerId: 'new-owner',
      ownerEmail: 'legacy-owner@example.test',
      ownerEmailLower: 'legacy-owner@example.test',
      calendarUrls: [calendarUrl]
    }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS)
  });

  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: 'admin-team', calendarUrl },
      teamCalendarContext('stale-admin', 'new-admin@example.test', true, '47')
    ),
    (error) => error.code === 'permission-denied'
  );
  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: 'canonical-owner-team', calendarUrl },
      teamCalendarContext('legacy-owner', 'legacy-owner@example.test', true, '48')
    ),
    (error) => error.code === 'permission-denied'
  );
});

test('authenticated team calendar callable allows one consistent ownerId-less legacy owner only from a verified current token email', async () => {
  const calendarUrl = 'https://203.0.113.10/legacy-owner.ics';
  const callables = loadCallables({
    'users/legacy-owner': {},
    'teams/legacy-team': {
      active: true,
      ownerEmail: 'Legacy-Owner@example.test',
      ownerEmailLower: 'legacy-owner@example.test',
      calendarUrls: [calendarUrl]
    }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS)
  });

  const result = await callables.getTeamCalendarIcs(
    { teamId: 'legacy-team', calendarUrl },
    teamCalendarContext('legacy-owner', 'LEGACY-OWNER@example.test', true, '53')
  );
  assert.equal(result.complete, true);

  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: 'legacy-team', calendarUrl },
      teamCalendarContext('legacy-owner', 'legacy-owner@example.test', false, '54')
    ),
    (error) => error.code === 'permission-denied'
  );
  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: 'legacy-team', calendarUrl },
      teamCalendarContext('legacy-owner', 'different@example.test', true, '55')
    ),
    (error) => error.code === 'permission-denied'
  );
});

test('authenticated team calendar callable fails closed for conflicting ownerId-less legacy owner aliases', async () => {
  const calendarUrl = 'https://203.0.113.10/conflicting-legacy-owner.ics';
  const callables = loadCallables({
    'users/legacy-owner': {},
    'teams/conflicting-legacy-team': {
      active: true,
      ownerEmail: 'first-owner@example.test',
      ownerEmailLower: 'second-owner@example.test',
      calendarUrls: [calendarUrl]
    }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS)
  });

  for (const [email, ipSuffix] of [
    ['first-owner@example.test', '56'],
    ['second-owner@example.test', '57']
  ]) {
    await assert.rejects(
      callables.getTeamCalendarIcs(
        { teamId: 'conflicting-legacy-team', calendarUrl },
        teamCalendarContext('legacy-owner', email, true, ipSuffix)
      ),
      (error) => error.code === 'permission-denied'
    );
  }
});

test('authenticated team calendar callable rejects inactive teams and calendar URLs outside the canonical team source list', async () => {
  const listedCalendarUrl = 'https://203.0.113.10/listed.ics';
  const counters = {};
  const callables = loadCallables({
    'users/owner-1': {},
    'teams/active-team': {
      active: true,
      ownerId: 'owner-1',
      calendarUrls: [listedCalendarUrl]
    },
    'teams/inactive-team': {
      active: false,
      ownerId: 'owner-1',
      calendarUrls: [listedCalendarUrl]
    }
  }, {
    securityUtils: makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS, counters)
  });

  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: 'active-team', calendarUrl: 'https://203.0.113.10/unlisted.ics' },
      teamCalendarContext('owner-1', '', false, '49')
    ),
    (error) => error.code === 'permission-denied'
  );
  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: 'inactive-team', calendarUrl: listedCalendarUrl },
      teamCalendarContext('owner-1', '', false, '50')
    ),
    (error) => error.code === 'not-found'
  );
  assert.equal(counters.normalizeCount, 0);
  assert.equal(counters.fetchCount, 0);
});

test('authenticated team calendar callable sanitizes upstream failures without echoing the private source URL', async () => {
  const calendarUrl = 'https://203.0.113.10/failure.ics?token=SENTINEL_PRIVATE_CALENDAR_TOKEN';
  const securityUtils = makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS);
  securityUtils.fetchWithTimeout = async () => {
    throw new Error(`Provider rejected ${calendarUrl}`);
  };
  const callables = loadCallables({
    'users/owner-1': {},
    'teams/private-team': {
      active: true,
      ownerId: 'owner-1',
      calendarUrls: [calendarUrl]
    }
  }, { securityUtils });

  await assert.rejects(
    callables.getTeamCalendarIcs(
      { teamId: 'private-team', calendarUrl },
      teamCalendarContext('owner-1', '', false, '51')
    ),
    (error) => error.code === 'unavailable'
      && !error.message.includes('SENTINEL_PRIVATE_CALENDAR_TOKEN')
      && !JSON.stringify(error.details || {}).includes('SENTINEL_PRIVATE_CALENDAR_TOKEN')
  );
});

for (const [label, icsText] of [
  ['oversized', `BEGIN:VCALENDAR\r\n${'X'.repeat(DEFAULT_MAX_ICS_BYTES + 1)}\r\nEND:VCALENDAR`],
  ['malformed', 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:missing-calendar-end\r\nEND:VEVENT']
]) {
  test(`authenticated team calendar callable rejects and does not cache ${label} ICS`, async () => {
    const calendarUrl = `https://203.0.113.10/authenticated-${label}.ics`;
    const counters = {};
    const callables = loadCallables({
      [`users/owner-${label}`]: {},
      [`teams/team-${label}`]: {
        active: true,
        ownerId: `owner-${label}`,
        calendarUrls: [calendarUrl]
      }
    }, {
      securityUtils: makeCalendarSecurityUtilsStub(icsText, counters)
    });
    const context = teamCalendarContext(
      `owner-${label}`,
      '',
      false,
      label === 'oversized' ? '59' : '60'
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(
        callables.getTeamCalendarIcs(
          { teamId: `team-${label}`, calendarUrl },
          context
        ),
        (error) => error.code === 'unavailable'
      );
    }
    assert.equal(counters.fetchCount, 2);
  });
}

test('authenticated team calendar callable rejects stale-cache fallback as partial evidence', async () => {
  const calendarUrl = 'https://203.0.113.10/stale-cache.ics';
  let upstreamFails = false;
  let fetchCount = 0;
  const securityUtils = makeCalendarSecurityUtilsStub(VALID_TEAM_CALENDAR_ICS);
  securityUtils.fetchWithTimeout = async () => {
    fetchCount += 1;
    if (upstreamFails) throw new Error('temporary provider failure');
    return {
      ok: true,
      status: 200,
      text: async () => VALID_TEAM_CALENDAR_ICS
    };
  };
  const callables = loadCallables({
    'users/owner-1': {},
    'teams/private-team': {
      active: true,
      ownerId: 'owner-1',
      calendarUrls: [calendarUrl]
    }
  }, { securityUtils });
  const context = teamCalendarContext('owner-1', '', false, '52');

  const live = await callables.getTeamCalendarIcs(
    { teamId: 'private-team', calendarUrl },
    context
  );
  assert.equal(live.source, 'live');
  assert.equal(live.complete, true);

  upstreamFails = true;
  const originalDateNow = Date.now;
  Date.now = () => originalDateNow() + (10 * 60_000);
  try {
    await assert.rejects(
      callables.getTeamCalendarIcs(
        { teamId: 'private-team', calendarUrl },
        context
      ),
      (error) => error.code === 'unavailable'
    );
  } finally {
    Date.now = originalDateNow;
  }
  assert.equal(fetchCount, 2);
});
