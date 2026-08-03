const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildPublicGamesResponse,
  buildPublicRosterResponse,
  canProjectPublicGame,
  getPublicOpponentStatKeys,
  isStrictPublicTeam,
  normalizeTeamId,
  parsePublicProjectionCursor,
  parsePublicGamesQuery,
  publicHttpUrl,
  scanBoundedPublicCalendarTrackingEvents,
  sanitizePublicLocation,
  serializePublicCalendarEvent,
  serializePublicGame,
  serializePublicOpponentStats,
  serializePublicTeamProfile
} = require('../public-team-api-core.cjs');
const { isFamilyShareCalendarEventTracked } = require('../family-share-view-core.cjs');

test('paginates calendar tracking scans and fails closed at the document cap', async () => {
  const pages = [
    { documents: [{ date: 'ordinary-1' }, { date: 'ordinary-2' }], nextCursor: 'page-2' },
    { documents: [{ calendarEventUid: 'tracked-later', date: 'game-date' }], nextCursor: null }
  ];
  const tracked = await scanBoundedPublicCalendarTrackingEvents(
    async () => pages.shift(),
    { maxDocuments: 4, pageSize: 2 }
  );
  assert.deepEqual(tracked, [{ calendarEventUid: 'tracked-later', date: 'game-date' }]);

  await assert.rejects(
    scanBoundedPublicCalendarTrackingEvents(
      async ({ after }) => ({ documents: [{ calendarEventUid: `tracked-${after || 1}` }], nextCursor: 'next' }),
      { maxDocuments: 2, pageSize: 1 }
    ),
    /tracking scan limit exceeded/
  );
});

test('keeps a moved tracked occurrence available to suppress its original in-range calendar event', async () => {
  const originalStartsAt = '2026-08-03T18:00:00.000Z';
  const movedStartsAt = '2026-08-10T18:00:00.000Z';
  const feedRange = {
    from: new Date('2026-08-03T00:00:00.000Z'),
    to: new Date('2026-08-03T23:59:59.999Z')
  };
  assert.equal(new Date(originalStartsAt) >= feedRange.from && new Date(originalStartsAt) <= feedRange.to, true);
  assert.equal(new Date(movedStartsAt) > feedRange.to, true);

  const trackedEvents = await scanBoundedPublicCalendarTrackingEvents(
    async () => ({
      documents: [{
        calendarEventUid: `opaque-projected-id__${originalStartsAt}`,
        date: movedStartsAt
      }],
      nextCursor: null
    }),
    { maxDocuments: 2, pageSize: 2 }
  );

  assert.equal(isFamilyShareCalendarEventTracked({
    id: 'opaque-projected-id',
    startsAt: originalStartsAt
  }, trackedEvents), true);
});

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

test('public team profile preserves public page features through a bounded allowlist', () => {
  const profile = serializePublicTeamProfile('team-public', {
    name: 'Current',
    sport: 'Soccer',
    description: 'Public team description',
    isPublic: true,
    active: true,
    leagueUrl: 'https://league.example.test/standings',
    twitchChannel: 'allplays_live',
    streamEmbedUrl: 'https://www.youtube.com/embed/abcdefghijk',
    calendarUrls: [
      'https://calendar.example.test/team.ics?token=public-feed',
      'javascript:alert(1)',
      'https://user:password@example.test/private.ics'
    ],
    standingsConfig: {
      enabled: true,
      rankingMode: 'points',
      points: { win: 3, tie: 1, loss: 0, privateNote: 'secret' },
      maxGoalDiff: 7,
      tiebreakers: ['head_to_head', 'point_diff'],
      adminEmail: 'private@example.test'
    },
    tournament: {
      divisions: [{ divisionName: '10U Gold', adminEmail: 'private@example.test' }],
      pools: [{ poolName: 'Pool A', contactPhone: '555-0100' }],
      privateNotes: 'secret'
    },
    tournamentPoolOverrides: {
      'group-public': {
        groupKey: '["10U Gold","Pool A"]',
        poolName: '10U Gold • Pool A',
        teamOrder: ['Current', 'Lions'],
        finalizedBy: { name: 'Private Admin', email: 'private@example.test' },
        finalizedAt: '2026-07-26T12:00:00Z'
      }
    },
    ownerId: 'private-owner',
    ownerEmail: 'private@example.test',
    adminEmails: ['private@example.test'],
    teamPermissions: { chat: { enabled: true } },
    availabilityPreferences: { noteVisibility: 'team' },
    registrationSource: { externalTeamId: 'private-registration-id' }
  });

  assert.deepEqual(profile, {
    id: 'team-public',
    name: 'Current',
    sport: 'Soccer',
    photoUrl: null,
    city: null,
    state: null,
    zip: null,
    description: 'Public team description',
    appAccess: false,
    webAccess: true,
    isPublic: true,
    active: true,
    leagueUrl: 'https://league.example.test/standings',
    twitchChannel: 'allplays_live',
    streamEmbedUrl: 'https://www.youtube.com/embed/abcdefghijk',
    youtubeEmbedUrl: null,
    hasCalendarSources: true,
    standingsConfig: {
      enabled: true,
      rankingMode: 'points',
      points: { win: 3, tie: 1, loss: 0 },
      maxGoalDiff: 7,
      tiebreakers: ['head_to_head', 'point_diff'],
      twoTeamTiebreakers: [],
      multiTeamTiebreakers: []
    },
    tournament: {
      divisions: [{ divisionName: '10U Gold' }],
      pools: [{ poolName: 'Pool A' }]
    },
    tournamentDivisions: [],
    tournamentPools: [],
    tournamentPoolOverrides: {
      'group-public': {
        groupKey: '["10U Gold","Pool A"]',
        poolName: '10U Gold • Pool A',
        teamOrder: ['Current', 'Lions']
      }
    }
  });
  const serialized = JSON.stringify(profile);
  for (const privateMarker of [
    'ownerId',
    'ownerEmail',
    'adminEmails',
    'teamPermissions',
    'availabilityPreferences',
    'registrationSource',
    'finalizedBy',
    'finalizedAt',
    'private@example.test',
    'private-registration-id',
    'token=public-feed'
  ]) {
    assert.equal(serialized.includes(privateMarker), false);
  }
});

