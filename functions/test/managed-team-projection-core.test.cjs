'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  serializeManagedTeamDocument,
  serializeManagedTeamProfile,
  serializeStaffTeamProfile
} = require('../managed-team-projection-core.cjs');
const { hasTeamAdminAccess } = require('../team-admin-access-core.cjs');

test('managed team projection exposes only the fields required to establish team access', () => {
  const item = serializeManagedTeamProfile('team-1', {
    name: ' Bears ',
    sport: 'Basketball',
    photoUrl: 'https://images.example.test/team.png',
    ownerId: 'owner-1',
    ownerEmail: ' Owner@Example.com ',
    adminEmails: [' ADMIN@example.com ', 'admin@example.com'],
    privateBillingCustomerId: 'must-not-leak',
    calendarUrls: ['https://private.example.test/calendar']
  });

  assert.deepEqual(item, {
    id: 'team-1',
    name: 'Bears',
    sport: 'Basketball',
    photoUrl: 'https://images.example.test/team.png',
    description: null,
    active: true,
    archived: false,
    status: null,
    isPublic: false,
    ownerId: 'owner-1',
    ownerEmail: 'owner@example.com',
    ownerEmailLower: null,
    adminEmails: ['admin@example.com']
  });
  assert.equal('privateBillingCustomerId' in item, false);
  assert.equal('calendarUrls' in item, false);
});

test('managed team projection preserves conflicting legacy owner aliases for authorized clients', () => {
  const item = serializeManagedTeamProfile('legacy-team', {
    ownerEmail: ' First@Example.com ',
    ownerEmailLower: 'second@example.com'
  });

  assert.equal(item.ownerEmail, 'first@example.com');
  assert.equal(item.ownerEmailLower, 'second@example.com');
});

test('canonical ownership overrides stale legacy owner emails while legacy-only teams still work', () => {
  const team = {
    ownerId: 'owner-1',
    ownerEmailLower: 'stale@example.com',
    ownerEmail: 'legacy@example.com',
    adminEmails: ['admin@example.com']
  };
  assert.equal(hasTeamAdminAccess({ team, uid: 'owner-1', email: 'owner@example.com' }), true);
  assert.equal(hasTeamAdminAccess({ team, uid: 'legacy-1', email: 'LEGACY@example.com' }), false);
  assert.equal(hasTeamAdminAccess({ team, uid: 'stale-1', email: 'STALE@example.com' }), false);
  assert.equal(hasTeamAdminAccess({ team, uid: 'admin-1', email: 'ADMIN@example.com' }), true);
  assert.equal(hasTeamAdminAccess({
    team,
    user: { email: 'admin@example.com', profileEmail: 'admin@example.com' },
    uid: 'stale-profile-1'
  }), false);
  assert.equal(hasTeamAdminAccess({ team, uid: 'stranger-1', email: 'stranger@example.com' }), false);

  const legacyTeam = {
    ownerEmailLower: 'stale@example.com',
    ownerEmail: 'legacy@example.com',
    adminEmails: []
  };
  assert.equal(hasTeamAdminAccess({ team: legacyTeam, uid: 'legacy-1', email: 'LEGACY@example.com' }), false);
  assert.equal(hasTeamAdminAccess({ team: legacyTeam, uid: 'stale-1', email: 'STALE@example.com' }), false);
  assert.equal(hasTeamAdminAccess({
    team: { ownerEmail: ' Legacy@Example.com ', ownerEmailLower: 'legacy@example.com' },
    uid: 'legacy-1',
    email: 'LEGACY@example.com'
  }), true);
});

