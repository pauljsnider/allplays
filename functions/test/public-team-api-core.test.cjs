const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildPublicGamesResponse,
  buildPublicRosterResponse,
  isStrictPublicTeam,
  normalizeTeamId,
  parsePublicGamesQuery,
  sanitizePublicLocation,
  serializePublicGame
} = require('../public-team-api-core.cjs');

test('strict public teams require an explicit public flag and cannot be inactive', () => {
  assert.equal(isStrictPublicTeam({ isPublic: true, active: true }), true);
  assert.equal(isStrictPublicTeam({ isPublic: true }), true);
  assert.equal(isStrictPublicTeam({ active: true }), false);
  assert.equal(isStrictPublicTeam({ isPublic: false, active: true }), false);
  assert.equal(isStrictPublicTeam({ isPublic: true, active: false }), false);
  assert.equal(isStrictPublicTeam({ isPublic: true, active: true, archived: true }), false);
  for (const status of ['archived', 'inactive', 'disabled', 'ARCHIVED']) {
    assert.equal(isStrictPublicTeam({ isPublic: true, active: true, status }), false);
  }
});

test('roster response includes only active players and returns whitelisted fields in jersey order', () => {
  const response = buildPublicRosterResponse({
    teamId: 'team-1',
    team: {
      name: 'Current',
      sport: 'Soccer',
      photoUrl: 'https://images.example/team.png',
      ownerEmail: 'private@example.com'
    },
    now: new Date('2026-07-26T12:00:00Z'),
    players: [
      { id: 'p12', name: 'Charlotte', number: '12', parentEmails: ['private@example.com'] },
      { id: 'p5', name: 'Blake', number: '5', photoUrl: 'javascript:alert(1)' },
      { id: 'inactive', name: 'Former Player', number: '1', active: false },
      { id: 'archived', name: 'Archived Player', number: '2', status: 'archived' },
      { id: 'p-no-number', name: 'Zoe' }
    ]
  });

  assert.deepEqual(response, {
    version: 1,
    generatedAt: '2026-07-26T12:00:00.000Z',
    team: {
      id: 'team-1',
      name: 'Current',
      sport: 'Soccer',
      photoUrl: 'https://images.example/team.png'
    },
    players: [
      { id: 'p5', name: 'Blake', number: '5', photoUrl: null, position: null },
      { id: 'p12', name: 'Charlotte', number: '12', photoUrl: null, position: null },
      { id: 'p-no-number', name: 'Zoe', number: '', photoUrl: null, position: null }
    ]
  });
  assert.equal(JSON.stringify(response).includes('parentEmails'), false);
  assert.equal(JSON.stringify(response).includes('ownerEmail'), false);
});

test('games omit private/deleted/non-game events and remove imported assignment details', () => {
  const response = buildPublicGamesResponse({
    teamId: 'team-1',
    team: { name: 'Current', sport: 'Soccer' },
    from: '2026-01-01',
    to: '2026-12-31',
    limit: 10,
    now: new Date('2026-07-26T12:00:00Z'),
    games: [
      {
        id: 'later',
        type: 'game',
        date: '2026-08-02T20:00:00Z',
        opponent: 'Tigers',
        location: 'Swope Soccer Village\n(Arrival Time: 2:30 PM)\nAssignments: Snacks - Parent Name',
        isHome: false,
        status: 'completed',
        homeScore: 1,
        awayScore: 3,
        summary: 'A strong finish.',
        notes: 'Private scouting note',
        rsvpSummary: { going: 12 },
        assignments: [{ name: 'Snacks' }]
      },
      {
        id: 'earlier',
        date: '2026-07-31T15:00:00Z',
        opponent: 'test'
      },
      { id: 'practice', type: 'practice', date: '2026-08-01T15:00:00Z' },
      { id: 'private', type: 'game', visibility: 'private', date: '2026-08-01T15:00:00Z' },
      { id: 'deleted', type: 'game', status: 'deleted', date: '2026-08-01T15:00:00Z' }
    ]
  });

  assert.equal(response.games.length, 2);
  assert.equal(response.games[0].id, 'earlier');
  assert.equal(response.games[0].opponent, 'test');
  assert.equal(response.games[1].location, 'Swope Soccer Village');
  assert.equal(response.games[1].teamScore, 3);
  assert.equal(response.games[1].opponentScore, 1);
  assert.equal(response.games[1].result, 'win');
  assert.equal(response.games[1].summary, 'A strong finish.');
  assert.equal(response.range.truncated, false);
  const json = JSON.stringify(response);
  assert.equal(json.includes('Private scouting note'), false);
  assert.equal(json.includes('Parent Name'), false);
  assert.equal(json.includes('rsvpSummary'), false);
});

