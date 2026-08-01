const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDatastorePublicTeamPage,
  decodeCursor,
  decodeDatastoreCursor,
  matchesPublicTeamSearch,
  paginatePublicTeams,
  scanDatastorePublicTeamPage
} = require('../public-team-discovery-core.cjs');

test('public team discovery matches public allowlisted location fields', () => {
  const team = { id: 'team-1', name: 'Falcons', city: 'Austin', state: 'TX', zip: '78701' };
  assert.equal(matchesPublicTeamSearch(team, 'austin tx'), true);
  assert.equal(matchesPublicTeamSearch(team, '787'), true);
  assert.equal(matchesPublicTeamSearch(team, 'owner@example.com'), false);
});

test('public team discovery returns stable opaque cursor pages', () => {
  const teams = [
    { id: 'team-3', name: 'Zebras', city: 'Austin' },
    { id: 'team-1', name: 'Falcons', city: 'Austin' },
    { id: 'team-2', name: 'Rockets', city: 'Austin' }
  ];
  const first = paginatePublicTeams(teams, { searchText: 'Austin', pageSize: 2 });
  assert.deepEqual(first.items.map((team) => team.id), ['team-1', 'team-2']);
  assert.equal(typeof first.nextCursor, 'string');
  assert.equal(decodeCursor(first.nextCursor, 'different search'), null);

  const second = paginatePublicTeams(teams, {
    searchText: 'Austin',
    pageSize: 2,
    cursor: first.nextCursor
  });
  assert.deepEqual(second.items.map((team) => team.id), ['team-3']);
  assert.equal(second.nextCursor, null);
});

function collectPublicTeamPages(teams, pageSize = 1) {
  const ids = [];
  let cursor = null;
  do {
    const page = paginatePublicTeams(teams, { pageSize, cursor });
    ids.push(...page.items.map((team) => team.id));
    cursor = page.nextCursor;
  } while (cursor);
  return ids;
}

test('public team discovery advances numeric names with the sorting comparator', () => {
  const teams = [
    { id: 'team-10', name: 'Team 10' },
    { id: 'team-2', name: 'Team 2' }
  ];

  assert.deepEqual(collectPublicTeamPages(teams), ['team-2', 'team-10']);
});

test('public team discovery advances case-equivalent names by id', () => {
  const teams = [
    { id: 'team-b', name: 'falcons' },
    { id: 'team-a', name: 'Falcons' }
  ];

  assert.deepEqual(collectPublicTeamPages(teams), ['team-a', 'team-b']);
});

test('public team discovery advances accent-equivalent names by id', () => {
  const teams = [
    { id: 'team-b', name: 'Aguilas' },
    { id: 'team-a', name: 'Águilas' }
  ];

  assert.deepEqual(collectPublicTeamPages(teams), ['team-a', 'team-b']);
});

test('public team discovery remains available beyond the per-request scan boundary', () => {
  const records = Array.from({ length: 201 }, (_, index) => ({
    id: `team-${String(index).padStart(4, '0')}`,
    item: { id: `team-${String(index).padStart(4, '0')}`, name: `Team ${index}` }
  }));
  const first = buildDatastorePublicTeamPage(records, {
    searchText: 'not-present',
    pageSize: 24,
    hasMore: true
  });

  assert.deepEqual(first.items, []);
  assert.equal(decodeDatastoreCursor(first.nextCursor, 'not-present').i, 'team-0199');

  const second = buildDatastorePublicTeamPage(records.slice(200), {
    searchText: '',
    pageSize: 24,
    hasMore: false
  });
  assert.deepEqual(second.items.map((team) => team.id), ['team-0200']);
  assert.equal(second.nextCursor, null);
});

test('server discovery fills a search page across empty datastore scan batches', async () => {
  const records = Array.from({ length: 402 }, (_, index) => ({
    id: `team-${String(index).padStart(4, '0')}`,
    item: {
      id: `team-${String(index).padStart(4, '0')}`,
      name: index >= 400 ? `Needle ${index}` : `Team ${index}`
    }
  }));
  const calls = [];
  const page = await scanDatastorePublicTeamPage(async ({ afterId, limit }) => {
    calls.push({ afterId, limit });
    const start = afterId ? records.findIndex((record) => record.id === afterId) + 1 : 0;
    const batch = records.slice(start, start + limit);
    return { records: batch, hasMore: batch.length === limit };
  }, {
    searchText: 'needle',
    pageSize: 2
  });

  assert.deepEqual(page.items.map((team) => team.id), ['team-0400', 'team-0401']);
  assert.equal(page.nextCursor, null);
  assert.deepEqual(calls, [
    { afterId: '', limit: 201 },
    { afterId: 'team-0199', limit: 201 },
    { afterId: 'team-0399', limit: 201 }
  ]);
});
