const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const { join } = require('node:path');
const {
  getPublicOpponentStatKeys,
  normalizeTeamId,
  isPublicProjectionItemAfterCursor,
  parsePublicGamesQuery,
  serializePublicGame
} = require('../public-team-api-core.cjs');

const source = readFileSync(join(__dirname, '..', 'index.js'), 'utf8');
const firestoreIndexes = JSON.parse(readFileSync(join(__dirname, '..', '..', 'firestore.indexes.json'), 'utf8'));

function loadPublicTeamDataAccess(firestore) {
  const constantsStart = source.indexOf('const PUBLIC_TEAM_API_MAX_ROSTER_SCAN_DOCUMENTS');
  const constantsEnd = source.indexOf('function setPublicTeamApiCorsHeaders', constantsStart);
  const playersStart = source.indexOf('async function getPublicTeamPlayers');
  const functionsEnd = source.indexOf('function sendPublicTeamApiSuccess', playersStart);
  const implementation = [
    source.slice(constantsStart, constantsEnd),
    source.slice(playersStart, functionsEnd),
    'return { getPublicTeamPlayers, getPublicTeamGames, getPublicOpponentStatKeysByGameId };'
  ].join('\n');

  return new Function(
    'firestore',
    'getPublicOpponentStatKeys',
    'normalizeTeamId',
    'isPublicProjectionItemAfterCursor',
    'serializePublicGame',
    implementation
  )(
    firestore,
    getPublicOpponentStatKeys,
    normalizeTeamId,
    isPublicProjectionItemAfterCursor,
    serializePublicGame
  );
}

function loadConfiguredPublicLeagueStandings({ teamsById, gamesByTeamId }) {
  const helperStart = source.indexOf('async function getConfiguredPublicLeagueStandings');
  const helperEnd = source.indexOf('function decodePublicSharedGamePath', helperStart);
  const implementation = [
    source.slice(helperStart, helperEnd),
    'return getConfiguredPublicLeagueStandings;'
  ].join('\n');
  const getStrictPublicTeam = async (teamId) => teamsById.get(teamId) || null;
  const getPublicTeamGames = async (teamId, range) => {
    getPublicTeamGames.ranges.push({ teamId, from: range.from, to: range.to, limit: range.limit });
    return gamesByTeamId.get(teamId) || [];
  };
  getPublicTeamGames.ranges = [];
  const helper = new Function(
    'MAX_CALLABLE_DISCOVERY_CONCURRENCY',
    'getPublicTeamGames',
    'getStrictPublicTeam',
    'normalizeTeamId',
    'parsePublicGamesQuery',
    'runWithConcurrencyLimit',
    'serializePublicGame',
    'throwOpportunityError',
    implementation
  )(
    4,
    getPublicTeamGames,
    getStrictPublicTeam,
    normalizeTeamId,
    parsePublicGamesQuery,
    async (items, _limit, mapper) => Promise.all(items.map(mapper)),
    serializePublicGame,
    (code, message) => {
      const error = new Error(message);
      error.code = code;
      throw error;
    }
  );
  return { helper, getPublicTeamGames };
}

function makeQuerySnapshot(docs) {
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach(callback) {
      docs.forEach(callback);
    }
  };
}

function makeDoc(id, data) {
  return { id, data: () => data };
}

