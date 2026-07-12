import { beforeEach, describe, expect, it, vi } from 'vitest';

const legacyParentToolsMocks = vi.hoisted(() => ({
  createFamilyShareToken: vi.fn(),
  listFamilyShareTokens: vi.fn(),
  revokeFamilyShareToken: vi.fn(),
  updateFamilyShareTokenCalendars: vi.fn()
}));

vi.mock('./adapters/legacyParentTools', () => legacyParentToolsMocks);

import { createParentFamilyShare, getFamilyShareUrl, loadFamilyShareModel } from './parentFamilyShareService';

describe('parentFamilyShareService', () => {
  beforeEach(() => {
    legacyParentToolsMocks.createFamilyShareToken.mockReset();
    legacyParentToolsMocks.listFamilyShareTokens.mockReset();
    legacyParentToolsMocks.revokeFamilyShareToken.mockReset();
    legacyParentToolsMocks.updateFamilyShareTokenCalendars.mockReset();
  });

  it('creates app-native family share links for new tokens', async () => {
    legacyParentToolsMocks.createFamilyShareToken.mockResolvedValue('token/one');
    const user = {
      uid: 'parent-1',
      parentOf: [
        { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Sam Player' }
      ]
    } as any;

    await expect(createParentFamilyShare(user, 'Grandma', ['https://calendar.example.test/feed.ics'])).resolves.toEqual({
      tokenId: 'token/one',
      url: 'https://allplays.ai/app/#/family/token%2Fone'
    });
    expect(legacyParentToolsMocks.createFamilyShareToken).toHaveBeenCalledWith(
      'parent-1',
      [expect.objectContaining({ teamId: 'team-1', playerId: 'player-1' })],
      'Grandma',
      ['https://calendar.example.test/feed.ics']
    );
  });

  it('lists existing family share tokens with app viewer URLs', async () => {
    legacyParentToolsMocks.listFamilyShareTokens.mockResolvedValue([
      { id: 'token-1', label: 'Grandma', active: true, children: [{ teamId: 'team-1', playerId: 'player-1' }] }
    ]);

    await expect(loadFamilyShareModel({ uid: 'parent-1', parentOf: [] } as any)).resolves.toMatchObject({
      tokens: [
        { id: 'token-1', url: 'https://allplays.ai/app/#/family/token-1', childCount: 1, statusLabel: 'Active' }
      ]
    });
  });

  it('exposes a stable family share URL builder', () => {
    expect(getFamilyShareUrl('token value')).toBe('https://allplays.ai/app/#/family/token%20value');
  });
});
