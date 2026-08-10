'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createDelegatedTeamContextHandler,
  resolveDelegatedAccess,
  serializeDelegatedTeamContext
} = require('../delegated-team-context-core.cjs');

const prohibitedFields = [
  'ownerId',
  'ownerEmail',
  'ownerEmailLower',
  'adminEmails',
  'notificationEmail',
  'streamVolunteerEmails',
  'registrationSourceSnapshot',
  'registrationScheduleSnapshot',
  'registrationRosterSnapshot',
  'calendarUrls',
  'privateCalendarFeedUrl',
  'calendarSubscriptionToken',
  'mediaContributorUids'
];

function productionTeam(overrides = {}) {
  return {
    name: 'Falcons',
    sport: 'Basketball',
    photoUrl: 'https://example.com/falcons.png',
    active: true,
    ownerId: 'owner-1',
    ownerEmail: 'owner@example.com',
    ownerEmailLower: 'owner@example.com',
    adminEmails: ['admin@example.com'],
    notificationEmail: 'private@example.com',
    streamAccessMode: 'selected_volunteers',
    streamVolunteerEmails: ['legacy@example.com'],
    calendarUrls: ['https://calendar.example/private'],
    privateCalendarFeedUrl: 'https://example.com/bearer',
    calendarSubscriptionToken: 'secret-token',
    registrationSourceSnapshot: { secret: true },
    registrationScheduleSnapshot: [{ private: true }],
    registrationRosterSnapshot: [{ private: true }],
    mediaContributorUids: ['unrelated-media-user'],
    twitchChannel: 'falcons-live',
    streamEmbedUrl: 'https://example.com/embed',
    youtubeEmbedUrl: 'https://www.youtube.com/embed/abcdefghijk',
    youtubeVideoId: 'abcdefghijk',
    streamUrl: 'https://stream.example.com/live.m3u8',
    teamPermissions: {
      scorekeeping: { mode: 'selected', memberIds: ['scorekeeper-1'] },
      videography: { mode: 'selected', memberIds: ['videographer-1'] },
      streaming: { mode: 'selected', memberIds: ['streamer-1'] },
      teamMediaManagement: { mode: 'selected', memberIds: ['media-1', 'unrelated-media-user'] }
    },
    ...overrides
  };
}

function createHarness({ teams = { 'team-1': productionTeam() }, users = {}, games = {}, rsvps = {} } = {}) {
  const makeError = (code, message) => Object.assign(new Error(message), { code });
  const handler = createDelegatedTeamContextHandler({
    loadTeam: async (teamId) => teams[teamId] || null,
    loadUser: async (uid) => users[uid] || {},
    loadGame: async (teamId, gameId) => games[`${teamId}/${gameId}`] || null,
    loadRsvp: async (teamId, gameId, uid) => rsvps[`${teamId}/${gameId}/${uid}`] || null,
    makeError
  });
  return handler;
}

function context(uid, email = `${uid}@example.com`) {
  return { auth: { uid, token: email == null ? {} : { email } } };
}

function assertNoProhibitedFields(value) {
  const serialized = JSON.stringify(value);
  prohibitedFields.forEach((field) => assert.equal(serialized.includes(`"${field}"`), false, field));
}

for (const [label, uid, capability] of [
  ['scorekeeper', 'scorekeeper-1', 'scorekeeping'],
  ['videographer', 'videographer-1', 'videography'],
  ['streamer', 'streamer-1', 'streaming'],
  ['media volunteer', 'media-1', 'media']
]) {
  test(`returns an exact bounded projection for a current selected ${label}`, async () => {
    const result = await createHarness()({ teamId: 'team-1' }, context(uid));
    assert.equal(result.item.id, 'team-1');
    assert.equal(result.item.delegatedAccess[capability], true);
    assert.deepEqual(result.item.teamPermissions[
      capability === 'media' ? 'teamMediaManagement' : capability
    ].memberIds, [uid]);
    assertNoProhibitedFields(result);
  });
}

test('accepts a current legacy streaming email without serializing the volunteer list', async () => {
  const result = await createHarness()({ teamId: 'team-1' }, context('legacy-1', 'LEGACY@example.com'));
  assert.equal(result.item.delegatedAccess.streaming, true);
  assert.deepEqual(result.item.teamPermissions.streaming, { mode: 'selected', memberIds: ['legacy-1'] });
  assertNoProhibitedFields(result);
});