function makeFirestore({ players = [], games = [], configs = {}, metrics = {} } = {}) {
  metrics.gameLimits = [];
  metrics.gameStartAfterIds = [];
  metrics.gameDocumentsRead = 0;

  function makeGamesQuery(lastDoc = null, limitCount = games.length) {
    return {
      where() {
        return this;
      },
      orderBy() {
        return this;
      },
      startAfter(doc) {
        metrics.gameStartAfterIds.push(doc.id);
        return makeGamesQuery(doc, limitCount);
      },
      limit(count) {
        metrics.gameLimits.push(count);
        return makeGamesQuery(lastDoc, count);
      },
      async get() {
        const start = lastDoc ? games.indexOf(lastDoc) + 1 : 0;
        const docs = games.slice(start, start + limitCount);
        metrics.gameDocumentsRead += docs.length;
        return makeQuerySnapshot(docs);
      }
    };
  }

  return {
    doc(path) {
      const configId = path.split('/').at(-1);
      const config = configs[configId];
      return {
        async get() {
          return {
            exists: Boolean(config),
            data: () => config
          };
        }
      };
    },
    collectionGroup(path) {
      if (path !== 'sharedGames') {
        throw new Error(`Unexpected collection group: ${path}`);
      }
      const query = {
        where() {
          return query;
        },
        orderBy() {
          return query;
        },
        limit() {
          return query;
        },
        async get() {
          return makeQuerySnapshot([]);
        }
      };
      return query;
    },
    collection(path) {
      if (path.endsWith('/players')) {
        return {
          limit(count) {
            return {
              async get() {
                return makeQuerySnapshot(players.slice(0, count));
              }
            };
          }
        };
      }
      if (path.endsWith('/games')) return makeGamesQuery();
      throw new Error(`Unexpected collection path: ${path}`);
    }
  };
}

test('exports versioned public roster and games HTTPS handlers', () => {
  assert.match(source, /exports\.publicTeamRosterV1 = functions/);
  assert.match(source, /exports\.publicTeamGamesV1 = functions/);
  assert.match(source, /getStrictPublicTeam\(request\.teamId\)/);
  assert.match(source, /isStrictPublicTeam\(team\)/);
});

test('public team handlers use bounded games reads and field-whitelisting serializers', () => {
  const start = source.indexOf('async function getPublicTeamGames');
  const end = source.indexOf('exports.publicTeamGamesIcs = functions', start);
  const apiSource = source.slice(start, end);

  assert.match(apiSource, /buildPublicRosterResponse/);
  assert.match(apiSource, /buildPublicGamesResponse/);
  assert.match(apiSource, /\.where\('date', '>=', queryFromDate\)/);
  assert.match(apiSource, /\.where\('date', '<=', range\.toDate\)/);
  assert.match(apiSource, /PUBLIC_TEAM_API_MAX_GAME_SCAN_DOCUMENTS/);
  assert.match(apiSource, /\.limit\(currentBatchSize\)/);
  assert.match(apiSource, /\.startAfter\(lastDoc\)/);
  assert.match(apiSource, /isPublicProjectionItemAfterCursor\(projection, cursor\)/);
  assert.match(apiSource, /where\('date', '>=', queryFromDate\)/);
  assert.doesNotMatch(apiSource, /collection\(`teams\/\$\{request\.teamId\}\/games`\)\.get\(\)/);
});

test('public league standings require an explicit season and bounded public team schedule', () => {
  const helperStart = source.indexOf('async function getConfiguredPublicLeagueStandings');
  const handlerEnd = source.indexOf('exports.getPublicTeamCalendarProjection', helperStart);
  const standingsSource = source.slice(helperStart, handlerEnd);

  assert.match(standingsSource, /config\.seasonStart/);
  assert.match(standingsSource, /config\.seasonEnd/);
  assert.match(standingsSource, /config\.leagueTeamIds/);
  assert.match(standingsSource, /configuredTeamIds\.length > 32/);
  assert.match(standingsSource, /getStrictPublicTeam\(leagueTeamId\)/);
  assert.match(standingsSource, /runWithConcurrencyLimit/);
  assert.match(standingsSource, /getPublicTeamGames\(leagueTeamId, range\)/);
  assert.match(standingsSource, /exports\.getPublicLeagueStandingsProjection/);
});

