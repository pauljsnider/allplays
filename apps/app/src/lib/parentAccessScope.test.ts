import { describe, expect, it } from 'vitest';
import { mergeParentAccessUser, mergeParentOfLinks, mergeParentScopeStrings } from './parentAccessScope';

const madisonLink = { teamId: 'team-1', playerId: 'player-1', teamName: 'Bears', playerName: 'Madison Player' };
const willLink = { teamId: 'team-2', playerId: 'player-2', teamName: 'Hawks', playerName: 'Will Player' };

describe('mergeParentScopeStrings', () => {
  it('unions both stores and dedupes', () => {
    expect(mergeParentScopeStrings(['team-1', 'team-2'], ['team-2', 'team-3'])).toEqual(['team-1', 'team-2', 'team-3']);
  });

  it('ignores blank and non-array values', () => {
    expect(mergeParentScopeStrings(undefined, ['team-1', '', '  '])).toEqual(['team-1']);
  });
});

describe('mergeParentOfLinks', () => {
  it('keeps a link present in only one store', () => {
    expect(mergeParentOfLinks([madisonLink], [willLink])).toEqual([madisonLink, willLink]);
  });

  it('dedupes the same child link across stores', () => {
    expect(mergeParentOfLinks([madisonLink], [{ ...madisonLink, teamName: 'Bears (stale)' }])).toEqual([madisonLink]);
  });

  it('drops links without a team or player', () => {
    expect(mergeParentOfLinks([{ teamId: 'team-1' }, { playerId: 'player-9' }], [])).toEqual([]);
  });
});

describe('mergeParentAccessUser', () => {
  it('unions a profile link created after sign-in with the in-memory user (#5246)', () => {
    const user = {
      uid: 'parent-1',
      parentOf: [madisonLink],
      parentTeamIds: ['team-1'],
      parentPlayerKeys: ['team-1::player-1'],
      coachOf: []
    } as any;
    const profile = {
      parentOf: [willLink],
      parentTeamIds: ['team-2'],
      parentPlayerKeys: ['team-2::player-2']
    };

    const merged = mergeParentAccessUser(user, profile);

    expect(merged?.parentOf).toEqual([madisonLink, willLink]);
    expect(merged?.parentTeamIds).toEqual(['team-1', 'team-2']);
    expect(merged?.parentPlayerKeys).toEqual(['team-1::player-1', 'team-2::player-2']);
  });

  it('keeps an auth-user link when the stored profile is stale (#5246)', () => {
    const user = {
      uid: 'parent-1',
      parentOf: [willLink],
      parentTeamIds: ['team-2'],
      parentPlayerKeys: ['team-2::player-2'],
      coachOf: []
    } as any;
    const profile = {
      parentOf: [madisonLink],
      parentTeamIds: ['team-1'],
      parentPlayerKeys: ['team-1::player-1']
    };

    const merged = mergeParentAccessUser(user, profile);

    expect(merged?.parentOf).toEqual([willLink, madisonLink]);
    expect(merged?.parentTeamIds).toEqual(['team-2', 'team-1']);
  });

  it('returns the user unchanged without a uid or profile', () => {
    const user = { uid: 'parent-1', parentOf: [madisonLink] } as any;
    expect(mergeParentAccessUser(user, null)).toBe(user);
    expect(mergeParentAccessUser(null, { parentOf: [willLink] })).toBeNull();
  });
});
