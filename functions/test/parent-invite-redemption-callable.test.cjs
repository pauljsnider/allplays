'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ISSUER_ACCESS_ERROR,
  createRedeemParentInviteHandler
} = require('../parent-invite-redemption-core.cjs');

class TestHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const NOW = Object.freeze({ seconds: 1_800_000_000, nanoseconds: 0 });

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function makeFirestore(seed) {
  const state = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  const committedWrites = [];

  function doc(path) {
    return { path, id: path.split('/').pop() };
  }

  function snapshot(ref) {
    const value = state.get(ref.path);
    return {
      id: ref.id,
      ref,
      exists: value !== undefined,
      data: () => clone(value)
    };
  }

  return {
    committedWrites,
    doc,
    collection(name) {
      return {
        where(field, operator, expected) {
          assert.equal(field, 'code');
          assert.equal(operator, '==');
          return {
            limit(count) {
              assert.equal(count, 1);
              return {
                async get() {
                  const entry = [...state.entries()].find(([path, value]) => (
                    path.startsWith(`${name}/`) && value.code === expected
                  ));
                  if (!entry) return { empty: true, docs: [] };
                  const ref = doc(entry[0]);
                  return { empty: false, docs: [snapshot(ref)] };
                }
              };
            }
          };
        }
      };
    },
    snapshot: (path) => clone(state.get(path)),
    async runTransaction(callback) {
      const pendingWrites = [];
      const result = await callback({
        get: async (ref) => snapshot(ref),
        set: (ref, value, options) => pendingWrites.push({ type: 'set', ref, value, options }),
        update: (ref, value) => pendingWrites.push({ type: 'update', ref, value })
      });

      for (const write of pendingWrites) {
        const current = state.get(write.ref.path);
        const next = write.type === 'set' && write.options?.merge
          ? { ...(current || {}), ...clone(write.value) }
          : { ...(current || {}), ...clone(write.value) };
        state.set(write.ref.path, next);
        committedWrites.push({ type: write.type, path: write.ref.path });
      }
      return result;
    }
  };
}

function normalizeFirestoreId(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('/')) {
    throw new TestHttpsError('invalid-argument', `${label} is invalid.`);
  }
  return value.trim();
}

function createHarness({
  team,
  issuerProfile = {},
  issuerAuthUser,
  generatedBy = 'issuer-1',
  codeOverrides = {}
}) {
  const seed = {
    'accessCodes/invite-1': {
      code: 'PARENT1',
      type: 'parent_invite',
      teamId: 'team-1',
      teamName: 'Tigers',
      playerId: 'player-1',
      playerName: 'Alex',
      playerNum: '7',
      email: 'parent@example.com',
      relation: 'Parent',
      generatedBy,
      used: false,
      status: 'active',
      ...codeOverrides
    },
    'teams/team-1': clone(team),
    'teams/team-1/players/player-1': {
      name: 'Alex',
      number: '7',
      photoUrl: 'player.jpg'
    },
    'teams/team-1/players/player-1/private/profile': {
      parents: [{ userId: 'existing-parent' }]
    },
    'users/parent-1': {
      parentOf: [{ teamId: 'existing-team', playerId: 'existing-player' }],
      parentTeamIds: ['existing-team'],
      parentPlayerKeys: ['existing-team::existing-player'],
      roles: ['member']
    },
    'users/issuer-1': clone(issuerProfile),
    'publicUserProfiles/parent-1': {
      displayName: 'Existing Parent'
    }
  };
  const firestore = makeFirestore(seed);
  async function getAuthUser(uid) {
    if (uid === 'issuer-1' && issuerAuthUser) return clone(issuerAuthUser);
    const error = new Error('Auth user not found');
    error.code = 'auth/user-not-found';
    throw error;
  }
  const handler = createRedeemParentInviteHandler({
    firestore,
    getAuthUser,
    getTimestamp: () => NOW,
    arrayUnion: (value) => ({ values: [clone(value)] }),
    HttpsError: TestHttpsError,
    normalizeFirestoreId,
    buildPublicProfilePayload: (user, options) => ({
      roles: clone(user.roles),
      trustedEmail: options.trustedEmail
    }),
    nowMillis: () => 1_800_000_000_000
  });
  const context = {
    auth: {
      uid: 'parent-1',
      token: {
        email: 'parent@example.com',
        email_verified: true
      }
    }
  };
  return { context, firestore, handler };
}

async function redeem(harness) {
  return harness.handler({ code: 'parent1', userId: 'parent-1' }, harness.context);
}