test('public league standings aggregate by team ID, keep season labels display-only, and deduplicate schedules', async () => {
  const teamsById = new Map([
    ['team-a', { id: 'team-a', name: 'United', isPublic: true }],
    ['team-b', { id: 'team-b', name: 'United', isPublic: true }],
    ['team-c', { id: 'team-c', name: 'Owls', isPublic: true }]
  ]);
  const mirroredStart = '2026-08-10T18:00:00.000Z';
  const gamesByTeamId = new Map([
    ['team-a', [
      { id: 'a-v-b', date: mirroredStart, opponent: 'United', opponentTeamId: 'team-b', isHome: true, status: 'completed', homeScore: 3, awayScore: 1 },
      { id: 'same-name-outsider', date: '2026-08-11T18:00:00.000Z', opponent: 'United', opponentTeamId: 'outside-team', status: 'completed', homeScore: 8, awayScore: 0 },
      { id: 'before-season', date: '2026-07-14T23:59:59.999Z', opponent: 'Owls', opponentTeamId: 'team-c', status: 'completed', homeScore: 2, awayScore: 0 }
    ]],
    ['team-b', [
      { id: 'b-v-a', date: mirroredStart, opponent: 'United', opponentTeamId: 'team-a', isHome: false, seasonLabel: 'Different label', status: 'completed', homeScore: 3, awayScore: 1 }
    ]],
    ['team-c', [
      { id: 'c-v-a', date: '2026-11-30T23:59:59.999Z', opponent: 'United', opponentTeamId: 'team-a', isHome: true, status: 'completed', homeScore: 2, awayScore: 2 },
      { id: 'after-season', date: '2026-12-01T00:00:00.000Z', opponent: 'United', opponentTeamId: 'team-a', status: 'completed', homeScore: 1, awayScore: 0 }
    ]]
  ]);
  const { helper, getPublicTeamGames } = loadConfiguredPublicLeagueStandings({ teamsById, gamesByTeamId });

  const result = await helper('team-a', {
    standingsConfig: {
      enabled: true,
      seasonLabel: 'Fall 2026',
      seasonStart: '2026-07-15',
      seasonEnd: '2026-11-30',
      leagueTeamIds: ['team-a', 'team-b', 'team-c']
    }
  });

  assert.equal(result.seasonLabel, 'Fall 2026');
  assert.deepEqual(result.range, { from: '2026-07-15', to: '2026-11-30', truncated: false });
  assert.equal(result.games.length, 2);
  assert.deepEqual(result.games.map((game) => [game.homeTeamId, game.awayTeamId]), [
    ['team-a', 'team-b'],
    ['team-c', 'team-a']
  ]);
  assert.equal(result.games[0].homeTeam, 'United');
  assert.equal(result.games[0].awayTeam, 'United');
  assert.deepEqual(getPublicTeamGames.ranges, ['team-a', 'team-b', 'team-c'].map((teamId) => ({
    teamId,
    from: '2026-07-15',
    to: '2026-11-30',
    limit: 500
  })));
});

test('public league standings deterministically reconcile mismatched mirrored records', async () => {
  const teamsById = new Map([
    ['team-a', { id: 'team-a', name: 'United', isPublic: true }],
    ['team-b', { id: 'team-b', name: 'United', isPublic: true }]
  ]);
  const gamesByTeamId = new Map([
    ['team-a', [
      {
        id: 'score-a',
        sharedScheduleId: 'shared-score-conflict',
        date: '2026-08-10T18:00:00.000Z',
        opponent: 'United',
        opponentTeamId: 'team-b',
        isHome: true,
        status: 'completed',
        homeScore: 3,
        awayScore: 1,
        countsTowardSeasonRecord: true
      },
      {
        id: 'flag-a',
        sharedScheduleId: 'shared-flag-conflict',
        date: '2026-08-20T18:00:00.000Z',
        opponent: 'United',
        opponentTeamId: 'team-b',
        isHome: true,
        status: 'completed',
        homeScore: 2,
        awayScore: 0,
        countsTowardSeasonRecord: true
      }
    ]],
    ['team-b', [
      {
        id: 'score-b',
        sharedScheduleId: 'shared-score-conflict',
        date: '2026-08-10T18:07:00.000Z',
        opponent: 'United',
        opponentTeamId: 'team-a',
        isHome: false,
        status: 'completed',
        homeScore: 4,
        awayScore: 1,
        countsTowardSeasonRecord: true
      },
      {
        id: 'flag-b',
        sharedScheduleId: 'shared-flag-conflict',
        date: '2026-08-20T18:03:00.000Z',
        opponent: 'United',
        opponentTeamId: 'team-a',
        isHome: false,
        status: 'completed',
        homeScore: 2,
        awayScore: 0,
        countsTowardSeasonRecord: false
      }
    ]]
  ]);
  const { helper } = loadConfiguredPublicLeagueStandings({ teamsById, gamesByTeamId });
  const config = {
    enabled: true,
    seasonStart: '2026-07-15',
    seasonEnd: '2026-11-30',
    leagueTeamIds: ['team-b', 'team-a']
  };

  const result = await helper('team-a', { standingsConfig: config });
  const reordered = await helper('team-a', {
    standingsConfig: { ...config, leagueTeamIds: ['team-a', 'team-b'] }
  });

  assert.equal(result.games.length, 2);
  assert.deepEqual(result.games, reordered.games);
  assert.deepEqual(result.games.map((game) => ({
    startsAt: game.startsAt,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    countsTowardSeasonRecord: game.countsTowardSeasonRecord
  })), [
    {
      startsAt: '2026-08-10T18:00:00.000Z',
      homeScore: 3,
      awayScore: 1,
      countsTowardSeasonRecord: false
    },
    {
      startsAt: '2026-08-20T18:00:00.000Z',
      homeScore: 2,
      awayScore: 0,
      countsTowardSeasonRecord: false
    }
  ]);
});

