import { beforeEach, describe, expect, it, vi } from 'vitest';

const legacyParentToolsMocks = vi.hoisted(() => ({
  createFamilyShareToken: vi.fn(),
  listFamilyShareTokens: vi.fn(),
  revokeFamilyShareToken: vi.fn(),
  updateFamilyShareTokenCalendars: vi.fn()
}));

vi.mock('./adapters/legacyParentTools', () => legacyParentToolsMocks);

const profileServiceMocks = vi.hoisted(() => ({
  loadProfileDocument: vi.fn()
}));

// Exercise the real parent-scope merge while stubbing only the profile read:
// the service must hydrate from the Firestore profile before trusting the
// in-memory auth user (#5246).
vi.mock('./profileService', async () => {
  const { mergeParentAccessUser } = await import('./parentAccessScope');
  return {
    loadProfileDocument: profileServiceMocks.loadProfileDocument,
    hydrateParentAccessUser: async (user: any) => {
      if (!user?.uid) return user;
      const profile = await profileServiceMocks.loadProfileDocument(user.uid).catch(() => null);
      if (!profile) return user;
      return mergeParentAccessUser(user, profile);
    }
  };
});

import { createParentFamilyShare, getFamilyShareUrl, loadFamilyShareModel } from './parentFamilyShareService';

describe('parentFamilyShareService', () => {
  beforeEach(() => {
    legacyParentToolsMocks.createFamilyShareToken.mockReset();
    legacyParentToolsMocks.listFamilyShareTokens.mockReset();
    legacyParentToolsMocks.revokeFamilyShareToken.mockReset();
    legacyParentToolsMocks.updateFamilyShareTokenCalendars.mockReset();
    profileServiceMocks.loadProfileDocument.mockReset();
    profileServiceMocks.loadProfileDocument.mockResolvedValue({});
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

  it('does not include a revoked snapshot-only child in a new share (#5252)', async () => {
    profileServiceMocks.loadProfileDocument.mockResolvedValue({
      parentOf: [{ teamId: 'team-1', playerId: 'player-2' }],
      parentTeamIds: ['team-1'],
      parentPlayerKeys: ['team-1::player-2']
    });
    legacyParentToolsMocks.createFamilyShareToken.mockResolvedValue('token/current');

    await createParentFamilyShare({
      uid: 'parent-1',
      parentOf: [
        { teamId: 'team-1', playerId: 'player-1' },
        { teamId: 'team-1', playerId: 'player-2' }
      ],
      parentPlayerKeys: ['team-1::player-1', 'team-1::player-2']
    } as any, 'Grandma', []);

    expect(legacyParentToolsMocks.createFamilyShareToken).toHaveBeenCalledWith(
      'parent-1',
      [{ teamId: 'team-1', teamName: '', playerId: 'player-2', playerName: '', playerNumber: '', playerPhotoUrl: null }],
      'Grandma',
      []
    );
  });

  it('shares a child linked in the profile after sign-in (#5246)', async () => {
    profileServiceMocks.loadProfileDocument.mockResolvedValue({
      parentOf: [{ teamId: 'team-2', teamName: 'Hawks', playerId: 'player-2', playerName: 'Will Player' }],
      parentTeamIds: ['team-2'],
      parentPlayerKeys: ['team-2::player-2']
    });
    legacyParentToolsMocks.createFamilyShareToken.mockResolvedValue('token/two');
    legacyParentToolsMocks.listFamilyShareTokens.mockResolvedValue([]);

    await expect(createParentFamilyShare({ uid: 'parent-1', parentOf: [] } as any, 'Grandma', [])).resolves.toEqual({
      tokenId: 'token/two',
      url: 'https://allplays.ai/app/#/family/token%2Ftwo'
    });
    expect(legacyParentToolsMocks.createFamilyShareToken).toHaveBeenCalledWith(
      'parent-1',
      [expect.objectContaining({ teamId: 'team-2', playerId: 'player-2', playerName: 'Will Player' })],
      'Grandma',
      []
    );

    const model = await loadFamilyShareModel({ uid: 'parent-1', parentOf: [] } as any);
    expect(model.children).toEqual([
      expect.objectContaining({ teamId: 'team-2', playerId: 'player-2', playerName: 'Will Player' })
    ]);
  });
});