test('game results require completed status and both scores', () => {
  assert.equal(serializePublicGame({
    id: 'scheduled',
    date: '2026-08-01T15:00:00Z',
    homeScore: 2,
    awayScore: 0
  }).result, null);
  assert.equal(serializePublicGame({
    id: 'tie',
    date: '2026-08-01T15:00:00Z',
    status: 'final',
    homeScore: 2,
    awayScore: 2
  }).result, 'tie');
  assert.equal(serializePublicGame({
    id: 'away-loss',
    date: '2026-08-01T15:00:00Z',
    status: 'completed',
    isHome: false,
    homeScore: 4,
    awayScore: 1
  }).result, 'loss');
});

test('games response reports truncation after public filtering and chronological sorting', () => {
  const response = buildPublicGamesResponse({
    teamId: 'team-1',
    team: { name: 'Current' },
    from: '2026-01-01',
    to: '2026-12-31',
    limit: 1,
    games: [
      { id: 'two', date: '2026-02-01T00:00:00Z' },
      { id: 'private', date: '2026-01-15T00:00:00Z', isPrivate: true },
      { id: 'one', date: '2026-01-01T00:00:00Z' }
    ],
    now: new Date('2026-01-01T00:00:00Z')
  });
  assert.equal(response.range.truncated, true);
  assert.deepEqual(response.games.map((game) => game.id), ['one']);
});

test('query parsing validates dates, range, and limit', () => {
  const valid = parsePublicGamesQuery(
    { from: '2026-01-01', to: '2026-12-31', limit: '500' },
    new Date('2026-07-26T12:00:00Z')
  );
  assert.equal(valid.from, '2026-01-01');
  assert.equal(valid.to, '2026-12-31');
  assert.equal(valid.limit, 500);
  assert.equal(parsePublicGamesQuery({ from: '01/01/2026' }).error.includes('YYYY-MM-DD'), true);
  assert.equal(parsePublicGamesQuery({ from: '2026-02-30' }).error.includes('YYYY-MM-DD'), true);
  assert.equal(parsePublicGamesQuery({ from: '2026-02-01', to: '2026-01-01' }).error.includes('on or after'), true);
  assert.equal(parsePublicGamesQuery({ limit: '501' }).error.includes('1 to 500'), true);
});

test('query parsing uses complete UTC days and calendar years for default bounds', () => {
  const defaults = parsePublicGamesQuery({}, new Date('2026-07-26T12:34:56.789Z'));
  assert.equal(defaults.fromDate.toISOString(), '2025-07-26T00:00:00.000Z');
  assert.equal(defaults.toDate.toISOString(), '2028-07-26T23:59:59.999Z');
  assert.equal(defaults.from, '2025-07-26');
  assert.equal(defaults.to, '2028-07-26');

  const leapDayDefaults = parsePublicGamesQuery({}, new Date('2024-02-29T23:00:00.000Z'));
  assert.equal(leapDayDefaults.fromDate.toISOString(), '2023-02-28T00:00:00.000Z');
  assert.equal(leapDayDefaults.toDate.toISOString(), '2026-02-28T23:59:59.999Z');
});

test('location and team id sanitizers reject unsafe values', () => {
  assert.equal(sanitizePublicLocation('Field 4\nArrival Time: 5:00 PM\nAssignments: snacks'), 'Field 4');
  assert.equal(sanitizePublicLocation('Field 4 (Arrival Time: 5:00 PM) Assignments: snacks'), 'Field 4');
  assert.equal(normalizeTeamId('team_123-ABC'), 'team_123-ABC');
  assert.equal(normalizeTeamId('../team'), '');
});
