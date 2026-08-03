import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
  createLegacyTeamOwnerAuthSyncHandler,
  createLegacyTeamOwnerReconciliationHandler,
  createTeamOwnerAccessSyncHandler
} = require('../../functions/team-owner-access-core.cjs');
const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('team owner access trigger', () => {
  it('atomically grants the created team and coach role to the owner', async () => {
    const set = vi.fn(async () => {});
    const fieldValue = {
      arrayUnion: (...values) => ({ arrayUnion: values }),
      serverTimestamp: () => ({ serverTimestamp: true })
    };
    const handler = createTeamOwnerAccessSyncHandler({
      firestore: { doc: () => ({ set }) },
      fieldValue
    });

    await expect(handler(
      { id: 'vipers', data: () => ({ ownerId: 'owner-1' }) },
      { params: { teamId: 'vipers' } }
    )).resolves.toEqual({ ownerId: 'owner-1', teamId: 'vipers' });

    expect(set).toHaveBeenCalledWith({
      coachOf: { arrayUnion: ['vipers'] },
      roles: { arrayUnion: ['coach'] },
      updatedAt: { serverTimestamp: true }
    }, { merge: true });
  });

  it('does nothing for an ownerless team', async () => {
    const set = vi.fn();
    const handler = createTeamOwnerAccessSyncHandler({
      firestore: { doc: () => ({ set }) },
      fieldValue: {
        arrayUnion: vi.fn(),
        serverTimestamp: vi.fn()
      }
    });

    await expect(handler(
      { id: 'team-1', data: () => ({}) },
      { params: { teamId: 'team-1' } }
    )).resolves.toBeNull();
    expect(set).not.toHaveBeenCalled();
  });

  it('propagates a transient write failure and succeeds when the event is retried', async () => {
    const transientError = new Error('Firestore temporarily unavailable');
    const set = vi.fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce();
    const handler = createTeamOwnerAccessSyncHandler({
      firestore: { doc: () => ({ set }) },
      fieldValue: {
        arrayUnion: (...values) => ({ arrayUnion: values }),
        serverTimestamp: () => ({ serverTimestamp: true })
      }
    });
    const snapshot = { id: 'vipers', data: () => ({ ownerId: 'owner-1' }) };
    const context = { params: { teamId: 'vipers' } };

    await expect(handler(snapshot, context)).rejects.toBe(transientError);
    await expect(handler(snapshot, context)).resolves.toEqual({
      ownerId: 'owner-1',
      teamId: 'vipers'
    });
    expect(set).toHaveBeenCalledTimes(2);
  });

  it('wires the handler to team creation in Cloud Functions', () => {
    expect(functionsSource).toContain("exports.syncTeamOwnerAccessOnCreate = functions\n  .runWith({ failurePolicy: true })\n  .firestore");
    expect(functionsSource).toContain(".document('teams/{teamId}')");
    expect(functionsSource).toContain('.onCreate(createTeamOwnerAccessSyncHandler({');
  });

  it('canonically binds owner-email-only teams when the matching Auth user is created', async () => {
    const teamRef = { path: 'teams/legacy-team' };
    const teamDoc = { id: 'legacy-team', ref: teamRef };
    const update = vi.fn();
    const set = vi.fn();
    const transaction = {
      get: vi.fn(async () => ({
        exists: true,
        data: () => ({ ownerEmail: 'Owner@Example.com' })
      })),
      update,
      set
    };
    const collection = vi.fn(() => ({
      where: vi.fn(() => ({ get: vi.fn(async () => ({ docs: [teamDoc] })) }))
    }));
    const firestore = {
      collection,
      doc: vi.fn((path) => ({ path })),
      runTransaction: vi.fn(async (callback) => callback(transaction))
    };
    const fieldValue = {
      arrayUnion: (...values) => ({ arrayUnion: values }),
      serverTimestamp: () => ({ serverTimestamp: true })
    };
    const handler = createLegacyTeamOwnerAuthSyncHandler({ firestore, fieldValue });

    await expect(handler({ uid: 'owner-1', email: 'Owner@Example.com' })).resolves.toEqual({
      ownerId: 'owner-1',
      teamIds: ['legacy-team']
    });
    expect(update).toHaveBeenCalledWith(teamRef, {
      ownerId: 'owner-1',
      ownerIdBackfilledAt: { serverTimestamp: true }
    });
    expect(set).toHaveBeenCalledWith({ path: 'users/owner-1' }, {
      coachOf: { arrayUnion: ['legacy-team'] },
      roles: { arrayUnion: ['coach'] },
      updatedAt: { serverTimestamp: true }
    }, { merge: true });
  });

  it('never binds owner-email-only teams for a disabled Auth account', async () => {
    const firestore = {
      collection: vi.fn(),
      doc: vi.fn(),
      runTransaction: vi.fn()
    };
    const handler = createLegacyTeamOwnerAuthSyncHandler({
      firestore,
      fieldValue: { arrayUnion: vi.fn(), serverTimestamp: vi.fn() }
    });

    await expect(handler({
      uid: 'disabled-owner',
      email: 'disabled@example.com',
      disabled: true
    })).resolves.toBeNull();
    expect(firestore.collection).not.toHaveBeenCalled();
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('never lets a late legacy alias overwrite canonical ownership', async () => {
    const teamRef = { path: 'teams/canonical-team' };
    const update = vi.fn();
    const transaction = {
      get: vi.fn(async () => ({
        exists: true,
        data: () => ({ ownerId: 'current-owner', ownerEmail: 'former@example.com' })
      })),
      update,
      set: vi.fn()
    };
    const firestore = {
      collection: () => ({ where: () => ({ get: async () => ({ docs: [{ id: 'canonical-team', ref: teamRef }] }) }) }),
      doc: vi.fn(),
      runTransaction: vi.fn(async (callback) => callback(transaction))
    };
    const handler = createLegacyTeamOwnerAuthSyncHandler({
      firestore,
      fieldValue: { arrayUnion: vi.fn(), serverTimestamp: vi.fn() }
    });

    await expect(handler({ uid: 'former-owner', email: 'former@example.com' })).resolves.toEqual({
      ownerId: 'former-owner',
      teamIds: []
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('never binds an Auth signup when legacy owner aliases conflict', async () => {
    const teamRef = { path: 'teams/ambiguous-team' };
    const update = vi.fn();
    const set = vi.fn();
    const transaction = {
      get: vi.fn(async () => ({
        exists: true,
        data: () => ({
          ownerEmail: 'intended@example.com',
          ownerEmailLower: 'stale@example.com'
        })
      })),
      update,
      set
    };
    const firestore = {
      collection: () => ({
        where: () => ({ get: async () => ({ docs: [{ id: 'ambiguous-team', ref: teamRef }] }) })
      }),
      doc: vi.fn(),
      runTransaction: vi.fn(async (callback) => callback(transaction))
    };
    const handler = createLegacyTeamOwnerAuthSyncHandler({
      firestore,
      fieldValue: { arrayUnion: vi.fn(), serverTimestamp: vi.fn() }
    });

    await expect(handler({ uid: 'stale-owner', email: 'stale@example.com' })).resolves.toEqual({
      ownerId: 'stale-owner',
      teamIds: []
    });
    expect(update).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('reconciles re-enabled legacy owners with bounded team and Auth lookups', async () => {
    const makeDoc = (id, data) => ({ id, data: () => data });
    const pages = [
      [
        makeDoc('canonical', { ownerId: 'current-owner', ownerEmail: 'canonical@example.com' }),
        makeDoc('enabled', { ownerEmail: 'enabled@example.com' })
      ],
      [
        makeDoc('disabled', { ownerEmailLower: 'disabled@example.com' }),
        makeDoc('conflicting', {
          ownerEmail: 'first@example.com',
          ownerEmailLower: 'second@example.com'
        })
      ],
      [makeDoc('missing', { ownerEmail: 'missing@example.com' })]
    ];
    const queryCalls = [];
    const makeQuery = (pageIndex = 0) => ({
      select: vi.fn(() => makeQuery(pageIndex)),
      orderBy: vi.fn(() => makeQuery(pageIndex)),
      limit: vi.fn(() => makeQuery(pageIndex)),
      startAfter: vi.fn((cursor) => {
        queryCalls.push({ type: 'startAfter', cursor: cursor.id });
        const cursorPageIndex = pages.findIndex((page) => (
          page.some((teamDoc) => teamDoc.id === cursor.id)
        ));
        return makeQuery(cursorPageIndex + 1);
      }),
      get: vi.fn(async () => {
        queryCalls.push({ type: 'get', pageIndex });
        return { docs: pages[pageIndex] || [] };
      })
    });
    const auth = {
      getUserByEmail: vi.fn(async (email) => {
        if (email === 'enabled@example.com') {
          return { uid: 'enabled-owner', email, disabled: false };
        }
        if (email === 'disabled@example.com') {
          return { uid: 'disabled-owner', email, disabled: true };
        }
        throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
      })
    };
    const syncAuthUser = vi.fn(async (authUser) => ({
      ownerId: authUser.uid,
      teamIds: ['enabled']
    }));
    const handler = createLegacyTeamOwnerReconciliationHandler({
      firestore: { collection: vi.fn(() => makeQuery()) },
      auth,
      documentIdField: { documentId: true },
      syncAuthUser,
      batchSize: 2,
      concurrency: 2
    });

    await expect(handler()).resolves.toEqual({
      scanned: 5,
      candidateAliases: 3,
      resolvedUsers: 1,
      boundTeamIds: ['enabled']
    });
    expect(auth.getUserByEmail).toHaveBeenCalledTimes(3);
    expect(syncAuthUser).toHaveBeenCalledOnce();
    expect(syncAuthUser).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'enabled-owner'
    }));
    expect(queryCalls.filter(({ type }) => type === 'get')).toHaveLength(3);
  });

  it('wires retryable Auth creation and scheduled legacy-owner reconciliation', () => {
    expect(functionsSource).toContain('exports.syncLegacyTeamOwnershipOnAuthCreate = functions');
    expect(functionsSource).toContain('const legacyTeamOwnerAuthSyncHandler = createLegacyTeamOwnerAuthSyncHandler({');
    expect(functionsSource).toContain('.auth\n  .user()\n  .onCreate(legacyTeamOwnerAuthSyncHandler);');
    expect(functionsSource).toContain('exports.reconcileLegacyTeamOwnership = functions');
    expect(functionsSource).toContain(".schedule('every 24 hours')");
    expect(functionsSource).toContain('.onRun(createLegacyTeamOwnerReconciliationHandler({');
  });
});
