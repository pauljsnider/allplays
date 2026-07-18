const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PUBLIC_TEAM_PROFILE_FIELDS,
  buildPublicTeamProfile,
  findUnexpectedPublicTeamProfileFields,
  isPublicTeamProfileSchemaValid,
  matchesPublicTeamProfileSearch
} = require('../public-team-profile-core.cjs');

test('public team projection preserves presentation fields and strips management data', () => {
  const profile = buildPublicTeamProfile({
    name: 'Blue Jays',
    sport: 'Baseball',
    description: 'Community baseball',
    city: 'Austin',
    state: 'tx',
    zip: '78701',
    leagueUrl: 'https://league.example.test',
    socialLinks: { instagram: 'https://instagram.example.test/bluejays' },
    standingsConfig: { enabled: true, points: { win: 3 }, providerToken: 'must-not-leak' },
    tournament: { pools: [{ name: 'Pool A', managerEmail: 'must-not-leak@example.test' }] },
    streamUrl: 'https://youtube.example.test/live',
    isPublic: true,
    active: true,
    ownerId: 'owner-1',
    ownerEmail: 'owner@example.test',
    adminEmails: ['admin@example.test'],
    notificationEmail: 'notify@example.test',
    registrationProvider: { apiToken: 'provider-token' },
    registrationSource: { secret: 'source-secret' },
    teamPermissions: { streaming: { memberIds: ['user-1'] } },
    calendarUrls: ['https://calendar.example.test/private-token.ics'],
    calendarFeedToken: 'private-calendar-token',
    privateCalendarFeedUrl: 'https://private.example.test/token'
  });

  assert.equal(profile.name, 'Blue Jays');
  assert.equal(profile.publicSearchName, 'blue jays');
  assert.equal(profile.publicSearchCityState, 'austin, tx');
  assert.equal(profile.leagueUrl, 'https://league.example.test');
  assert.equal(profile.streamUrl, 'https://youtube.example.test/live');
  assert.equal(profile.publicSchemaVersion, 1);
  assert.equal(profile.standingsConfig.providerToken, undefined);
  assert.equal(profile.standingsConfig.points.win, 3);
  assert.equal(profile.tournament.pools[0].managerEmail, undefined);
  assert.equal(isPublicTeamProfileSchemaValid(profile), true);
  assert.deepEqual(findUnexpectedPublicTeamProfileFields(profile), []);

  for (const field of [
    'ownerId', 'ownerEmail', 'adminEmails', 'notificationEmail',
    'registrationProvider', 'registrationSource', 'teamPermissions',
    'calendarUrls', 'calendarFeedToken', 'privateCalendarFeedUrl'
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(profile, field), false, `${field} must not enter the projection`);
    assert.equal(PUBLIC_TEAM_PROFILE_FIELDS.includes(field), false, `${field} must not be allow-listed`);
  }
});

test('private and inactive teams have no public projection', () => {
  assert.equal(buildPublicTeamProfile({ name: 'Private', isPublic: false, active: true }), null);
  assert.equal(buildPublicTeamProfile({ name: 'Inactive', isPublic: true, active: false }), null);
  assert.equal(buildPublicTeamProfile({ name: 'Archived', isPublic: true, archived: true }), null);
});

test('projection validation rejects injected fields and nameless documents', () => {
  assert.equal(isPublicTeamProfileSchemaValid({ publicSchemaVersion: 1, name: 'Safe', isPublic: true, active: true, ownerEmail: 'leak@example.test' }), false);
  assert.equal(isPublicTeamProfileSchemaValid({
    publicSchemaVersion: 1,
    name: 'Unsafe Nested Team', isPublic: true, active: true,
    tournament: { providerSecret: 'leak' }
  }), false);
  assert.equal(isPublicTeamProfileSchemaValid({ publicSchemaVersion: 1, name: '', isPublic: true, active: true }), false);
});

test('public team fallback search matches all normalized tokens without private fields', () => {
  const profile = buildPublicTeamProfile({
    name: 'Blue Jays', sport: 'Baseball', city: 'Kansas City', state: 'MO', zip: '64110', isPublic: true
  });
  assert.equal(matchesPublicTeamProfileSearch(profile, 'kansas mo'), true);
  assert.equal(matchesPublicTeamProfileSearch(profile, '64110 baseball'), true);
  assert.equal(matchesPublicTeamProfileSearch(profile, 'austin'), false);
});
