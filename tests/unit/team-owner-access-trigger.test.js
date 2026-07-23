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

  it('wires the handler to team creation in Cloud Functions', () => {
    expect(functionsSource).toContain("exports.syncTeamOwnerAccessOnCreate = functions.firestore");
    expect(functionsSource).toContain(".document('teams/{teamId}')");
    expect(functionsSource).toContain('.onCreate(createTeamOwnerAccessSyncHandler({');
  });
});
