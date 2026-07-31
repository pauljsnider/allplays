const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decodeCursor,
  matchesPublicTeamSearch,
  paginatePublicTeams
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
