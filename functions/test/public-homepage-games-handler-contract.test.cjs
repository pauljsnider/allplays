const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const source = readFileSync(join(__dirname, '..', 'index.js'), 'utf8');

test('exports a bounded and cached public homepage games handler', () => {
  const start = source.indexOf('function beginPublicHomepageGamesRequest');
  const end = source.indexOf('exports.publicTeamRosterV1', start);
  const handler = source.slice(start, end);

  assert.match(handler, /exports\.publicHomepageGamesV1 = functions/);
  assert.match(handler, /collectionGroup\(collectionName\)/);
  assert.match(handler, /PUBLIC_HOMEPAGE_MAX_CANDIDATES_PER_QUERY \+ 1/);
  assert.match(handler, /buildPublicHomepageCandidateBatch\(snapshot\.docs\)/);
  assert.match(handler, /Truncating a public homepage candidate query at the scan limit/);
  assert.doesNotMatch(handler, /candidate scan limit exceeded/);
  assert.match(handler, /getStrictPublicTeam\(teamId\)/);
  assert.match(handler, /buildPublicHomepageTeamIdBatch\(\[/);
  assert.match(handler, /PUBLIC_HOMEPAGE_MAX_UNIQUE_TEAM_LOOKUPS/);
  assert.match(handler, /teamLookupBudget/);
  assert.match(handler, /serializePublicHomepageCandidates\(\{/);
  assert.match(handler, /serializedResults\[index\]\.partial/);
  assert.match(handler, /buildPublicHomepageGamesResponse/);
  assert.match(handler, /partialCategories/);
  assert.match(handler, /sendPublicTeamApiSuccess/);
  assert.match(handler, /checkPublicTeamApiRateLimit/);
});

test('homepage endpoint fails closed for unsupported methods and query failures', () => {
  const start = source.indexOf('function beginPublicHomepageGamesRequest');
  const end = source.indexOf('exports.publicTeamRosterV1', start);
  const handler = source.slice(start, end);

  assert.match(handler, /method_not_allowed/);
  assert.match(handler, /rate_limited/);
  assert.match(handler, /sendPublicTeamApiError\(res, 500, 'unavailable'/);
  assert.doesNotMatch(handler, /res\.status\(200\).*error/s);
});