test('preserves a legacy selected streaming grant when the newer mode is all-confirmed', async () => {
  const team = productionTeam({
    teamPermissions: {
      ...productionTeam().teamPermissions,
      streaming: { mode: 'all_confirmed', memberIds: [] }
    }
  });
  const result = await createHarness({ teams: { 'team-1': team } })(
    { teamId: 'team-1' },
    context('legacy-1', 'LEGACY@example.com')
  );

  assert.equal(result.item.delegatedAccess.modes.streaming, 'selected');
  assert.deepEqual(result.item.teamPermissions.streaming, { mode: 'selected', memberIds: ['legacy-1'] });
});

test('preserves and revokes a legacy confirmed streaming grant across a finished transition', async () => {
  const team = productionTeam({
    streamAccessMode: 'confirmed_members',
    streamVolunteerEmails: [],
    teamPermissions: {
      ...productionTeam().teamPermissions,
      streaming: { mode: 'selected', memberIds: [] }
    }
  });
  const handler = createHarness({
    teams: { 'team-1': team },
    games: {
      'team-1/game-live': { status: 'scheduled', liveStatus: 'live' },
      'team-1/game-finished': { status: 'scheduled', liveStatus: 'finished' }
    },
    rsvps: {
      'team-1/game-live/confirmed-1': { response: 'confirmed' },
      'team-1/game-finished/confirmed-1': { response: 'confirmed' }
    }
  });

  const liveResult = await handler({ teamId: 'team-1', gameId: 'game-live' }, context('confirmed-1'));
  assert.equal(liveResult.item.delegatedAccess.modes.streaming, 'all_confirmed');
  assert.deepEqual(liveResult.item.teamPermissions.streaming, { mode: 'all_confirmed', memberIds: [] });
  await assert.rejects(
    handler({ teamId: 'team-1', gameId: 'game-finished' }, context('confirmed-1')),
    { code: 'permission-denied' }
  );
});

test('fails closed for unsigned, revoked, cross-team, stale-email, and unrelated callers', async () => {
  const handler = createHarness({
    teams: {
      'team-1': productionTeam(),
      'team-2': productionTeam({
        ownerId: 'owner-2',
        teamPermissions: {
          scorekeeping: { mode: 'selected', memberIds: [] },
          videography: { mode: 'selected', memberIds: [] },
          streaming: { mode: 'selected', memberIds: [] },
          teamMediaManagement: { mode: 'selected', memberIds: [] }
        },
        streamVolunteerEmails: []
      })
    },
    users: { 'stale-email-user': { email: 'legacy@example.com' } }
  });
  await assert.rejects(handler({ teamId: 'team-1' }, {}), { code: 'unauthenticated' });
  await assert.rejects(handler({ teamId: 'team-1' }, context('revoked-1')), { code: 'permission-denied' });
  await assert.rejects(handler({ teamId: 'team-2' }, context('scorekeeper-1')), { code: 'permission-denied' });
  await assert.rejects(handler({ teamId: 'team-1' }, context('stale-email-user', 'new@example.com')), { code: 'permission-denied' });
  await assert.rejects(handler({ teamId: 'team-1' }, context('unrelated-1')), { code: 'permission-denied' });
});

test('requires a current game and RSVP for all-confirmed capability modes', async () => {
  const team = productionTeam({
    teamPermissions: {
      scorekeeping: { mode: 'all_confirmed', memberIds: [] },
      videography: { mode: 'selected', memberIds: [] },
      streaming: { mode: 'selected', memberIds: [] },
      teamMediaManagement: { mode: 'selected', memberIds: [] }
    },
    streamAccessMode: 'admins',
    streamVolunteerEmails: []
  });
  const handler = createHarness({
    teams: { 'team-1': team },
    games: { 'team-1/game-1': { status: 'scheduled', liveStatus: 'scheduled' } },
    rsvps: { 'team-1/game-1/confirmed-1': { response: 'confirmed' } }
  });
  await assert.rejects(handler({ teamId: 'team-1' }, context('confirmed-1')), { code: 'permission-denied' });
  await assert.rejects(handler({ teamId: 'team-1', gameId: 'game-1' }, context('missing-rsvp')), { code: 'permission-denied' });
  const result = await handler({ teamId: 'team-1', gameId: 'game-1' }, context('confirmed-1'));
  assert.deepEqual(result.item.teamPermissions.scorekeeping, { mode: 'all_confirmed', memberIds: [] });
});

