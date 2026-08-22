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

  it('keeps legacy parentOf-only hydrated users eligible for family sharing', async () => {
    legacyParentToolsMocks.createFamilyShareToken.mockResolvedValue('legacy-token');
    legacyParentToolsMocks.listFamilyShareTokens.mockResolvedValue([]);
    const legacyHydratedUser = {
      uid: 'parent-legacy',
      parentOf: [
        { teamId: 'team-legacy', teamName: 'Legacy Team', playerId: 'player-legacy', playerName: 'Legacy Child' }
      ]
    } as any;

    await expect(loadFamilyShareModel(legacyHydratedUser)).resolves.toMatchObject({
      children: [expect.objectContaining({ teamId: 'team-legacy', playerId: 'player-legacy' })]
    });
    await createParentFamilyShare(legacyHydratedUser, 'Grandpa');

    expect(legacyParentToolsMocks.createFamilyShareToken).toHaveBeenCalledWith(
      'parent-legacy',
      [expect.objectContaining({ teamId: 'team-legacy', playerId: 'player-legacy' })],
      'Grandpa',
      []
    );
  });

  it('never writes a stale same-team sibling outside current canonical scope', async () => {
    legacyParentToolsMocks.createFamilyShareToken.mockResolvedValue('token-safe');
    legacyParentToolsMocks.listFamilyShareTokens.mockResolvedValue([]);
    const user = {
      uid: 'parent-1',
      parentTeamIds: ['team-1'],
      parentPlayerKeys: ['team-1::player-1'],
      parentOf: [
        { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Current Child' },
        { teamId: 'team-1', teamName: 'Bears', playerId: 'player-2', playerName: 'Revoked Sibling' }
      ]
    } as any;

    await expect(loadFamilyShareModel(user)).resolves.toMatchObject({
      children: [expect.objectContaining({ playerId: 'player-1', playerName: 'Current Child' })]
    });
    await createParentFamilyShare(user, 'Grandma');

    expect(legacyParentToolsMocks.createFamilyShareToken).toHaveBeenCalledWith(
      'parent-1',
      [expect.objectContaining({ teamId: 'team-1', playerId: 'player-1' })],
      'Grandma',
      []
    );
    expect(legacyParentToolsMocks.createFamilyShareToken.mock.calls[0]?.[1]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ playerId: 'player-2' })])
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
