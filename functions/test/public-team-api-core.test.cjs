const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildPublicGamesResponse,
  buildPublicRosterResponse,
  canTrackedCalendarEventSuppressPublicProjection,
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

function canonicalReplay(videoId = 'PK1HyC37doc') {
  return {
    provider: 'youtube',
    videoId,
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
    publicUrl: `https://www.youtube.com/watch?v=${videoId}`,
    status: 'ready'
  };
}

test('paginates more than 500 tracked calendar documents with a stable cursor', async () => {
  const trackedDocuments = Array.from({ length: 501 }, (_, index) => ({
    calendarEventUid: `tracked-${String(index).padStart(3, '0')}`,
    date: `game-date-${index}`
  }));
  const cursors = [];
  const tracked = await scanBoundedPublicCalendarTrackingEvents(
    async ({ after, limit }) => {
      cursors.push(after);
      const start = after === null ? 0 : Number(after) + 1;
      const documents = trackedDocuments.slice(start, start + limit);
      return {
        documents,
        nextCursor: documents.length ? String(start + documents.length - 1) : null
      };
    },
    { maxDocuments: 5000, pageSize: 500 }
  );

  assert.equal(tracked.length, 501);
  assert.deepEqual(cursors, [null, '499']);
  assert.equal(tracked[500].calendarEventUid, 'tracked-500');
});

