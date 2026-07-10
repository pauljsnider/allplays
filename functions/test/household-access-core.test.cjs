const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHouseholdAccessRevocationPlan,
  buildRevokedParentAccess
} = require('../household-access-core.cjs');

test('accepted household revocation removes only the delegated player and preserves other access', () => {
  const timestamp = { serverTimestamp: true };
  const plan = buildHouseholdAccessRevocationPlan({
    organizerUserId: 'organizer-1',
    membershipId: 'membership-1',
    membership: {
      organizerUserId: 'organizer-1',
      status: 'active',
      userId: 'contact-1',
      teamId: 'team-1',
      playerId: 'player-1'
    },
    accessCodes: [
      { id: 'code-1', type: 'household_invite', organizerUserId: 'organizer-1', familyMembershipId: 'membership-1', usedBy: 'contact-1' },
      { id: 'other-code', type: 'household_invite', organizerUserId: 'organizer-1', familyMembershipId: 'other-membership', usedBy: 'contact-1' }
    ],
    userData: {
      roles: ['parent', 'coach'],
      parentOf: [
        { teamId: 'team-1', playerId: 'player-1', playerName: 'Removed Player' },
        { teamId: 'team-1', playerId: 'player-2', playerName: 'Sibling' },
        { teamId: 'team-2', playerId: 'player-9', playerName: 'Other Team' }
      ],
      parentTeamIds: ['team-1', 'team-2'],
      parentPlayerKeys: ['team-1::player-1', 'team-1::player-2', 'team-2::player-9']
    },
    privateProfile: {
      parents: [
        { userId: 'contact-1', email: 'contact@example.com' },
        { userId: 'other-parent', email: 'other@example.com' }
      ]
    },
    timestamp
  });

  assert.equal(plan.invitedUserId, 'contact-1');
  assert.deepEqual(plan.userUpdate.parentOf, [
    { teamId: 'team-1', playerId: 'player-2', playerName: 'Sibling' },
    { teamId: 'team-2', playerId: 'player-9', playerName: 'Other Team' }
  ]);
  assert.deepEqual(plan.userUpdate.parentTeamIds, ['team-1', 'team-2']);
  assert.deepEqual(plan.userUpdate.parentPlayerKeys, ['team-1::player-2', 'team-2::player-9']);
  assert.deepEqual(plan.userUpdate.roles, ['parent', 'coach']);
  assert.deepEqual(plan.privateProfileUpdate.parents, [
    { userId: 'other-parent', email: 'other@example.com' }
  ]);
  assert.deepEqual(plan.accessCodeUpdates, [{
    id: 'code-1',
    update: {
      revoked: true,
      status: 'revoked',
      revokedAt: timestamp,
      revokedBy: 'organizer-1',
      updatedAt: timestamp
    }
  }]);
  assert.deepEqual(plan.membershipUpdate, {
    status: 'removed',
    accessStatus: 'revoked',
    removedAt: timestamp,
    revokedAt: timestamp,
    revokedBy: 'organizer-1',
    updatedAt: timestamp
  });
});

test('revoking the last parent link removes only the parent role', () => {
  assert.deepEqual(buildRevokedParentAccess({
    roles: ['member', 'parent', 'coach'],
    parentOf: [{ teamId: 'team-1', playerId: 'player-1' }],
    parentTeamIds: ['team-1'],
    parentPlayerKeys: ['team-1::player-1']
  }, { teamId: 'team-1', playerId: 'player-1' }), {
    parentOf: [],
    parentTeamIds: [],
    parentPlayerKeys: [],
    roles: ['member', 'coach']
  });
});

test('pending and previously shell-revoked memberships remain safely cleanable', () => {
  const pendingPlan = buildHouseholdAccessRevocationPlan({
    organizerUserId: 'organizer-1',
    membershipId: 'membership-1',
    membership: { organizerUserId: 'organizer-1', status: 'pending', teamId: 'team-1', playerId: 'player-1' },
    accessCodes: [{ id: 'code-1', type: 'household_invite', organizerUserId: 'organizer-1', familyMembershipId: 'membership-1' }],
    timestamp: 'now'
  });
  assert.equal(pendingPlan.invitedUserId, '');
  assert.equal(pendingPlan.userUpdate, undefined);
  assert.equal(pendingPlan.accessCodeUpdates[0].update.revoked, true);

  const legacyRemovedPlan = buildHouseholdAccessRevocationPlan({
    organizerUserId: 'organizer-1',
    membershipId: 'membership-1',
    membership: { organizerUserId: 'organizer-1', status: 'removed', userId: 'contact-1', teamId: 'team-1', playerId: 'player-1' },
    userData: { roles: ['parent'], parentOf: [{ teamId: 'team-1', playerId: 'player-1' }] },
    privateProfile: { parents: [{ userId: 'contact-1' }] },
    timestamp: 'now'
  });
  assert.deepEqual(legacyRemovedPlan.userUpdate.parentOf, []);
  assert.deepEqual(legacyRemovedPlan.privateProfileUpdate.parents, []);
});

test('shell-only pending household memberships can be revoked without delegated player cleanup', () => {
  const pendingPlan = buildHouseholdAccessRevocationPlan({
    organizerUserId: 'organizer-1',
    membershipId: 'membership-1',
    membership: {
      organizerUserId: 'organizer-1',
      email: 'pending@example.com',
      status: 'pending'
    },
    accessCodes: [{ id: 'code-1', type: 'household_invite', organizerUserId: 'organizer-1', familyMembershipId: 'membership-1' }],
    timestamp: 'now'
  });

  assert.equal(pendingPlan.teamId, '');
  assert.equal(pendingPlan.playerId, '');
  assert.equal(pendingPlan.invitedUserId, '');
  assert.equal(pendingPlan.userUpdate, undefined);
  assert.equal(pendingPlan.privateProfileUpdate, undefined);
  assert.deepEqual(pendingPlan.membershipUpdate, {
    status: 'removed',
    accessStatus: 'revoked',
    removedAt: 'now',
    revokedAt: 'now',
    revokedBy: 'organizer-1',
    updatedAt: 'now'
  });
  assert.equal(pendingPlan.accessCodeUpdates[0].update.revoked, true);
});

test('accepted household memberships still require a delegated player link for cleanup', () => {
  assert.throws(() => buildHouseholdAccessRevocationPlan({
    organizerUserId: 'organizer-1',
    membershipId: 'membership-1',
    membership: {
      organizerUserId: 'organizer-1',
      status: 'active',
      userId: 'contact-1'
    }
  }), /missing its delegated player link/);
});

test('revocation refuses a membership owned by another organizer', () => {
  assert.throws(() => buildHouseholdAccessRevocationPlan({
    organizerUserId: 'organizer-1',
    membershipId: 'membership-1',
    membership: { organizerUserId: 'organizer-2', status: 'active', teamId: 'team-1', playerId: 'player-1' }
  }), /Only the household organizer/);
});
