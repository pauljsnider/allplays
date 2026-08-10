const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDatastorePublicTeamPage,
  buildPublicTeamSearchStrategies,
  decodeCursor,
  decodeDatastoreCursor,
  decodeSearchCursor,
  matchesPublicTeamSearch,
  paginatePublicTeams,
  searchDatastorePublicTeamPage,
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

function makeIndexedSearchLoader(teams, calls) {
  return async ({ strategy, cursor, limit }) => {
    calls.push({ field: strategy.field, cursor, limit });
    const matches = teams
      .filter((team) => String(team[strategy.field] || '') >= strategy.start &&
        String(team[strategy.field] || '') <= strategy.end)
      .sort((left, right) => {
        const fieldResult = String(left[strategy.field]).localeCompare(String(right[strategy.field]));
        return fieldResult || left.id.localeCompare(right.id);
      });
    const start = cursor
      ? matches.findIndex((team) => team.id === cursor.id) + 1
      : 0;
    return {
      records: matches.slice(start, start + limit).map((team) => ({
        id: team.id,
        value: String(team[strategy.field]),
        data: team,
        item: { id: team.id, name: team.name, city: team.city, state: team.state, zip: team.zip }
      }))
    };
  };
}

test('indexed search uses fixed query and read budgets for a large zero-match catalog', async () => {
  const teams = Array.from({ length: 5000 }, (_, index) => ({
    id: `team-${index}`,
    name: `Team ${index}`,
    publicSearchName: `team ${index}`,
    city: 'Austin',
    publicSearchCity: 'austin',
    state: 'TX',
    publicSearchState: 'TX'
  }));
  const calls = [];
  const page = await searchDatastorePublicTeamPage(makeIndexedSearchLoader(teams, calls), {
    searchText: 'needle',
    pageSize: 24
  });

  assert.deepEqual(page.items, []);
  assert.equal(page.nextCursor, null);
  assert.equal(calls.length, 4);
  assert.equal(calls.reduce((sum, call) => sum + call.limit, 0), 24);
  assert.deepEqual(calls.map((call) => call.field), [
    'publicSearchName', 'name', 'publicSearchCity', 'city'
  ]);
});

test('indexed search builds bounded name, city/state, state, and ZIP strategies', () => {
  assert.deepEqual(buildPublicTeamSearchStrategies('Fal'), [
    { field: 'publicSearchName', start: 'fal', end: 'fal\uf8ff' },
    { field: 'name', start: 'Fal', end: 'Fal\uf8ff' },
    { field: 'publicSearchCity', start: 'fal', end: 'fal\uf8ff', state: '' },
    { field: 'city', start: 'Fal', end: 'Fal\uf8ff', state: '' }
  ]);
  assert.deepEqual(buildPublicTeamSearchStrategies('Austin, tx').slice(2), [
    { field: 'publicSearchCity', start: 'austin', end: 'austin\uf8ff', state: 'TX' },
    { field: 'city', start: 'Austin', end: 'Austin\uf8ff', state: 'TX' }
  ]);
  assert.deepEqual(buildPublicTeamSearchStrategies('tx').slice(2).map(({ field }) => field), [
    'publicSearchState', 'state'
  ]);
  assert.deepEqual(buildPublicTeamSearchStrategies('787').slice(2).map(({ field }) => field), [
    'publicSearchZip', 'zip'
  ]);
});

test('indexed city/state, state, and ZIP searches return matches with advancing cursors', async () => {
  const cases = [
    {
      searchText: 'Austin, tx',
      expectedField: 'publicSearchCity',
      team: {
        id: 'city-state', name: 'Bears', publicSearchName: 'bears',
        city: 'Austin', publicSearchCity: 'austin', state: 'TX', publicSearchState: 'TX'
      }
    },
    {
      searchText: 'tx',
      expectedField: 'publicSearchState',
      team: {
        id: 'state', name: 'Bears', publicSearchName: 'bears',
        state: 'TX', publicSearchState: 'TX'
      }
    },
    {
      searchText: '787',
      expectedField: 'publicSearchZip',
      team: {
        id: 'zip', name: 'Bears', publicSearchName: 'bears',
        zip: '78701', publicSearchZip: '78701'
      }
    }
  ];

  for (const searchCase of cases) {
    const calls = [];
    const page = await searchDatastorePublicTeamPage(
      makeIndexedSearchLoader([searchCase.team], calls),
      { searchText: searchCase.searchText, pageSize: 4 }
    );
    assert.deepEqual(page.items.map((team) => team.id), [searchCase.team.id]);
    assert.equal(calls.some((call) => call.field === searchCase.expectedField), true);
    const decoded = decodeSearchCursor(page.nextCursor, searchCase.searchText, 4);
    assert.equal(decoded.strategyCursors.every((cursor) => cursor?.done || cursor?.id), true);
  }
});

test('indexed search deduplicates strategies and advances every strategy cursor', async () => {
  const teams = [
    {
      id: 'alpha-1', name: 'Alpha Austin', publicSearchName: 'alpha austin',
      city: 'Alpha', publicSearchCity: 'alpha', state: 'TX', publicSearchState: 'TX'
    },
    {
      id: 'alpha-2', name: 'Alpha Bears', publicSearchName: 'alpha bears',
      city: 'Dallas', publicSearchCity: 'dallas', state: 'TX', publicSearchState: 'TX'
    },
    {
      id: 'city-1', name: 'Bears', publicSearchName: 'bears',
      city: 'Alpha', publicSearchCity: 'alpha', state: 'TX', publicSearchState: 'TX'
    },
    {
      id: 'legacy-city', name: 'Cougars',
      city: 'Alpha', state: 'TX'
    }
  ];
  const firstCalls = [];
  const first = await searchDatastorePublicTeamPage(makeIndexedSearchLoader(teams, firstCalls), {
    searchText: 'alpha',
    pageSize: 4
  });

  assert.deepEqual(first.items.map((team) => team.id), ['alpha-1']);
  assert.equal(new Set(first.items.map((team) => team.id)).size, first.items.length);
  assert.equal(typeof first.nextCursor, 'string');
  const decoded = decodeSearchCursor(first.nextCursor, 'alpha', 4);
  assert.equal(decoded.strategyCursors.every((cursor) => cursor?.done || cursor?.id), true);
  assert.equal(firstCalls.reduce((sum, call) => sum + call.limit, 0), 4);

  const secondCalls = [];
  const second = await searchDatastorePublicTeamPage(makeIndexedSearchLoader(teams, secondCalls), {
    searchText: 'alpha',
    pageSize: 4,
    cursor: first.nextCursor
  });
  assert.deepEqual(second.items.map((team) => team.id).sort(), ['alpha-2', 'city-1']);
  assert.equal(typeof second.nextCursor, 'string');
  assert.equal(secondCalls.every((call) => call.cursor?.id), true);

  const third = await searchDatastorePublicTeamPage(makeIndexedSearchLoader(teams, []), {
    searchText: 'alpha',
    pageSize: 4,
    cursor: second.nextCursor
  });
  assert.deepEqual(third.items.map((team) => team.id), ['legacy-city']);
  const fourth = await searchDatastorePublicTeamPage(makeIndexedSearchLoader(teams, []), {
    searchText: 'alpha',
    pageSize: 4,
    cursor: third.nextCursor
  });
  assert.deepEqual(fourth.items, []);
  assert.equal(fourth.nextCursor, null);
  const allItems = [...first.items, ...second.items, ...third.items];
  assert.equal(new Set(allItems.map((team) => team.id)).size, 4);
});