test('authorized detail preserves required team UI fields without exposing server-only or unknown fields', () => {
  const team = {
    name: 'Bears',
    ageGroup: '12U',
    competitiveLevel: 'Travel',
    ownerId: 'owner-1',
    ownerName: 'Coach Bear',
    adminEmails: ['admin@example.com'],
    zip: '66210',
    leagueUrl: 'https://league.example.test/bears',
    bracketUrl: 'https://league.example.test/bears/bracket',
    tournament: { divisions: ['12U'], pools: ['Gold'] },
    tournamentDivisions: ['12U'],
    tournamentPools: ['Gold'],
    teamLogoUrl: 'https://images.example.test/legacy-team-logo.png',
    primaryColor: '#112233',
    secondaryColor: '#aabbcc',
    twitchChannel: 'bears-live',
    youtubeVideoId: 'dQw4w9WgXcQ',
    scheduleNotifications: { enabled: true },
    calendarUrls: ['https://calendar.example.test/bears.ics'],
    privateCalendarFeedUrl: 'https://calendar.example.test/private/bears.ics',
    calendarFeedToken: 'manager-calendar-token',
    teamPermissions: { scorekeeping: { mode: 'selected', memberIds: ['member-1'] } },
    gameMediaContributorEmails: ['camera@example.com'],
    approvedMediaContributorUids: ['camera-user-1'],
    teamPass: { recordedReplayPaywallEnabled: true },
    premiumFeatures: { recordedReplayPaywallEnabled: true },
    registrationSource: { provider: 'TeamSnap', externalTeamId: 'external-team-1' },
    registrationScheduleSnapshot: { events: [{ id: 'external-game-1' }] },
    registrationScheduleImportStatus: 'complete',
    tournamentPoolOverrides: { 'pool-a': { label: 'Gold' } },
    rosterFields: [{ key: 'position', label: 'Position' }],
    rosterProfileFields: [{ key: 'graduationYear', label: 'Graduation year' }],
    playerProfileFields: [{ key: 'height', label: 'Height' }],
    customRosterFields: [{ key: 'medicalClearance', label: 'Medical clearance' }],
    rosterFieldDefinitions: [{ key: 'school', label: 'School' }],
    seasonId: 'season-legacy',
    currentSeasonId: 'season-current',
    privateBillingCustomerId: 'must-not-leak',
    stripeCustomerId: 'must-not-leak-either',
    unknownFutureSecret: 'must-default-to-private'
  };

  const staffSummary = serializeStaffTeamProfile('team-1', team);
  assert.equal('ownerId' in staffSummary, false);
  assert.equal('adminEmails' in staffSummary, false);
  assert.equal('privateBillingCustomerId' in staffSummary, false);
  assert.equal(staffSummary.photoUrl, 'https://images.example.test/legacy-team-logo.png');

  const managerDocument = serializeManagedTeamDocument('team-1', team);
  assert.deepEqual(managerDocument, {
    id: 'team-1',
    name: 'Bears',
    ageGroup: '12U',
    competitiveLevel: 'Travel',
    zip: '66210',
    leagueUrl: 'https://league.example.test/bears',
    bracketUrl: 'https://league.example.test/bears/bracket',
    tournament: { divisions: ['12U'], pools: ['Gold'] },
    tournamentDivisions: ['12U'],
    tournamentPools: ['Gold'],
    teamLogoUrl: 'https://images.example.test/legacy-team-logo.png',
    primaryColor: '#112233',
    secondaryColor: '#aabbcc',
    twitchChannel: 'bears-live',
    youtubeVideoId: 'dQw4w9WgXcQ',
    scheduleNotifications: { enabled: true },
    calendarUrls: ['https://calendar.example.test/bears.ics'],
    privateCalendarFeedUrl: 'https://calendar.example.test/private/bears.ics',
    calendarFeedToken: 'manager-calendar-token',
    teamPermissions: { scorekeeping: { mode: 'selected', memberIds: ['member-1'] } },
    gameMediaContributorEmails: ['camera@example.com'],
    approvedMediaContributorUids: ['camera-user-1'],
    teamPass: { recordedReplayPaywallEnabled: true },
    premiumFeatures: { recordedReplayPaywallEnabled: true },
    registrationSource: { provider: 'TeamSnap', externalTeamId: 'external-team-1' },
    registrationScheduleSnapshot: { events: [{ id: 'external-game-1' }] },
    registrationScheduleImportStatus: 'complete',
    tournamentPoolOverrides: { 'pool-a': { label: 'Gold' } },
    rosterFields: [{ key: 'position', label: 'Position' }],
    rosterProfileFields: [{ key: 'graduationYear', label: 'Graduation year' }],
    playerProfileFields: [{ key: 'height', label: 'Height' }],
    customRosterFields: [{ key: 'medicalClearance', label: 'Medical clearance' }],
    rosterFieldDefinitions: [{ key: 'school', label: 'School' }],
    seasonId: 'season-legacy',
    currentSeasonId: 'season-current',
    ownerId: 'owner-1',
    ownerName: 'Coach Bear',
    adminEmails: ['admin@example.com']
  });
  assert.equal('privateBillingCustomerId' in managerDocument, false);
  assert.equal('stripeCustomerId' in managerDocument, false);
  assert.equal('unknownFutureSecret' in managerDocument, false);
});
