const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { DEFAULT_MAX_ICS_BYTES } = require('../calendar-ics-fetch-core.cjs');
const { hashFamilyShareCalendarEventUid } = require('../family-share-view-core.cjs');

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
  metrics.queries = [];
  metrics.activeQueryCount = 0;
  metrics.maxConcurrentQueries = 0;

  function doc(path) {
    return {
      path,
      id: path.split('/').pop(),
      get: async () => {
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

  function collection(path, limitCount = Number.POSITIVE_INFINITY) {
    const group = {
      limit(count) {
        return collection(path, Math.max(0, Math.floor(Number(count) || 0)));
      },
      async get() {
        metrics.activeQueryCount += 1;
        metrics.maxConcurrentQueries = Math.max(metrics.maxConcurrentQueries, metrics.activeQueryCount);
        await Promise.resolve();
        const depth = path.split('/').length + 1;
        const docs = [...state.keys()]
          .filter((entryPath) => entryPath.startsWith(`${path}/`) && entryPath.split('/').length === depth)
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
        metrics.queries.push({ kind: 'collection', path, limit: limitCount, returned: docs.length });
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

  return { doc, collection, collectionGroup };
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
    timeZone() { return this; }
  };
  triggerChain.https = triggerChain;
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

function loadCallables(seed = {}, { metrics = {}, securityUtils = null } = {}) {
  delete require.cache[repoIndexPath];
  const firestore = makeFirestore(seed, metrics);
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
  return {
    isPrivateIpAddress: () => false,
    isBlockedHostname: () => false,
    assertPublicHost: async () => ['203.0.113.10'],
    normalizeTargetUrl: async (rawUrl) => {
      const url = new URL(rawUrl);
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

test('family share view projection omits owner UID and raw calendar URLs from the network payload', async () => {
  const tokenId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const sentinelUrl = 'https://calendar.example.test/feed.ics?secret=SENTINEL_CALENDAR_SECRET';
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      ownerUserId: 'SENTINEL_OWNER_UID',
      label: 'Grandma',
      expiresAt: new FakeTimestamp(Date.parse('2026-08-20T00:00:00Z')),
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
  });
}

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
