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

test('public team handlers define public cache, CORS, method, and rate-limit behavior', () => {
  assert.match(source, /public, max-age=60, s-maxage=300, stale-while-revalidate=86400/);
  assert.match(source, /Access-Control-Allow-Origin', '\*'/);
  assert.match(source, /Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS'/);
  assert.match(source, /req\.method !== 'GET' && req\.method !== 'HEAD'/);
  assert.match(source, /maxRequests: 120/);
  assert.match(source, /sendPublicTeamApiError\(res, 429, 'rate_limited'/);
});
