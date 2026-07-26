'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildPublicProfileUserSourceKey,
  buildPublicUserProfileProjection,
  buildTeamStaffMembershipKey,
  derivePublicProfileTeamIds,
  hashPublicProfileEmail
} = require('../public-user-profile-projection-core.cjs');

test('combines parent and server-resolved staff teams without duplicates', () => {
  assert.deepEqual(
    derivePublicProfileTeamIds({
      parentOf: [{ teamId: 'team-parent' }, { teamId: 'team-shared' }],
      parentTeamIds: ['team-shared']
    }, ['team-coach', 'team-parent']),
    ['team-parent', 'team-shared', 'team-coach']
  );
});

test('uses Firebase Auth identity when a legacy user profile has only an email', () => {
  const projection = buildPublicUserProfileProjection({
    email: 'tim@example.com'
  }, {
    trustedEmail: 'Tim@Example.com',
    trustedDisplayName: 'Tim Coach',
    trustedPhotoUrl: 'https://example.com/tim.jpg',
    discoveryTeamIds: ['team-coach']
  });

  assert.deepEqual(projection, {
    displayName: 'Tim Coach',
    fullName: 'Tim Coach',
    profileName: null,
    photoUrl: 'https://example.com/tim.jpg',
    discoveryTeamIds: ['team-coach'],
    emailHash: hashPublicProfileEmail('tim@example.com')
  });
});

test('projects profileName and refreshes when it changes', () => {
  const before = {
    email: 'parent@example.com',
    profileName: 'Parent One'
  };
  const after = {
    ...before,
    profileName: 'Parent Two'
  };

  assert.equal(buildPublicUserProfileProjection(after).profileName, 'Parent Two');
  assert.notEqual(
    buildPublicProfileUserSourceKey(before),
    buildPublicProfileUserSourceKey(after)
  );
});

test('prefers private presentation fields over Auth fallbacks', () => {
  const projection = buildPublicUserProfileProjection({
    email: 'parent@example.com',
    fullName: 'Brian Parent',
    photoUrl: 'https://example.com/private.jpg',
    parentTeamIds: ['team-parent']
  }, {
    trustedDisplayName: 'Auth Name',
    trustedPhotoUrl: 'https://example.com/auth.jpg',
    discoveryTeamIds: ['team-staff']
  });

  assert.equal(projection.displayName, 'Brian Parent');
  assert.equal(projection.fullName, 'Brian Parent');
  assert.equal(projection.photoUrl, 'https://example.com/private.jpg');
  assert.deepEqual(projection.discoveryTeamIds, ['team-parent', 'team-staff']);
});

test('normalizes staff membership keys so unrelated team edits do not resync profiles', () => {
  const before = {
    ownerId: 'owner-1',
    adminEmails: ['Coach@Example.com', 'assistant@example.com'],
    name: 'Old name'
  };
  const after = {
    ownerId: 'owner-1',
    adminEmails: ['assistant@example.com', 'coach@example.com'],
    name: 'New name'
  };

  assert.equal(buildTeamStaffMembershipKey(before), buildTeamStaffMembershipKey(after));
  assert.notEqual(
    buildTeamStaffMembershipKey(before),
    buildTeamStaffMembershipKey({ ...after, adminEmails: ['assistant@example.com'] })
  );
});

test('ignores unrelated user activity when deciding whether to refresh a profile', () => {
  const before = {
    email: 'parent@example.com',
    fullName: 'Parent One',
    parentTeamIds: ['team-1'],
    lastLogin: 'old'
  };
  const after = {
    ...before,
    lastLogin: 'new',
    chatLastRead: { 'team-1': 'now' }
  };

  assert.equal(buildPublicProfileUserSourceKey(before), buildPublicProfileUserSourceKey(after));
  assert.notEqual(
    buildPublicProfileUserSourceKey(before),
    buildPublicProfileUserSourceKey({ ...after, parentTeamIds: ['team-1', 'team-2'] })
  );
});
