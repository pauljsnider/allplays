// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const legacyParentToolsMocks = vi.hoisted(() => ({
  createFamilyShareToken: vi.fn(),
  listFamilyShareTokens: vi.fn()
}));

vi.mock('./adapters/legacyParentTools', () => ({
  createFamilyShareToken: legacyParentToolsMocks.createFamilyShareToken,
  listFamilyShareTokens: legacyParentToolsMocks.listFamilyShareTokens
}));
vi.mock('./authService', () => ({
  firebaseAuth: { currentUser: null },
  getNativeAuthIdToken: vi.fn()
}));
vi.mock('./homeService', () => ({ loadParentScheduleSummary: vi.fn() }));
vi.mock('./parentFeeRecipientsService', () => ({ listParentTeamFeeRecipientsForApp: vi.fn() }));

import { createParentFamilyShare, loadFamilyShareModel } from './parentToolsService';

describe('parent tools canonical family scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    legacyParentToolsMocks.listFamilyShareTokens.mockResolvedValue([]);
    legacyParentToolsMocks.createFamilyShareToken.mockResolvedValue('share-1');
  });

  it('does not show or write a stale sibling excluded by canonical player keys', async () => {
    const user = {
      uid: 'parent-1',
      parentTeamIds: ['team-1'],
      parentPlayerKeys: ['team-1::p1'],
      parentOf: [
        { teamId: 'team-1', teamName: 'Bears', playerId: 'p1', playerName: 'Current Player' },
        { teamId: 'team-1', teamName: 'Bears', playerId: 'p2', playerName: 'Revoked Sibling' }
      ]
    } as any;

    await expect(loadFamilyShareModel(user)).resolves.toMatchObject({
      children: [expect.objectContaining({ playerId: 'p1', playerName: 'Current Player' })]
    });
    await createParentFamilyShare(user, 'Grandparent');

    expect(legacyParentToolsMocks.createFamilyShareToken).toHaveBeenCalledWith(
      'parent-1',
      [expect.objectContaining({ playerId: 'p1', playerName: 'Current Player' })],
      'Grandparent',
      []
    );
    expect(legacyParentToolsMocks.createFamilyShareToken.mock.calls[0][1]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ playerId: 'p2' })])
    );
  });

  it('preserves a genuine legacy parentOf-only account', async () => {
    const legacyUser = {
      uid: 'legacy-parent',
      parentOf: [{ teamId: 'team-1', playerId: 'p1', playerName: 'Legacy Player' }]
    } as any;

    await expect(loadFamilyShareModel(legacyUser)).resolves.toMatchObject({
      children: [expect.objectContaining({ playerId: 'p1' })]
    });
    await createParentFamilyShare(legacyUser, 'Legacy share');
    expect(legacyParentToolsMocks.createFamilyShareToken).toHaveBeenCalledWith(
      'legacy-parent',
      [expect.objectContaining({ playerId: 'p1' })],
      'Legacy share',
      []
    );
  });
});