test('public league standings preserve same-day contests and asymmetric schedules', async () => {
  const teamsById = new Map([
    ['team-a', { id: 'team-a', name: 'Bats', isPublic: true }],
    ['team-b', { id: 'team-b', name: 'Owls', isPublic: true }]
  ]);
  const gamesByTeamId = new Map([
    ['team-a', [
      { id: 'a-first', date: '2026-08-10T10:00:00.000Z', opponent: 'Owls', opponentTeamId: 'team-b', isHome: true, status: 'completed', homeScore: 3, awayScore: 1 },
      { id: 'a-second', date: '2026-08-10T16:00:00.000Z', opponent: 'Owls', opponentTeamId: 'team-b', isHome: true, status: 'completed', homeScore: 2, awayScore: 0 },
      { id: 'a-unmirrored', date: '2026-08-10T20:00:00.000Z', opponent: 'Owls', opponentTeamId: 'team-b', isHome: true, status: 'completed', homeScore: 4, awayScore: 2 }
    ]],
    ['team-b', [
      { id: 'b-first', date: '2026-08-10T10:00:00.000Z', opponent: 'Bats', opponentTeamId: 'team-a', isHome: false, status: 'completed', homeScore: 3, awayScore: 1 },
      { id: 'b-second', date: '2026-08-10T16:00:00.000Z', opponent: 'Bats', opponentTeamId: 'team-a', isHome: false, status: 'completed', homeScore: 2, awayScore: 0 },
      { id: 'b-unmirrored', date: '2026-08-10T12:00:00.000Z', opponent: 'Bats', opponentTeamId: 'team-a', isHome: false, status: 'completed', homeScore: 1, awayScore: 5 }
    ]]
  ]);
  const { helper } = loadConfiguredPublicLeagueStandings({ teamsById, gamesByTeamId });

  const result = await helper('team-a', {
    standingsConfig: {
      enabled: true,
      seasonStart: '2026-08-01',
      seasonEnd: '2026-08-31',
      leagueTeamIds: ['team-a', 'team-b']
    }
  });

  assert.equal(result.games.length, 4);
  assert.deepEqual(result.games.map((game) => [game.startsAt, game.homeScore, game.awayScore]), [
    ['2026-08-10T10:00:00.000Z', 3, 1],
    ['2026-08-10T12:00:00.000Z', 1, 5],
    ['2026-08-10T16:00:00.000Z', 2, 0],
    ['2026-08-10T20:00:00.000Z', 4, 2]
  ]);
});

