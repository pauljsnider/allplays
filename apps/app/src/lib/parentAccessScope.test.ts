import { describe, expect, it } from 'vitest';

import {
  applyCurrentParentAccessProfile,
  collectCanonicalParentAccessLinks,
  isCanonicalParentPlayerLinked,
  isCanonicalParentTeamLinked
} from './parentAccessScope';

describe('canonical parent access scope', () => {
  const staleParentOf = [
    { teamId: 'team-1', playerId: 'p1', playerName: 'Player One' },
    { teamId: 'team-1', playerId: 'p2', playerName: 'Player Two' }
  ];

  it('uses canonical team and player fields as exact intersections while retaining allowed metadata', () => {
    const links = collectCanonicalParentAccessLinks({
      parentTeamIds: ['team-1'],
      parentPlayerKeys: ['team-1::p1'],
      parentOf: staleParentOf
    });

    expect(links).toEqual([
      expect.objectContaining({ teamId: 'team-1', playerId: 'p1', playerName: 'Player One' })
    ]);
    expect(isCanonicalParentPlayerLinked({ parentPlayerKeys: ['team-1::p1'], parentOf: staleParentOf }, 'team-1', 'p2')).toBe(false);
  });

  it.each([
    { parentPlayerKeys: [] },
    { parentPlayerKeys: null },
    { parentPlayerKeys: ['malformed'] },
    { parentTeamIds: [] },
    { parentTeamIds: null },
    { parentTeamIds: { stale: 'team-1' } }
  ])('treats a present empty or malformed canonical field as revocation: %o', (canonical) => {
    const profile = { ...canonical, parentOf: staleParentOf };
    expect(collectCanonicalParentAccessLinks(profile)).toEqual([]);
    expect(isCanonicalParentTeamLinked(profile, 'team-1')).toBe(false);
  });

  it('does not coerce numeric or object identifiers into parent authority', () => {
    expect(collectCanonicalParentAccessLinks({
      parentTeamIds: [123, { toString: () => 'team-1' }, 'team-1'],
      parentPlayerKeys: [456, { toString: () => 'team-1::p1' }, 'team-1::p1'],
      parentOf: [
        { teamId: 123, playerId: 'p1' },
        { teamId: 'team-1', playerId: { toString: () => 'p1' } },
        { teamId: 'team-1', playerId: 'p1', playerName: 'Player One' }
      ]
    } as any)).toEqual([
      expect.objectContaining({ teamId: 'team-1', playerId: 'p1', playerName: 'Player One' })
    ]);

    expect(collectCanonicalParentAccessLinks({
      parentTeamIds: [123],
      parentPlayerKeys: [456],
      parentOf: [{ teamId: 123, playerId: 456 }]
    } as any)).toEqual([]);
  });

  it('does not treat a team-only canonical grant as child authority', () => {
    expect(collectCanonicalParentAccessLinks({
      parentTeamIds: ['team-1'],
      parentOf: staleParentOf
    })).toEqual([]);
    expect(isCanonicalParentTeamLinked({ parentTeamIds: ['team-1'], parentOf: staleParentOf }, 'team-1')).toBe(true);
  });

  it('never restores a missing current player grant field from the stale auth shell', () => {
    const staleUser = {
      uid: 'parent-1',
      parentTeamIds: ['team-1'],
      parentPlayerKeys: ['team-1::p1', 'team-1::p2'],
      parentOf: staleParentOf
    } as any;
    const profile = {
      parentTeamIds: ['team-1'],
      parentOf: staleParentOf
    };

    expect(collectCanonicalParentAccessLinks(profile, staleUser)).toEqual([]);
    expect(applyCurrentParentAccessProfile(staleUser, profile)).toMatchObject({
      parentTeamIds: ['team-1'],
      parentPlayerKeys: [],
      parentOf: []
    });
  });

  it('derives current team scope from player keys instead of restoring stale teams', () => {
    const staleUser = {
      uid: 'parent-1',
      parentTeamIds: ['team-1', 'team-revoked'],
      parentPlayerKeys: ['team-1::p1', 'team-revoked::p2'],
      parentOf: [
        ...staleParentOf,
        { teamId: 'team-revoked', playerId: 'p2', playerName: 'Revoked Team Child' }
      ]
    } as any;
    const profile = { parentPlayerKeys: ['team-1::p1'] };

    expect(collectCanonicalParentAccessLinks(profile, staleUser)).toEqual([
      expect.objectContaining({ teamId: 'team-1', playerId: 'p1' })
    ]);
    expect(applyCurrentParentAccessProfile(staleUser, profile)).toMatchObject({
      parentTeamIds: ['team-1'],
      parentPlayerKeys: ['team-1::p1'],
      parentOf: [expect.objectContaining({ teamId: 'team-1', playerId: 'p1' })]
    });
  });

  it('filters current player keys through an explicitly narrower current team scope', () => {
    const user = {
      uid: 'parent-1',
      parentTeamIds: ['team-1', 'team-revoked'],
      parentPlayerKeys: ['team-1::p1', 'team-revoked::p2'],
      parentOf: [
        { teamId: 'team-1', playerId: 'p1' },
        { teamId: 'team-revoked', playerId: 'p2' }
      ]
    } as any;

    expect(applyCurrentParentAccessProfile(user, {
      parentTeamIds: ['team-1'],
      parentPlayerKeys: ['team-1::p1', 'team-revoked::p2']
    })).toMatchObject({
      parentTeamIds: ['team-1'],
      parentPlayerKeys: ['team-1::p1'],
      parentOf: [expect.objectContaining({ teamId: 'team-1', playerId: 'p1' })]
    });
  });

  it('preserves legacy parentOf authority only from the current profile', () => {
    const staleUser = {
      uid: 'parent-1',
      parentTeamIds: ['team-revoked'],
      parentPlayerKeys: ['team-revoked::p2'],
      parentOf: [{ teamId: 'team-revoked', playerId: 'p2' }]
    } as any;
    const applied = applyCurrentParentAccessProfile(staleUser, {
      parentOf: [{ teamId: 'team-1', playerId: 'p1', playerName: 'Legacy Child' }]
    });

    expect(applied).not.toHaveProperty('parentTeamIds');
    expect(applied).not.toHaveProperty('parentPlayerKeys');
    expect(applied.parentOf).toEqual([
      expect.objectContaining({ teamId: 'team-1', playerId: 'p1', playerName: 'Legacy Child' })
    ]);
  });

  it('rejects slash-bearing and overlength team or player identifiers', () => {
    const overlong = 'x'.repeat(129);
    expect(collectCanonicalParentAccessLinks({
      parentPlayerKeys: [
        'team/one::p1',
        'team-1::player/one',
        `${overlong}::p1`,
        `team-1::${overlong}`
      ],
      parentOf: [
        { teamId: 'team/one', playerId: 'p1' },
        { teamId: 'team-1', playerId: 'player/one' },
        { teamId: overlong, playerId: 'p1' },
        { teamId: 'team-1', playerId: overlong }
      ]
    })).toEqual([]);
  });

  it('falls back to legacy parentOf only when canonical properties are absent', () => {
    expect(collectCanonicalParentAccessLinks({ parentOf: staleParentOf })).toHaveLength(2);
  });

  it('replaces stale user scope whenever the current profile owns a canonical field', () => {
    const user = {
      uid: 'parent-1',
      email: 'parent@example.com',
      displayName: 'Parent',
      roles: ['parent'],
      parentOf: staleParentOf,
      parentTeamIds: ['team-1'],
      parentPlayerKeys: ['team-1::p1', 'team-1::p2']
    } as any;

    expect(applyCurrentParentAccessProfile(user, {
      parentTeamIds: ['team-1'],
      parentPlayerKeys: ['team-1::p1']
    })).toMatchObject({
      parentOf: [expect.objectContaining({ teamId: 'team-1', playerId: 'p1' })],
      parentPlayerKeys: ['team-1::p1'],
      parentTeamIds: ['team-1']
    });
    expect(applyCurrentParentAccessProfile(user, { parentPlayerKeys: null }).parentPlayerKeys).toEqual([]);
  });
});
