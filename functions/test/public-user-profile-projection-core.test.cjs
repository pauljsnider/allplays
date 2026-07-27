'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildPublicProfileStaffMembershipId,
  buildPublicProfileUserSourceKey,
  buildPublicUserProfileProjection,
  buildTeamStaffMembershipKey,
  derivePublicProfileTeamIds,
  hashPublicProfileEmail,
  isValidPublicProfileTeamId,
  isPublicProfileAuthUserNotFound
} = require('../public-user-profile-projection-core.cjs');

test('builds stable opaque staff membership ids from normalized team and user identity', () => {
  const membershipId = buildPublicProfileStaffMembershipId(' team-1 ', ' user-1 ');
  assert.match(membershipId, /^[a-f0-9]{64}$/);
  assert.equal(
    membershipId,
    buildPublicProfileStaffMembershipId('team-1', 'user-1')
  );
  assert.notEqual(
    membershipId,
    buildPublicProfileStaffMembershipId('team-2', 'user-1')
  );
});

test('combines parent and server-resolved staff teams without trusting coachOf', () => {
  assert.deepEqual(
    derivePublicProfileTeamIds({
      parentOf: [{ teamId: 'team-parent' }, { teamId: 'team-shared' }],
      parentTeamIds: ['team-shared'],
      coachOf: ['team-coach-of', 'team-shared']
    }, ['team-coach', 'team-parent']),
    ['team-parent', 'team-shared', 'team-coach']
  );
});

test('keeps valid legacy team ids while rejecting invalid Firestore document ids', () => {
  assert.deepEqual(
    derivePublicProfileTeamIds({
      parentTeamIds: [
        'legacy team 1',
        'équipe-2',
        'invalid/path',
        '.',
        '..',
        '__reserved__'
      ]
    }, ['staff-team']),
    ['legacy team 1', 'équipe-2', 'staff-team']
  );
  assert.equal(isValidPublicProfileTeamId('a'.repeat(1500)), true);
  assert.equal(isValidPublicProfileTeamId('é'.repeat(751)), false);
});

test('distinguishes missing Auth users from retryable Auth failures', () => {
  assert.equal(isPublicProfileAuthUserNotFound({ code: 'auth/user-not-found' }), true);
  assert.equal(isPublicProfileAuthUserNotFound({ code: 'user-not-found' }), true);
  assert.equal(isPublicProfileAuthUserNotFound({ code: 'auth/internal-error' }), false);
  assert.equal(isPublicProfileAuthUserNotFound(new Error('network unavailable')), false);
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
    photoUrl: 'https://example.com/tim.jpg',
    discoveryTeamIds: ['team-coach'],
    emailHash: hashPublicProfileEmail('tim@example.com')
  });
});

test('projects only fields accepted by public profile security rules', () => {
  const projection = buildPublicUserProfileProjection({
    email: 'parent@example.com',
    profileName: 'Private profile label'
  });

  assert.deepEqual(
    Object.keys(projection).sort(),
    ['discoveryTeamIds', 'displayName', 'emailHash', 'fullName', 'photoUrl']
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