test('terminal game statuses revoke every confirmed-member grant', () => {
  const team = productionTeam({
    teamPermissions: {
      scorekeeping: { mode: 'all_confirmed', memberIds: [] },
      videography: { mode: 'all_confirmed', memberIds: [] },
      streaming: { mode: 'all_confirmed', memberIds: [] },
      teamMediaManagement: { mode: 'selected', memberIds: [] }
    },
    streamAccessMode: 'confirmed_members',
    streamVolunteerEmails: []
  });

  for (const terminalStatus of ['cancelled', 'canceled', 'completed', 'finished', 'final', 'deleted']) {
    for (const statusField of ['status', 'liveStatus']) {
      const access = resolveDelegatedAccess({
        uid: 'confirmed-1',
        email: 'confirmed-1@example.com',
        user: {},
        teamId: 'team-1',
        team,
        game: { status: 'scheduled', liveStatus: 'scheduled', [statusField]: terminalStatus },
        rsvp: { response: 'confirmed' }
      });

      assert.deepEqual({
        scorekeeping: access.scorekeeping,
        videography: access.videography,
        streaming: access.streaming
      }, {
        scorekeeping: false,
        videography: false,
        streaming: false
      }, `${statusField}=${terminalStatus}`);
    }
  }
});

test('returns a bounded private-team projection for a current parent', async () => {
  const handler = createHarness({
    users: { 'parent-1': { parentTeamIds: ['team-1'] } },
    games: { 'team-1/game-live': { status: 'scheduled', liveStatus: 'live' } }
  });

  const liveResult = await handler({ teamId: 'team-1', gameId: 'game-live' }, context('parent-1'));
  const replayResult = await handler({ teamId: 'team-1' }, context('parent-1'));

  for (const result of [liveResult, replayResult]) {
    assert.equal(result.item.id, 'team-1');
    assert.equal(result.item.delegatedAccess.parent, true);
    assert.equal(result.item.delegatedAccess.full, false);
    assert.deepEqual(result.item.teamPermissions, {});
    assert.deepEqual({
      twitchChannel: result.item.twitchChannel,
      streamEmbedUrl: result.item.streamEmbedUrl,
      youtubeEmbedUrl: result.item.youtubeEmbedUrl,
      youtubeVideoId: result.item.youtubeVideoId,
      streamUrl: result.item.streamUrl
    }, {
      twitchChannel: 'falcons-live',
      streamEmbedUrl: 'https://example.com/embed',
      youtubeEmbedUrl: 'https://www.youtube.com/embed/abcdefghijk',
      youtubeVideoId: 'abcdefghijk',
      streamUrl: 'https://stream.example.com/live.m3u8'
    });
    assertNoProhibitedFields(result);
  }
});

test('marks owner and admin projections with server-authoritative full access', async () => {
  const handler = createHarness();

  const ownerResult = await handler({ teamId: 'team-1' }, context('owner-1', 'owner@example.com'));
  const adminResult = await handler({ teamId: 'team-1' }, context('admin-1', 'ADMIN@example.com'));

  for (const result of [ownerResult, adminResult]) {
    assert.equal(result.item.delegatedAccess.full, true);
    assert.equal(result.item.delegatedAccess.streaming, true);
    assertNoProhibitedFields(result);
  }
});

test('serializer never spreads canonical fields or unrelated permission members', () => {
  const result = serializeDelegatedTeamContext('team-1', productionTeam(), 'scorekeeper-1', {
    full: false,
    scorekeeping: true,
    videography: false,
    streaming: false,
    media: false,
    modes: { scorekeeping: 'selected' }
  });
  assert.deepEqual(Object.keys(result).sort(), [
    'active',
    'archived',
    'delegatedAccess',
    'id',
    'isDelegatedTeamContext',
    'isPublic',
    'name',
    'photoUrl',
    'sport',
    'status',
    'teamPermissions'
  ]);
  assert.deepEqual(result.teamPermissions, {
    scorekeeping: { mode: 'selected', memberIds: ['scorekeeper-1'] }
  });
  assertNoProhibitedFields(result);
});
