const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const { join } = require('node:path');

const source = readFileSync(join(__dirname, '..', 'index.js'), 'utf8');

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
