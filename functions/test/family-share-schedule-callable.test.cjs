const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;

let adminStub = null;
let functionsStub = null;
let StripeStub = null;

function patchedModuleLoad(request, parent, isMain) {
  if (request === 'firebase-admin' && adminStub) return adminStub;
  if (request === 'firebase-functions' && functionsStub) return functionsStub;
  if (request === 'stripe' && StripeStub) return StripeStub;
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

function makeFirestore(seed = {}) {
  const state = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));

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

  function collection(path) {
    return {
      async get() {
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
          });
        return { docs, size: docs.length, empty: docs.length === 0 };
      }
    };
  }

  function collectionGroup(name, conditions = []) {
    const group = {
      where(field, operator, expected) {
        return collectionGroup(name, [...conditions, { field, operator, expected }]);
      },
      async get() {
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
          }));
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

function loadCallables(seed = {}) {
  delete require.cache[repoIndexPath];
  const firestore = makeFirestore(seed);
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
  return require('../index.js');
}

test.beforeEach(() => {
  delete require.cache[repoIndexPath];
  Module._load = patchedModuleLoad;
  adminStub = null;
  functionsStub = null;
  StripeStub = null;
});

test.afterEach(() => {
  delete require.cache[repoIndexPath];
  Module._load = originalModuleLoad;
  adminStub = null;
  functionsStub = null;
  StripeStub = null;
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