test('public league standings reject private configured teams and truncated schedules', async () => {
  const config = {
    enabled: true,
    seasonStart: '2026-07-15',
    seasonEnd: '2026-11-30',
    leagueTeamIds: ['team-a', 'team-b']
  };
  const publicTeam = { id: 'team-a', name: 'United', isPublic: true };
  const privateConfigured = loadConfiguredPublicLeagueStandings({
    teamsById: new Map([['team-a', publicTeam]]),
    gamesByTeamId: new Map()
  });
  await assert.rejects(
    privateConfigured.helper('team-a', { standingsConfig: config }),
    (error) => error.code === 'failed-precondition' && /every configured league team to be public/.test(error.message)
  );

  const tooManyGames = Array.from({ length: 501 }, (_, index) => ({
    id: `game-${index}`,
    date: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
    opponent: 'United',
    opponentTeamId: 'team-b',
    status: 'completed',
    homeScore: 1,
    awayScore: 0
  }));
  const truncated = loadConfiguredPublicLeagueStandings({
    teamsById: new Map([
      ['team-a', publicTeam],
      ['team-b', { id: 'team-b', name: 'United', isPublic: true }]
    ]),
    gamesByTeamId: new Map([['team-a', tooManyGames], ['team-b', []]])
  });
  await assert.rejects(
    truncated.helper('team-a', { standingsConfig: config }),
    (error) => error.code === 'resource-exhausted' && /schedule limit exceeded/.test(error.message)
  );
});

test('public roster handler bounds its player scan before filtering sensitive documents', () => {
  const start = source.indexOf('async function getPublicTeamPlayers');
  const end = source.indexOf('async function getPublicTeamGames', start);
  const rosterSource = source.slice(start, end);

  assert.match(source, /const PUBLIC_TEAM_API_MAX_ROSTER_SCAN_DOCUMENTS = 1000/);
  assert.match(rosterSource, /\.limit\(PUBLIC_TEAM_API_MAX_ROSTER_SCAN_DOCUMENTS \+ 1\)/);
  assert.match(rosterSource, /playersSnap\.size > PUBLIC_TEAM_API_MAX_ROSTER_SCAN_DOCUMENTS/);
  assert.doesNotMatch(rosterSource, /collection\(`teams\/\$\{teamId\}\/players`\)\.get\(\)/);
  assert.match(source, /const players = await getPublicTeamPlayers\(request\.teamId\)/);
});

