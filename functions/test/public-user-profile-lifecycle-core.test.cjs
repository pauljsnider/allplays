'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createPublicProfileAuthDeleteHandler,
  createPublicProfileEligibilitySweepHandler,
  loadPublicProfileStaffTeamIds,
  reconcilePublicProfileStaffMembershipsForTeam,
  resolvePublicProfileStaffUserIds,
  removePublicProfileForIneligibleAuth
} = require('../public-user-profile-lifecycle-core.cjs');

test('removes a stale public profile when an Auth identity becomes unverified', async () => {
  let deleteCalls = 0;
  const publicProfileRef = {
    delete: async () => {
      deleteCalls++;
    }
  };

  assert.equal(await removePublicProfileForIneligibleAuth(
    publicProfileRef,
    { emailVerified: false }
  ), true);
  assert.equal(deleteCalls, 1);

  assert.equal(await removePublicProfileForIneligibleAuth(
    publicProfileRef,
    { emailVerified: true }
  ), false);
  assert.equal(deleteCalls, 1);
});

test('Auth deletion removes the public profile and normalized staff memberships', async () => {
  const deletedPaths = [];
  const staffDocs = [
    {
      ref: {
        delete: async () => deletedPaths.push('publicProfileStaffMemberships/staff-1')
      }
    },
    {
      ref: {
        delete: async () => deletedPaths.push('publicProfileStaffMemberships/staff-2')
      }
    }
  ];
  const firestore = {
    collection: (collectionName) => {
      assert.equal(collectionName, 'publicProfileStaffMemberships');
      return {
        where: (field, operator, userId) => {
          assert.deepEqual([field, operator, userId], ['userId', '==', 'deleted-user']);
          return { get: async () => ({ docs: staffDocs }) };
        }
      };
    },
    doc: (path) => ({
      delete: async () => deletedPaths.push(path)
    })
  };

  const handler = createPublicProfileAuthDeleteHandler({ firestore });
  assert.equal(await handler({ uid: 'deleted-user' }), null);
  assert.deepEqual(deletedPaths.sort(), [
    'publicProfileStaffMemberships/staff-1',
    'publicProfileStaffMemberships/staff-2',
    'publicUserProfiles/deleted-user'
  ]);
});

test('Auth deletion ignores records without a uid', async () => {
  const handler = createPublicProfileAuthDeleteHandler({
    firestore: {
      collection: () => {
        throw new Error('should not query');
      }
    }
  });
  assert.equal(await handler({}), null);
});

test('scheduled eligibility sweep removes newly unverified and missing Auth users', async () => {
  const deletedUserIds = [];
  const profileDocs = ['verified-user', 'unverified-user', 'missing-user'].map((id) => ({
    id,
    ref: {
      delete: async () => deletedUserIds.push(id)
    }
  }));
  const query = {
    orderBy: () => query,
    limit: () => query,
    startAfter: () => query,
    get: async () => ({ docs: profileDocs })
  };
  const auth = {
    getUser: async (userId) => {
      if (userId === 'missing-user') {
        throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
      }
      return { emailVerified: userId === 'verified-user' };
    }
  };
  const handler = createPublicProfileEligibilitySweepHandler({
    firestore: {
      collection: (collectionName) => {
        assert.equal(collectionName, 'publicUserProfiles');
        return query;
      }
    },
    auth,
    documentIdField: 'document-id',
    isAuthUserNotFound: (error) => error?.code === 'auth/user-not-found',
    batchSize: 10
  });

  assert.deepEqual(await handler(), { scanned: 3, removed: 2 });
  assert.deepEqual(deletedUserIds.sort(), ['missing-user', 'unverified-user']);
});

test('mixed-case admin emails resolve once to a stable uid-based staff membership', async () => {
  const lookedUpEmails = [];
  const userIds = await resolvePublicProfileStaffUserIds({
    ownerId: 'owner-user',
    adminEmails: ['Coach@Example.com', 'coach@example.com']
  }, {
    getUserByEmail: async (email) => {
      lookedUpEmails.push(email);
      return { uid: 'coach-user' };
    },
    isAuthUserNotFound: () => false
  });

  assert.deepEqual(lookedUpEmails, ['coach@example.com']);
  assert.deepEqual(userIds, ['owner-user', 'coach-user']);
});

test('runtime profile resync reads normalized staff teams by uid without email matching', async () => {
  const firestore = {
    collection: (collectionName) => {
      assert.equal(collectionName, 'publicProfileStaffMemberships');
      return {
        where: (field, operator, userId) => {
          assert.deepEqual([field, operator, userId], ['userId', '==', 'coach-user']);
          return {
            get: async () => ({
              docs: [
                { data: () => ({ teamId: 'mixed-case-admin-team' }) },
                { data: () => ({ teamId: 'mixed-case-admin-team' }) }
              ]
            })
          };
        }
      };
    }
  };

  assert.deepEqual(
    await loadPublicProfileStaffTeamIds(firestore, 'coach-user'),
    ['mixed-case-admin-team']
  );
});

test('team reconciliation removes a former admin after their Auth email changes', async () => {
  const memberships = new Map([
    ['former-membership', {
      teamId: 'team-1',
      userId: 'former-admin'
    }]
  ]);
  const firestore = {
    collection: (collectionName) => {
      assert.equal(collectionName, 'publicProfileStaffMemberships');
      return {
        where: (field, operator, value) => {
          assert.equal(operator, '==');
          return {
            get: async () => ({
              docs: [...memberships]
                .filter(([, membership]) => membership[field] === value)
                .map(([id, membership]) => ({
                  id,
                  data: () => membership,
                  ref: {
                    delete: async () => memberships.delete(id)
                  }
                }))
            })
          };
        }
      };
    },
    doc: (path) => ({
      set: async (membership) => {
        memberships.set(path.split('/').at(-1), membership);
      }
    })
  };

  const resyncUserIds = await reconcilePublicProfileStaffMembershipsForTeam({
    firestore,
    teamId: 'team-1',
    currentStaffUserIds: ['owner-user'],
    buildMembershipId: (teamId, userId) => `${teamId}-${userId}`,
    updatedAt: 'server-time'
  });

  assert.deepEqual(resyncUserIds.sort(), ['former-admin', 'owner-user']);
  assert.deepEqual([...memberships.values()], [{
    teamId: 'team-1',
    userId: 'owner-user',
    updatedAt: 'server-time'
  }]);
  assert.deepEqual(
    await loadPublicProfileStaffTeamIds(firestore, 'former-admin'),
    []
  );
});
