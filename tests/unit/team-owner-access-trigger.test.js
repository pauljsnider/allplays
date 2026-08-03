import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
  createLegacyTeamOwnerAuthSyncHandler,
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

  it('wires retryable Auth creation binding before legacy list compatibility is removed', () => {
    expect(functionsSource).toContain('exports.syncLegacyTeamOwnershipOnAuthCreate = functions');
    expect(functionsSource).toContain('.auth\n  .user()\n  .onCreate(createLegacyTeamOwnerAuthSyncHandler({');
  });
});