test('fails closed after scanning the 5,000 tracked-document safety cap', async () => {
  let calls = 0;
  await assert.rejects(
    scanBoundedPublicCalendarTrackingEvents(
      async ({ limit }) => {
        calls += 1;
        return {
          documents: Array.from({ length: limit }, (_, index) => ({
            calendarEventUid: `tracked-${calls}-${index}`
          })),
          nextCursor: `page-${calls}`
        };
      },
      { maxDocuments: 5000, pageSize: 500 }
    ),
    /tracking scan limit exceeded/
  );
  assert.equal(calls, 10);
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

test('only tracked events represented by public games suppress calendar projections', () => {
  assert.equal(canTrackedCalendarEventSuppressPublicProjection({ type: 'game' }), true);
  assert.equal(canTrackedCalendarEventSuppressPublicProjection({}), true);
  assert.equal(canTrackedCalendarEventSuppressPublicProjection({ type: 'PRACTICE' }), false);
  assert.equal(canTrackedCalendarEventSuppressPublicProjection({ type: 'game', visibility: 'PRIVATE' }), false);
  assert.equal(canTrackedCalendarEventSuppressPublicProjection({ type: 'game', isPrivate: true }), false);
  assert.equal(canTrackedCalendarEventSuppressPublicProjection({ type: 'game', private: true }), false);
  assert.equal(canTrackedCalendarEventSuppressPublicProjection({ type: 'game', deleted: true }), false);
  assert.equal(canTrackedCalendarEventSuppressPublicProjection({ type: 'game', isDeleted: true }), false);
  assert.equal(canTrackedCalendarEventSuppressPublicProjection({ type: 'game', status: 'DELETED' }), false);
  assert.equal(canTrackedCalendarEventSuppressPublicProjection({ type: 'game', liveStatus: 'deleted' }), false);
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
    teamPassConfig: { recordedReplayPaywallEnabled: true, privatePlan: 'gold' },
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
    recordedReplayPaywallEnabled: true,
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
    'teamPassConfig',
    'privatePlan',
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
    eventKey: 'SENTINEL_INTERNAL_EVENT_KEY',
    legacyOpaqueId: 'SENTINEL_LEGACY_OPAQUE_ID',
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
  assert.equal(serialized.includes('SENTINEL_INTERNAL_EVENT_KEY'), false);
  assert.equal(serialized.includes('eventKey'), false);
  assert.equal(serialized.includes('SENTINEL_LEGACY_OPAQUE_ID'), false);
  assert.equal(serialized.includes('legacyOpaqueId'), false);
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

test('public game projection exposes only a canonical replay for a consistent final lifecycle', () => {
  const withPublicReplay = serializePublicGame({
    id: 'public-replay',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    status: 'completed',
    liveStatus: 'final',
    replayVideo: {
      ...canonicalReplay(),
      url: 'https://private.example.test/replay.mp4?token=private-capability',
    }
  });
  assert.equal(withPublicReplay.videoUrl, 'https://www.youtube.com/watch?v=PK1HyC37doc');
  assert.equal(JSON.stringify(withPublicReplay).includes('private-capability'), false);

  const statsheetReplay = serializePublicGame({
    id: 'statsheet-replay',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    status: 'completed',
    liveStatus: 'scheduled',
    replayVideo: canonicalReplay()
  });
  assert.equal(statsheetReplay.videoUrl, 'https://www.youtube.com/watch?v=PK1HyC37doc');
  assert.equal(statsheetReplay.liveStatus, 'scheduled');

  const withoutPublicReplay = serializePublicGame({
    id: 'private-replay',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    status: 'completed',
    replayVideo: {
      url: 'https://private.example.test/replay.mp4?token=private-capability'
    }
  });
  assert.equal(withoutPublicReplay.videoUrl, null);
  assert.equal(JSON.stringify(withoutPublicReplay).includes('private-capability'), false);

  for (const lifecycle of [
    { status: 'scheduled' },
    { status: 'cancelled' },
    { status: 'completed', liveStatus: 'live' },
    { status: 'completed', liveStatus: 'cancelled' },
    { status: 'scheduled', liveStatus: 'completed' },
    { status: 'completed', liveStatus: {} },
    { status: [], liveStatus: 'completed' },
    { status: 'completed', liveStatus: [] },
    { status: 'completed', liveStatus: true },
    { status: 1, liveStatus: 'completed' }
  ]) {
    assert.equal(serializePublicGame({
      id: 'unsafe-lifecycle',
      type: 'game',
      date: '2026-08-01T15:00:00Z',
      replayVideo: canonicalReplay(),
      ...lifecycle
    }).videoUrl, null);
  }
});

test('public game projection preserves ordered live lifecycle state for downstream viewers', () => {
  const project = (lifecycle) => serializePublicGame({
    id: 'lifecycle-projection',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    replayVideo: canonicalReplay(),
    ...lifecycle
  });

  assert.deepEqual(
    [
      project({ status: 'completed', liveStatus: 'scheduled' }),
      project({ status: 'scheduled', liveStatus: 'completed' }),
      project({ status: 'completed', liveStatus: 'live' }),
      project({ status: 'completed', liveStatus: 'cancelled' }),
      project({ status: 'scheduled', liveStatus: 'live' })
    ].map(({ status, sourceStatus, liveStatus, videoLifecycle, videoUrl }) => ({
      status,
      sourceStatus,
      liveStatus,
      videoLifecycle,
      videoUrl
    })),
    [
      { status: 'completed', sourceStatus: 'completed', liveStatus: 'scheduled', videoLifecycle: 'completed', videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc' },
      { status: 'completed', sourceStatus: 'scheduled', liveStatus: 'completed', videoLifecycle: 'inactive', videoUrl: null },
      { status: 'completed', sourceStatus: 'completed', liveStatus: 'live', videoLifecycle: 'inactive', videoUrl: null },
      { status: 'cancelled', sourceStatus: 'completed', liveStatus: 'cancelled', videoLifecycle: 'inactive', videoUrl: null },
      { status: 'live', sourceStatus: 'scheduled', liveStatus: 'live', videoLifecycle: 'live', videoUrl: null }
    ]
  );

  const invalidLifecycle = project({
    status: 'SENTINEL_PRIVATE_STATUS',
    liveStatus: 'SENTINEL_PRIVATE_LIVE_STATUS'
  });
  assert.equal(invalidLifecycle.sourceStatus, 'invalid');
  assert.equal(invalidLifecycle.liveStatus, 'invalid');
  assert.equal(invalidLifecycle.videoLifecycle, 'invalid');
  assert.equal(invalidLifecycle.videoUrl, null);
  assert.equal(JSON.stringify(invalidLifecycle).includes('SENTINEL_PRIVATE'), false);

  const liveUrl = 'https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ';
  const projectLive = (lifecycle) => serializePublicGame({
    id: 'live-lifecycle-projection',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    videoUrl: liveUrl,
    ...lifecycle
  });
  assert.equal(projectLive({ status: 'scheduled', liveStatus: 'live' }).videoUrl, liveUrl);
  assert.equal(projectLive({ liveStatus: 'live' }).videoUrl, liveUrl);
  for (const status of ['completed', 'cancelled', 'postponed', 'SENTINEL_PRIVATE_STATUS']) {
    assert.equal(projectLive({ status, liveStatus: 'live' }).videoUrl, null);
  }
});

test('public video projection trusts only exact raw lifecycle tuples', () => {
  const replayUrl = 'https://www.youtube.com/watch?v=PK1HyC37doc';
  const liveUrl = 'https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ';
  const projectReplay = (lifecycle) => serializePublicGame({
    id: 'exact-replay-lifecycle',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    replayVideo: canonicalReplay(),
    ...lifecycle
  });
  const projectLive = (lifecycle) => serializePublicGame({
    id: 'exact-live-lifecycle',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    videoUrl: liveUrl,
    ...lifecycle
  });

  for (const lifecycle of [
    { status: 'completed', liveStatus: 'scheduled' },
    { status: 'completed' },
    { status: 'final' },
    { status: 'completed', liveStatus: 'final' },
    { status: 'final', liveStatus: 'completed' },
    { status: 'completed', liveStatus: null },
    { status: null, liveStatus: 'completed' },
    { status: 'complete', liveStatus: 'scheduled' },
    { status: 'finished', liveStatus: 'scheduled' },
    { status: 'completed', liveStatus: 'complete' },
    { status: 'completed', liveStatus: 'finished' }
  ]) {
    const projection = projectReplay(lifecycle);
    assert.equal(projection.videoLifecycle, 'completed');
    assert.equal(projection.videoUrl, replayUrl);
  }
  const legacyLiveStatusOnly = serializePublicGame({
    id: 'legacy-live-status-only',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    liveStatus: 'completed',
    replayVideo: canonicalReplay()
  });
  assert.equal(legacyLiveStatusOnly.videoLifecycle, 'completed');
  assert.equal(legacyLiveStatusOnly.videoUrl, replayUrl);

  for (const lifecycle of [
    { status: 'scheduled', liveStatus: 'live' },
    { liveStatus: 'live' },
    { status: 'live' },
    { status: 'in_progress', liveStatus: 'scheduled' },
    { status: 'scheduled', liveStatus: 'in-progress' }
  ]) {
    const projection = projectLive(lifecycle);
    assert.equal(projection.videoLifecycle, 'live');
    assert.equal(projection.videoUrl, liveUrl);
  }

  for (const lifecycle of [
    { status: 'scheduled', liveStatus: 'completed' },
    { status: 'completed', liveStatus: 'live' },
    { status: 'completed', liveStatus: 'cancelled' },
    { status: 'cancelled', liveStatus: 'completed' },
    { status: 'completed', liveStatus: 'canceled' },
    { status: 'canceled', liveStatus: 'completed' }
  ]) {
    const projection = projectReplay(lifecycle);
    assert.equal(projection.videoLifecycle, 'inactive');
    assert.equal(projection.videoUrl, null);
  }

  for (const lifecycle of [
    { type: 'Game', status: 'completed', liveStatus: 'scheduled' },
    { type: ' game ', status: 'completed', liveStatus: 'scheduled' },
    { type: '', status: 'completed', liveStatus: 'scheduled' },
    { type: null, status: 'completed', liveStatus: 'scheduled' },
    { status: ' completed', liveStatus: 'scheduled' },
    { status: 'completed ', liveStatus: 'scheduled' },
    { status: 'COMPLETED', liveStatus: 'scheduled' },
    { status: {}, liveStatus: 'scheduled' },
    { status: 'completed', liveStatus: ' scheduled' },
    { status: 'completed', liveStatus: 'SCHEDULED' },
    { status: 'completed', liveStatus: 1 }
  ]) {
    const projection = projectReplay(lifecycle);
    assert.equal(projection.videoLifecycle, 'invalid');
    assert.equal(projection.videoUrl, null);
    assert.equal(['completed', 'final', 'cancelled', 'live', 'in_progress', 'in-progress', 'scheduled', 'postponed', 'delayed', 'invalid', null].includes(projection.sourceStatus), true);
    assert.equal(['completed', 'final', 'cancelled', 'live', 'in_progress', 'in-progress', 'scheduled', 'postponed', 'delayed', 'invalid', null].includes(projection.liveStatus), true);
  }
  assert.equal(projectReplay({ type: 1, status: 'completed', liveStatus: 'scheduled' }), null);

  for (const lifecycle of [
    { type: 'Game', status: 'scheduled', liveStatus: 'live' },
    { status: ' scheduled', liveStatus: 'live' },
    { status: 'scheduled', liveStatus: 'LIVE' },
    { status: 'scheduled', liveStatus: [] }
  ]) {
    const projection = projectLive(lifecycle);
    assert.equal(projection.videoLifecycle, 'invalid');
    assert.equal(projection.videoUrl, null);
  }
});

test('completed public games prioritize their canonical replay and never fall back to a channel', () => {
  const finalGame = {
    id: 'final-video',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    status: 'final',
    videoUrl: 'https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ'
  };
  assert.equal(serializePublicGame({
    ...finalGame,
    replayVideo: canonicalReplay()
  }).videoUrl, 'https://www.youtube.com/watch?v=PK1HyC37doc');
  assert.equal(serializePublicGame({
    ...finalGame,
    recordedVideo: { publicUrl: 'https://youtu.be/PK1HyC37doc' }
  }).videoUrl, 'https://www.youtube.com/watch?v=PK1HyC37doc');
  assert.equal(serializePublicGame(finalGame).videoUrl, null);
});

test('public game projection preserves historical YouTube replay aliases as canonical watch URLs', () => {
  const historicalReplays = [
    {
      replayVideo: {
        publicUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc&si=private-share-token'
      }
    },
    {
      recordedVideo: {
        publicUrl: 'https://youtu.be/PK1HyC37doc?t=42',
        status: 'available'
      }
    },
    {
      videoReplay: {
        provider: 'youtube',
        videoId: 'PK1HyC37doc',
        publicUrl: 'https://www.youtube.com/live/PK1HyC37doc?feature=share',
        status: 'completed'
      }
    },
    {
      replayVideoPublicUrl: 'https://www.youtube-nocookie.com/embed/PK1HyC37doc?autoplay=1',
      replayStatus: 'published'
    },
    {
      videoUrl: 'https://www.youtube.com/shorts/PK1HyC37doc?si=tracking-token'
    },
    {
      recordedVideo: { url: 'https://www.youtube.com/embed/PK1HyC37doc' }
    },
    {
      archivedVideoUrl: 'https://youtu.be/PK1HyC37doc'
    },
    {
      recordedVideo: { videoId: 'PK1HyC37doc' }
    },
    {
      videoReplay: { provider: 'youtube', videoId: 'PK1HyC37doc' }
    },
    {
      recordedVideo: {
        url: 'https://private.example.test/replay.mp4?token=private-capability',
        publicUrl: 'https://youtu.be/PK1HyC37doc?si=private-share-token'
      }
    }
  ];

  historicalReplays.forEach((replayFields, index) => {
    const projection = serializePublicGame({
      id: `historical-replay-${index}`,
      type: 'game',
      date: '2026-08-01T15:00:00Z',
      status: 'completed',
      liveStatus: 'scheduled',
      ...replayFields
    });
    assert.equal(projection.videoUrl, 'https://www.youtube.com/watch?v=PK1HyC37doc');
    assert.equal(JSON.stringify(projection).includes('private-share-token'), false);
    assert.equal(JSON.stringify(projection).includes('tracking-token'), false);
  });
});

test('historical public replay projection fails closed for ambiguous or unsafe archive evidence', () => {
  const unsafeReplayFields = [
    { replayVideoPublicUrl: 'http://www.youtube.com/watch?v=PK1HyC37doc' },
    { recordedVideo: { publicUrl: 'https://youtu.be/PK1HyC37doc', videoId: 'bad' } },
    { videoReplay: { publicUrl: 'https://youtu.be/PK1HyC37doc', embedUrl: 'https://youtube.example/embed/PK1HyC37doc' } },
    { replayVideoPublicUrl: 'https://viewer:secret@www.youtube.com/watch?v=PK1HyC37doc' },
    { replayVideoPublicUrl: 'https://www.youtube.com:443/watch?v=PK1HyC37doc' },
    { replayVideoPublicUrl: 'https://www%2eyoutube%2ecom/watch?v=PK1HyC37doc' },
    { replayVideoPublicUrl: 'https://www.youtube.com/channel/UCa9ghvbup6VQmnDOdqwYpqQ' },
    { replayVideoPublicUrl: 'https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ' },
    { replayVideoPublicUrl: 'https://www.youtube.com/playlist?list=PL-private' },
    { replayVideoPublicUrl: 'https://cdn.example.test/private-replay.mp4?token=capability' },
    { replayVideoPublicUrl: 'https://firebasestorage.googleapis.com/v0/b/project/o/private.mp4?token=capability' },
    {
      recordedVideo: { publicUrl: 'https://youtu.be/PK1HyC37doc' },
      replayVideoPublicUrl: 'https://youtu.be/dQw4w9WgXcQ'
    },
    {
      replayVideo: {
        provider: 'youtube',
        videoId: 'dQw4w9WgXcQ',
        publicUrl: 'https://youtu.be/PK1HyC37doc'
      }
    },
    {
      recordedVideo: { url: 'https://private.example/replay.mp4?token=capability' },
      videoUrl: 'https://youtu.be/PK1HyC37doc'
    },
    {
      recordedVideoUrl: 'https://private.example/replay.mp4?token=capability',
      videoUrl: 'https://youtu.be/PK1HyC37doc'
    }
  ];

  unsafeReplayFields.forEach((replayFields, index) => {
    const projection = serializePublicGame({
      id: `unsafe-historical-replay-${index}`,
      type: 'game',
      date: '2026-08-01T15:00:00Z',
      status: 'completed',
      ...replayFields
    });
    assert.equal(projection.videoUrl, null);
    assert.equal(JSON.stringify(projection).includes('capability'), false);
  });
});

test('blank replay aliases do not suppress the exact completed video fallback', () => {
  assert.equal(serializePublicGame({
    id: 'blank-alias-fallback',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    status: 'completed',
    liveStatus: 'scheduled',
    replayVideoPublicUrl: '   ',
    recordedVideo: { publicUrl: '\n\t' },
    videoUrl: 'https://youtu.be/PK1HyC37doc?si=share-token'
}).videoUrl, 'https://www.youtube.com/watch?v=PK1HyC37doc');
});

test('an explicit replay-removal tombstone suppresses historical video fallbacks', () => {
  const removed = serializePublicGame({
    id: 'removed-replay',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    status: 'completed',
    liveStatus: 'scheduled',
    replayVideo: null,
    replayVideoFallbackDisabled: true,
    videoUrl: 'https://youtu.be/PK1HyC37doc'
  });
  assert.equal(removed.videoUrl, null);
  assert.equal(JSON.stringify(removed).includes('replayVideoFallbackDisabled'), false);
});

test('canonical public replay wins over stale historical aliases but malformed canonical evidence fails closed', () => {
  assert.equal(serializePublicGame({
    id: 'canonical-wins',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    status: 'final',
    replayVideo: canonicalReplay(),
    replayVideoPublicUrl: 'https://youtu.be/dQw4w9WgXcQ',
    videoUrl: 'https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ'
  }).videoUrl, 'https://www.youtube.com/watch?v=PK1HyC37doc');

  assert.equal(serializePublicGame({
    id: 'malformed-canonical',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    status: 'final',
    replayVideo: {
      ...canonicalReplay(),
      videoId: 'dQw4w9WgXcQ'
    },
    replayVideoPublicUrl: 'https://youtu.be/PK1HyC37doc'
  }).videoUrl, null);
});

test('historical public replay projection honors availability, lifecycle, sharing, and Team Pass boundaries', () => {
  const replayFields = {
    recordedVideo: { publicUrl: 'https://youtu.be/PK1HyC37doc' }
  };
  for (const replayStatus of ['processing', 'pending', 'failed', 'error', 'unknown']) {
    assert.equal(serializePublicGame({
      id: `blocked-status-${replayStatus}`,
      type: 'game',
      date: '2026-08-01T15:00:00Z',
      status: 'completed',
      replayStatus,
      ...replayFields
    }).videoUrl, null);
  }

  for (const lifecycle of [
    { status: 'scheduled' },
    { status: 'scheduled', liveStatus: 'completed' },
    { status: 'completed', liveStatus: 'live' },
    { status: 'completed', liveStatus: 'cancelled' },
    { status: 'cancelled', liveStatus: 'completed' }
  ]) {
    assert.equal(serializePublicGame({
      id: 'blocked-lifecycle',
      type: 'game',
      date: '2026-08-01T15:00:00Z',
      ...replayFields,
      ...lifecycle
    }).videoUrl, null);
  }

  const completedReplay = {
    id: 'historical-boundaries',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    status: 'completed',
    liveStatus: 'scheduled',
    ...replayFields
  };
  assert.equal(serializePublicGame({ ...completedReplay, isPrivate: true }), null);
  for (const teamPassConfig of [
    { teamPassConfig: { recordedReplayPaywallEnabled: true } },
    { teamPass: { recordedReplayPaywallEnabled: true } },
    { premiumFeatures: { recordedReplayPaywallEnabled: true } },
    { recordedReplayPaywallEnabled: true },
    { recordedReplayTeamPassRequired: true }
  ]) {
    assert.equal(serializePublicGame(completedReplay, { team: teamPassConfig }).videoUrl, null);
    assert.equal(serializePublicGame({ ...completedReplay, ...teamPassConfig }).videoUrl, null);
  }
});

test('public game projection withholds recorded URLs when the replay paywall is enabled', () => {
  const completedGame = {
    id: 'gated-replay',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    status: 'completed',
    videoUrl: 'https://www.youtube.com/watch?v=directReplay1',
    replayVideo: canonicalReplay()
  };

  assert.equal(serializePublicGame(completedGame, {
    team: { teamPassConfig: { recordedReplayPaywallEnabled: true } }
  }).videoUrl, null);
  assert.equal(serializePublicGame({
    ...completedGame,
    teamPassConfig: { recordedReplayPaywallEnabled: true },
    videoUrl: null
  }).videoUrl, null);
  assert.equal(serializePublicGame({
    ...completedGame,
    teamPassConfig: { recordedReplayPaywallEnabled: false }
  }, {
    team: { teamPassConfig: { recordedReplayPaywallEnabled: true } }
  }).videoUrl, 'https://www.youtube.com/watch?v=PK1HyC37doc');
});

test('public game projection preserves an active live URL when only archived replay is paywalled', () => {
  const projection = serializePublicGame({
    id: 'gated-live',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    liveStatus: 'live',
    videoUrl: 'https://www.youtube.com/live/liveFeed123',
    replayVideo: { publicUrl: 'https://cdn.example.test/private-after-final.mp4' }
  }, {
    team: { recordedReplayTeamPassRequired: true }
  });

  assert.equal(projection.videoUrl, 'https://www.youtube.com/live/liveFeed123');
  assert.equal(JSON.stringify(projection).includes('private-after-final'), false);
});

test('public game projection exposes only a valid reset boundary timestamp', () => {
  const projection = serializePublicGame({
    id: 'reset-replay',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    liveResetAt: new Date('2026-08-01T15:30:00Z'),
    liveResetEventId: 'reset-public-1'
  });
  const invalidProjection = serializePublicGame({
    id: 'invalid-reset',
    type: 'game',
    date: '2026-08-01T15:00:00Z',
    liveResetAt: 'not-a-date',
    liveResetEventId: 'x'.repeat(129)
  });

  assert.equal(projection.liveResetAt, '2026-08-01T15:30:00.000Z');
  assert.equal(projection.liveResetEventId, 'reset-public-1');
  assert.equal(Object.hasOwn(invalidProjection, 'liveResetAt'), false);
  assert.equal(invalidProjection.liveResetEventId, 'x'.repeat(128));
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
