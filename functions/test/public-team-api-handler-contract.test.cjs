const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const { join } = require('node:path');
const {
  getPublicOpponentStatKeys,
  normalizeTeamId,
  serializePublicGame
} = require('../public-team-api-core.cjs');

const source = readFileSync(join(__dirname, '..', 'index.js'), 'utf8');

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
    'serializePublicGame',
    implementation
  )(
    firestore,
    getPublicOpponentStatKeys,
    normalizeTeamId,
    serializePublicGame
  );
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
  assert.match(apiSource, /\.where\('date', '>=', range\.fromDate\)/);
  assert.match(apiSource, /\.where\('date', '<=', range\.toDate\)/);
  assert.match(apiSource, /PUBLIC_TEAM_API_MAX_GAME_SCAN_DOCUMENTS/);
  assert.match(apiSource, /\.limit\(currentBatchSize\)/);
  assert.match(apiSource, /\.startAfter\(lastDoc\)/);
  assert.match(apiSource, /if \(serializePublicGame\(game\)\) games\.push\(game\)/);
  assert.doesNotMatch(apiSource, /collection\(`teams\/\$\{request\.teamId\}\/games`\)\.get\(\)/);
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