test('public team handlers define public cache, CORS, method, and rate-limit behavior', () => {
  assert.match(source, /public, max-age=60, s-maxage=300'/);
  assert.doesNotMatch(source, /stale-while-revalidate/);
  assert.match(source, /Access-Control-Allow-Origin', '\*'/);
  assert.match(source, /Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS'/);
  assert.match(source, /req\.method !== 'GET' && req\.method !== 'HEAD'/);
  assert.match(source, /maxRequests: 120/);
  assert.match(source, /sendPublicTeamApiError\(res, 429, 'rate_limited'/);
});

test('listPublicTeams uses limited indexed ranges for search and preserves bounded browse', () => {
  const start = source.indexOf('exports.listPublicTeams = functions');
  const end = source.indexOf('exports.getPublicTeamGamesProjection', start);
  const handlerSource = source.slice(start, end);

  assert.match(handlerSource, /searchDatastorePublicTeamPage\(loadSearchPage/);
  assert.match(handlerSource, /query = query\.where\(strategy\.stateField, '==', strategy\.state\)/);
  assert.match(handlerSource, /\.where\(strategy\.field, '>=', strategy\.start\)/);
  assert.match(handlerSource, /\.where\(strategy\.field, '<=', strategy\.end\)/);
  assert.match(handlerSource, /\.orderBy\(strategy\.field\)/);
  assert.match(handlerSource, /\.limit\(queryLimit\)\.get\(\)/);
  assert.match(handlerSource, /startAfter\(cursor\.value, cursor\.id\)/);
  assert.match(handlerSource, /scanDatastorePublicTeamPage\(loadBrowsePage/);
  assert.match(handlerSource, /searchText\s*\? searchDatastorePublicTeamPage[\s\S]*:\s*scanDatastorePublicTeamPage/);

  const indexedFields = firestoreIndexes.indexes
    .filter((index) => index.collectionGroup === 'teams' &&
      index.fields?.[0]?.fieldPath === 'isPublic')
    .map((index) => index.fields.slice(1).map((field) => field.fieldPath).join(','));
  assert.deepEqual(new Set(indexedFields), new Set([
    'publicSearchName', 'name',
    'publicSearchCity', 'city',
    'publicSearchState,publicSearchCity', 'state,city',
    'publicSearchState', 'state',
    'publicSearchZip', 'zip'
  ]));
});

test('public roster scan accepts 1,000 documents and safely rejects 1,001', async () => {
  const players = Array.from({ length: 1001 }, (_, index) => (
    makeDoc(`player-${index}`, { name: `Player ${index}` })
  ));
  const atLimit = loadPublicTeamDataAccess(makeFirestore({ players: players.slice(0, 1000) }));
  const overLimit = loadPublicTeamDataAccess(makeFirestore({ players }));

  const result = await atLimit.getPublicTeamPlayers('team-1');
  assert.equal(result.length, 1000);
  assert.equal(result[999].id, 'player-999');
  await assert.rejects(
    overLimit.getPublicTeamPlayers('team-1'),
    /Public roster scan limit exceeded/
  );
});

test('public games scan paginates past filtered documents', async () => {
  const games = [
    ...Array.from({ length: 3 }, (_, index) => (
      makeDoc(`private-${index}`, { date: new Date(`2026-07-0${index + 1}T00:00:00Z`), private: true })
    )),
    ...Array.from({ length: 3 }, (_, index) => (
      makeDoc(`public-${index}`, { date: new Date(`2026-07-1${index + 1}T00:00:00Z`), opponent: `Team ${index}` })
    ))
  ];
  const metrics = {};
  const dataAccess = loadPublicTeamDataAccess(makeFirestore({ games, metrics }));

  const result = await dataAccess.getPublicTeamGames('team-1', {
    fromDate: new Date('2026-07-01T00:00:00Z'),
    toDate: new Date('2026-07-31T23:59:59Z'),
    limit: 2
  });

  assert.deepEqual(result.map((game) => game.id), ['public-0', 'public-1', 'public-2']);
  assert.deepEqual(metrics.gameLimits, [3, 3]);
  assert.deepEqual(metrics.gameStartAfterIds, ['private-2']);
  assert.equal(metrics.gameDocumentsRead, 6);
});

test('public games scan returns below 5,000 documents and fails safely at the cap', async () => {
  const privateGames = Array.from({ length: 5000 }, (_, index) => (
    makeDoc(`private-${index}`, {
      date: new Date(Date.UTC(2026, 0, 1, 0, index)),
      private: true
    })
  ));
  const range = {
    fromDate: new Date('2026-01-01T00:00:00Z'),
    toDate: new Date('2026-12-31T23:59:59Z'),
    limit: 499
  };
  const belowMetrics = {};
  const belowCap = loadPublicTeamDataAccess(makeFirestore({
    games: privateGames.slice(0, 4999),
    metrics: belowMetrics
  }));
  const capMetrics = {};
  const atCap = loadPublicTeamDataAccess(makeFirestore({ games: privateGames, metrics: capMetrics }));

  assert.deepEqual(await belowCap.getPublicTeamGames('team-1', range), []);
  assert.equal(belowMetrics.gameDocumentsRead, 4999);
  await assert.rejects(
    atCap.getPublicTeamGames('team-1', range),
    /Public games scan limit exceeded/
  );
  assert.equal(capMetrics.gameDocumentsRead, 5000);
  assert.deepEqual(capMetrics.gameLimits, Array(10).fill(500));
});

test('public game projections load opponent stat keys from authoritative tracker configs', async () => {
  const dataAccess = loadPublicTeamDataAccess(makeFirestore({
    configs: {
      'config-1': {
        columns: ['PTS', 'CUSTOM_WINS', 'PRIVATE_RATING'],
        statDefinitions: [
          { id: 'custom_wins', scope: 'player', visibility: 'public' },
          { id: 'private_rating', scope: 'player', visibility: 'private' }
        ]
      }
    }
  }));

  const keysByGame = await dataAccess.getPublicOpponentStatKeysByGameId('team-1', [
    { id: 'game-1', statTrackerConfigId: 'config-1' },
    { id: 'game-without-config' }
  ]);

  assert.deepEqual(new Set(keysByGame.get('game-1')), new Set(['pts', 'custom_wins']));
  assert.equal(keysByGame.has('game-without-config'), false);
});
