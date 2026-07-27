'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createPublicProfileAuthDeleteHandler,
  createPublicProfileEligibilitySweepHandler,
  createPublicProfileTeamWriteHandler,
  loadAuthoritativePublicProfileStaffTeamIds,
  loadCaseInsensitivePublicProfileStaffTeamIds,
  loadPublicProfileStaffTeamIds,
  reconcilePublicProfileStaffMembershipsForTeam,
  reconcilePublicProfileStaffMembershipsForUser,
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
    'publicProfileAuthIdentities/deleted-user',
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
  const reconciledUserIds = [];
  const syncedUserIds = [];
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
    reconcileAuthIdentity: async (userId, authIdentity) => {
      reconciledUserIds.push([userId, authIdentity]);
    },
    syncEligibleProfile: async (userId, authIdentity) => {
      syncedUserIds.push([userId, authIdentity]);
    },
    batchSize: 10
  });

  assert.deepEqual(await handler(), { scanned: 3, removed: 2 });
  assert.deepEqual(deletedUserIds.sort(), ['missing-user', 'unverified-user']);
  assert.deepEqual(reconciledUserIds.map(([userId]) => userId), [
    'verified-user',
    'unverified-user',
    'missing-user'
  ]);
  assert.deepEqual(syncedUserIds, [['verified-user', {
    email: null,
    displayName: null,
    photoUrl: null,
    emailVerified: true
  }]]);
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

test('unindexed mixed-case admin is discovered through every profile synchronization path', async (t) => {
  const synchronizationPaths = ['callable', 'user-write', 'scheduled-sweep'];

  for (const synchronizationPath of synchronizationPaths) {
    await t.test(synchronizationPath, async () => {
      const memberships = new Map();
      const teamDocs = [
        {
          id: 'unrelated-team',
          data: () => ({ adminEmails: ['other@example.com'] })
        },
        {
          id: 'mixed-case-admin-team',
          data: () => ({ adminEmails: ['Coach@Example.com'] })
        }
      ];
      const teamQuery = {
        select: (field) => {
          assert.equal(field, 'adminEmails');
          return teamQuery;
        },
        orderBy: (field) => {
          assert.equal(field, 'document-id');
          return teamQuery;
        },
        limit: (value) => {
          assert.equal(value, 200);
          return teamQuery;
        },
        startAfter: () => teamQuery,
        get: async () => ({ docs: teamDocs })
      };
      const firestore = {
        collection: (collectionName) => {
          if (collectionName === 'teams') return teamQuery;
          assert.equal(collectionName, 'publicProfileStaffMemberships');
          return {
            where: (field, operator, userId) => {
              assert.deepEqual([field, operator, userId], ['userId', '==', 'coach-user']);
              return {
                get: async () => ({
                  docs: [...memberships].map(([id, membership]) => ({
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
        doc: (path) => {
          if (path.startsWith('publicProfileStaffMemberships/')) {
            return {
              set: async (membership) => {
                memberships.set(path.split('/').at(-1), membership);
              }
            };
          }
          assert.equal(path, 'teams/mixed-case-admin-team');
          return {
            get: async () => ({
              exists: true,
              data: () => ({
                ownerId: 'owner-user',
                adminEmails: ['Coach@Example.com']
              })
            })
          };
        }
      };

      const discoveredTeamIds = await loadCaseInsensitivePublicProfileStaffTeamIds(
        firestore,
        {
          email: 'coach@example.com',
          documentIdField: 'document-id'
        }
      );
      const authoritativeTeamIds = await loadAuthoritativePublicProfileStaffTeamIds(
        firestore,
        {
          userId: 'coach-user',
          email: 'coach@example.com',
          queriedTeamIds: discoveredTeamIds
        }
      );
      await reconcilePublicProfileStaffMembershipsForUser({
        firestore,
        userId: 'coach-user',
        currentStaffTeamIds: authoritativeTeamIds,
        buildMembershipId: (teamId, userId) => `${teamId}-${userId}`,
        updatedAt: 'server-time'
      });

      assert.deepEqual(authoritativeTeamIds, ['mixed-case-admin-team']);
      assert.equal(memberships.size, 1);
      assert.deepEqual([...memberships.values()][0], {
        teamId: 'mixed-case-admin-team',
        userId: 'coach-user',
        updatedAt: 'server-time'
      });
    });
  }
});

test('indexed membership is no longer authoritative after the admin email changes', async () => {
  const firestore = {
    collection: () => ({
      where: () => ({
        get: async () => ({
          docs: [{ data: () => ({ teamId: 'former-admin-team' }) }]
        })
      })
    }),
    doc: () => ({
      get: async () => ({
        exists: true,
        data: () => ({
          ownerId: 'owner-user',
          adminEmails: ['replacement@example.com']
        })
      })
    })
  };

  assert.deepEqual(await loadAuthoritativePublicProfileStaffTeamIds(
    firestore,
    {
      userId: 'former-admin-user',
      email: 'former@example.com'
    }
  ), []);
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

test('Auth reconciliation removes old staff discovery and adds a new team without a team write', async () => {
  const memberships = new Map([
    ['team-old-former-admin', {
      teamId: 'team-old',
      userId: 'admin-user'
    }]
  ]);
  const firestore = {
    collection: (collectionName) => {
      assert.equal(collectionName, 'publicProfileStaffMemberships');
      return {
        where: (field, operator, value) => {
          assert.deepEqual([field, operator, value], ['userId', '==', 'admin-user']);
          return {
            get: async () => ({
              docs: [...memberships].map(([id, membership]) => ({
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

  const removedTeamIds = await reconcilePublicProfileStaffMembershipsForUser({
    firestore,
    userId: 'admin-user',
    currentStaffTeamIds: [],
    buildMembershipId: (teamId, userId) => `${teamId}-${userId}`,
    updatedAt: 'server-time'
  });

  assert.deepEqual(removedTeamIds, ['team-old']);
  assert.deepEqual([...memberships], []);

  const addedTeamIds = await reconcilePublicProfileStaffMembershipsForUser({
    firestore,
    userId: 'admin-user',
    currentStaffTeamIds: ['team-new'],
    buildMembershipId: (teamId, userId) => `${teamId}-${userId}`,
    updatedAt: 'server-time'
  });

  assert.deepEqual(addedTeamIds, ['team-new']);
  assert.deepEqual([...memberships], [['team-new-admin-user', {
    teamId: 'team-new',
    userId: 'admin-user',
    updatedAt: 'server-time'
  }]]);
});

test('stale team trigger retries reconcile from the current team document', async () => {
  const syncCalls = [];
  const firestore = {
    doc: (path) => {
      assert.equal(path, 'teams/team-1');
      return {
        get: async () => ({
          exists: true,
          data: () => ({
            ownerId: 'current-owner',
            adminEmails: ['current@example.com']
          })
        })
      };
    }
  };
  const handler = createPublicProfileTeamWriteHandler({
    firestore,
    syncTeam: async (...args) => syncCalls.push(args)
  });

  await handler({
    before: {
      exists: true,
      data: () => ({
        ownerId: 'old-owner',
        adminEmails: ['old@example.com']
      })
    },
    after: {
      exists: true,
      data: () => ({
        ownerId: 'stale-retry-owner',
        adminEmails: ['stale@example.com']
      })
    }
  }, {
    params: { teamId: 'team-1' }
  });

  assert.deepEqual(syncCalls, [[
    'team-1',
    {
      ownerId: 'old-owner',
      adminEmails: ['old@example.com']
    },
    {
      ownerId: 'current-owner',
      adminEmails: ['current@example.com']
    }
  ]]);
});