test('public calendar projection hides feed credentials and keeps only event presentation fields', () => {
  const event = serializePublicCalendarEvent({
    id: 'opaque-event',
    type: 'game',
    date: '2026-08-01T18:00:00.000Z',
    endDate: '2026-08-01T20:00:00.000Z',
    opponent: 'Falcons',
    location: 'Public Field',
    status: 'CONFIRMED',
    calendarUidHash: 'SENTINEL_CALENDAR_UID_HASH',
    sourceUrl: 'https://calendar.example.test/team.ics?token=secret',
    description: 'Private calendar notes',
    childNames: ['Private Child']
  });

  assert.deepEqual(event, {
    id: 'opaque-event',
    type: 'game',
    startsAt: '2026-08-01T18:00:00.000Z',
    endsAt: '2026-08-01T20:00:00.000Z',
    title: null,
    opponent: 'Falcons',
    location: 'Public Field',
    status: 'confirmed'
  });
  const serialized = JSON.stringify(event);
  assert.equal(serialized.includes('token=secret'), false);
  assert.equal(serialized.includes('SENTINEL_CALENDAR_UID_HASH'), false);
  assert.equal(serialized.includes('calendarUidHash'), false);
  assert.equal(serialized.includes('Private calendar notes'), false);
  assert.equal(serialized.includes('Private Child'), false);
});

test('public team profile rejects inactive teams and credential-bearing URLs', () => {
  assert.equal(serializePublicTeamProfile('team-private', { isPublic: false }), null);
  assert.equal(serializePublicTeamProfile('team-inactive', { isPublic: true, active: false }), null);
  assert.equal(publicHttpUrl('https://user:password@example.test/private.ics'), null);
  assert.equal(publicHttpUrl('javascript:alert(1)'), null);
});