for (const [label, authorization] of [
  ['current owner', {
    team: { ownerId: 'issuer-1', adminEmails: [] },
    issuerAuthUser: { uid: 'issuer-1', email: 'owner@example.com', disabled: false }
  }],
  ['current email-listed administrator', {
    team: { ownerId: 'owner-1', adminEmails: ['issuer@example.com'] },
    issuerAuthUser: { uid: 'issuer-1', email: 'ISSUER@example.com', disabled: false }
  }],
  ['authorized platform administrator', {
    team: { ownerId: 'owner-1', adminEmails: [] },
    issuerProfile: { isAdmin: true },
    issuerAuthUser: { uid: 'issuer-1', email: 'platform@example.com', disabled: false }
  }]
]) {
  test(`redeems atomically when issued by a ${label}`, async () => {
    const harness = createHarness(authorization);

    assert.deepEqual(await redeem(harness), {
      success: true,
      codeId: 'invite-1',
      teamId: 'team-1',
      teamName: 'Tigers',
      playerId: 'player-1',
      playerName: 'Alex',
      playerNum: '7'
    });
    assert.deepEqual(harness.firestore.snapshot('accessCodes/invite-1'), {
      code: 'PARENT1',
      type: 'parent_invite',
      teamId: 'team-1',
      teamName: 'Tigers',
      playerId: 'player-1',
      playerName: 'Alex',
      playerNum: '7',
      email: 'parent@example.com',
      relation: 'Parent',
      generatedBy: 'issuer-1',
      used: true,
      status: 'accepted',
      usedBy: 'parent-1',
      usedAt: NOW
    });
    assert.deepEqual(harness.firestore.snapshot('users/parent-1').parentPlayerKeys, [
      'existing-team::existing-player',
      'team-1::player-1'
    ]);
    assert.deepEqual(harness.firestore.snapshot('users/parent-1').roles, ['member', 'parent']);
    assert.deepEqual(harness.firestore.committedWrites, [
      { type: 'set', path: 'users/parent-1' },
      { type: 'set', path: 'publicUserProfiles/parent-1' },
      { type: 'set', path: 'teams/team-1/players/player-1/private/profile' },
      { type: 'update', path: 'accessCodes/invite-1' }
    ]);
  });
}

for (const [label, authorization] of [
  ['removed administrator', {
    team: { ownerId: 'owner-1', adminEmails: [] },
    issuerProfile: { email: 'issuer@example.com' },
    issuerAuthUser: { uid: 'issuer-1', email: 'issuer@example.com', disabled: false }
  }],
  ['disabled issuer', {
    team: { ownerId: 'owner-1', adminEmails: ['issuer@example.com'] },
    issuerAuthUser: { uid: 'issuer-1', email: 'issuer@example.com', disabled: true }
  }],
  ['deleted issuer', {
    team: { ownerId: 'owner-1', adminEmails: ['issuer@example.com'] },
    issuerAuthUser: null
  }],
  ['missing generatedBy', {
    team: { ownerId: 'owner-1', adminEmails: ['issuer@example.com'] },
    generatedBy: null,
    issuerAuthUser: { uid: 'issuer-1', email: 'issuer@example.com', disabled: false }
  }],
  ['malformed generatedBy', {
    team: { ownerId: 'owner-1', adminEmails: ['issuer@example.com'] },
    generatedBy: { uid: 'issuer-1' },
    issuerAuthUser: { uid: 'issuer-1', email: 'issuer@example.com', disabled: false }
  }],
  ['stale issuer profile email', {
    team: { ownerId: 'owner-1', adminEmails: ['old@example.com'] },
    issuerProfile: { email: 'old@example.com' },
    issuerAuthUser: { uid: 'issuer-1', email: 'current@example.com', disabled: false }
  }]
]) {
  test(`denies a ${label} before any parent-access writes`, async () => {
    const harness = createHarness(authorization);
    const protectedPaths = [
      'accessCodes/invite-1',
      'users/parent-1',
      'publicUserProfiles/parent-1',
      'teams/team-1/players/player-1/private/profile'
    ];
    const before = Object.fromEntries(protectedPaths.map((path) => [path, harness.firestore.snapshot(path)]));

    await assert.rejects(
      redeem(harness),
      (error) => error.code === 'permission-denied' && error.message === ISSUER_ACCESS_ERROR
    );
    assert.deepEqual(harness.firestore.committedWrites, []);
    for (const path of protectedPaths) {
      assert.deepEqual(harness.firestore.snapshot(path), before[path]);
    }
  });
}

for (const [label, codeOverrides, errorCode] of [
  ['used invite', { used: true }, 'failed-precondition'],
  ['revoked invite', { revoked: true }, 'failed-precondition'],
  ['expired invite', { expiresAt: { toMillis: () => 1_700_000_000_000 } }, 'failed-precondition']
]) {
  test(`preserves the existing rejection for a ${label}`, async () => {
    const harness = createHarness({
      team: { ownerId: 'issuer-1', adminEmails: [] },
      issuerAuthUser: { uid: 'issuer-1', email: 'owner@example.com', disabled: false },
      codeOverrides
    });

    await assert.rejects(redeem(harness), (error) => error.code === errorCode);
    assert.deepEqual(harness.firestore.committedWrites, []);
  });
}

test('preserves recipient-email matching before issuer authorization', async () => {
  const harness = createHarness({
    team: { ownerId: 'issuer-1', adminEmails: [] },
    issuerAuthUser: { uid: 'issuer-1', email: 'owner@example.com', disabled: false }
  });
  harness.context.auth.token.email = 'other@example.com';

  await assert.rejects(
    redeem(harness),
    (error) => error.code === 'permission-denied' && /sent to parent@example.com/.test(error.message)
  );
  assert.deepEqual(harness.firestore.committedWrites, []);
});
