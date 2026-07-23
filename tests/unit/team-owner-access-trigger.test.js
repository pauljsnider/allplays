import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { createTeamOwnerAccessSyncHandler } = require('../../functions/team-owner-access-core.cjs');
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
});