test('game projections preserve individually shareable reports without exposing ordinary private-team games', () => {
  const privateTeam = { isPublic: false, active: true };
  const inactiveTeam = { isPublic: true, active: false };
  const publicTeam = { isPublic: true, active: true };
  const ordinaryGame = {
    type: 'game',
    date: '2026-08-02T20:00:00Z',
    opponent: 'Tigers'
  };

  assert.equal(canProjectPublicGame(publicTeam, ordinaryGame), true);
  assert.equal(canProjectPublicGame(privateTeam, ordinaryGame), false);
  assert.equal(canProjectPublicGame(inactiveTeam, ordinaryGame), false);
  for (const publicMarker of [
    { visibility: 'public' },
    { isPublic: true },
    { public: true },
    { shareable: true },
    { isShareable: true },
    { publicCalendar: true }
  ]) {
    assert.equal(canProjectPublicGame(privateTeam, { ...ordinaryGame, ...publicMarker }), true);
    assert.equal(canProjectPublicGame(inactiveTeam, { ...ordinaryGame, ...publicMarker }), true);
  }
  assert.equal(canProjectPublicGame(publicTeam, { ...ordinaryGame, visibility: 'private', shareable: true }), false);
  assert.equal(canProjectPublicGame(publicTeam, { ...ordinaryGame, notes: 'private coach note' }), true);
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
      photoUrl: 'https://images.example/team.png',
      city: null,
      state: null,
      zip: null
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
        tournament: {
          divisionName: '10U Gold',
          poolName: 'Pool A',
          privateBracketNotes: 'Private bracket note'
        },
        opponentStats: {
          opponent1: {
            name: 'Opponent One',
            number: '9',
            photoUrl: 'https://images.example/opponent.png',
            points: 3,
            birthDate: 20080101,
            age: 17,
            weight: 145,
            studentId: 987654321,
            notes: 'Private player note',
            parent_email: 'private@example.com'
          }
        },
        teamName: 'Current',
        sport: 'Soccer',
        teamPhotoUrl: 'https://images.example/team.png',
        opponentTeamPhoto: 'https://images.example/opponent-team.png',
        statSheetPhotoUrl: 'https://images.example/stat-sheet.png',
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
  assert.deepEqual(response.games[1].tournament, {
    divisionName: '10U Gold',
    poolName: 'Pool A'
  });
  assert.deepEqual(response.games[1].opponentStats, {
    opponent1: {
      name: 'Opponent One',
      number: '9',
      photoUrl: 'https://images.example/opponent.png',
      points: 3
    }
  });
  assert.equal(response.games[1].teamName, 'Current');
  assert.equal(response.games[1].sport, 'Soccer');
  assert.equal(response.games[1].teamPhotoUrl, 'https://images.example/team.png');
  assert.equal(response.games[1].opponentTeamPhoto, 'https://images.example/opponent-team.png');
  assert.equal(response.games[1].statSheetPhotoUrl, 'https://images.example/stat-sheet.png');
  assert.equal(response.range.truncated, false);
  const json = JSON.stringify(response);
  assert.equal(json.includes('Private scouting note'), false);
  assert.equal(json.includes('Private bracket note'), false);
  assert.equal(json.includes('Private player note'), false);
  assert.equal(json.includes('private@example.com'), false);
  assert.equal(json.includes('20080101'), false);
  assert.equal(json.includes('987654321'), false);
  assert.equal(json.includes('"age"'), false);
  assert.equal(json.includes('"weight"'), false);
  assert.equal(json.includes('Parent Name'), false);
  assert.equal(json.includes('rsvpSummary'), false);
});

test('opponent stats allow explicitly public custom definitions and reject private definitions', () => {
  const keys = getPublicOpponentStatKeys({
    columns: ['PTS', 'CUSTOM_WINS', 'PRIVATE_RATING'],
    statDefinitions: [
      { id: 'custom_wins', scope: 'player', visibility: 'public' },
      { id: 'private_rating', scope: 'player', visibility: 'private' },
      { id: 'team_budget', scope: 'team', visibility: 'public' },
      { id: 'efficiency', scope: 'player', visibility: 'public', formula: 'PTS/FGA' }
    ]
  });
  const stats = serializePublicOpponentStats({
    opponent1: {
      name: 'Opponent One',
      pts: 12,
      custom_wins: 4,
      private_rating: 99,
      team_budget: 5000,
      efficiency: 1.5,
      studentId: 123456
    }
  }, keys);

  assert.deepEqual(stats, {
    opponent1: { name: 'Opponent One', pts: 12, custom_wins: 4 }
  });
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

test('shared game projections retain their encoded document path identity', () => {
  const sharedId = `shared_${encodeURIComponent(`tournaments/${'t'.repeat(90)}/sharedGames/${'g'.repeat(90)}`)}`;
  const game = serializePublicGame({
    id: sharedId,
    isSharedGame: true,
    type: 'game',
    date: '2026-08-02T20:00:00Z'
  });

  assert.equal(sharedId.length > 128, true);
  assert.equal(game.id, sharedId);
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

test('games response provides a cursor that returns all 501 chronological projections without duplication', () => {
  const games = Array.from({ length: 501 }, (_, index) => ({
    id: `game-${String(index).padStart(3, '0')}`,
    date: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
  }));
  const firstPage = buildPublicGamesResponse({ teamId: 'team-1', games, limit: 500 });
  const cursor = parsePublicProjectionCursor(firstPage.nextCursor);
  const secondPage = buildPublicGamesResponse({ teamId: 'team-1', games, limit: 500, cursor });
  assert.equal(firstPage.range.truncated, true);
  assert.equal(typeof firstPage.nextCursor, 'string');
  assert.equal(secondPage.range.truncated, false);
  assert.equal(secondPage.nextCursor, null);
  assert.deepEqual([...firstPage.games, ...secondPage.games].map((game) => game.id), games.map((game) => game.id));
  assert.match(parsePublicProjectionCursor('not-a-cursor').error, /valid public projection cursor/);
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
  assert.equal(sanitizePublicLocation('Field 4 (Assignments: Snacks - Parent Name)'), 'Field 4');
  assert.equal(sanitizePublicLocation('(Assignment: Parent Name)'), '');
  assert.equal(normalizeTeamId('team_123-ABC'), 'team_123-ABC');
  assert.equal(normalizeTeamId('../team'), '');
});
