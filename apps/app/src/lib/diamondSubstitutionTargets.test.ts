import { describe, expect, it } from 'vitest';
import type { DiamondScorebookSnapshot } from './diamondScorebookService';
import { getDiamondSubstitutionTargets, resolveDiamondSubstitutionTarget } from './diamondSubstitutionTargets';

function snapshot(): DiamondScorebookSnapshot {
  return {
    lineups: { home: [{ slot: 1, playerId: 'dp', battingRole: 'dp', starterPlayerId: 'dp' }], away: [] },
    defense: { home: { P: { playerId: 'flex', name: 'Flex Pitcher' } }, away: {} },
    lineupPersonnel: {
      home: {
        dhDefense: null,
        flexDefense: null,
        dpFlex: { dpPlayerId: 'dp', flexPlayerId: 'flex', dpBattingSlot: 1, flexDefensivePosition: 'P' }
      },
      away: { dhDefense: null, flexDefense: null, dpFlex: null }
    }
  } as unknown as DiamondScorebookSnapshot;
}

describe('role-aware Diamond substitution targets', () => {
  it('retains independent starter history after the DH role has ended', () => {
    const value = snapshot();
    value.lineupPersonnel!.home.dpFlex = null;
    value.lineupPersonnel!.home.dhTerminated = true;
    value.lineupPersonnel!.home.dhDefense = {
      slot: 1,
      playerId: 'old-reliever',
      name: 'Old reliever',
      starterPlayerId: 'original-pitcher',
      starterReentriesUsed: 1
    };
    value.lineups.home[0] = {
      slot: 1,
      playerId: 'current-batter',
      name: 'Current batter',
      battingRole: 'regular',
      starterPlayerId: 'original-dh'
    };
    value.defense.home.P = { playerId: 'current-batter', name: 'Current batter' };
    expect(getDiamondSubstitutionTargets(value, 'home').map((target) => target.key)).toEqual(['1', 'dh-retired:1']);
    expect(resolveDiamondSubstitutionTarget(value, 'home', 1, 'current-batter', 'original-pitcher')?.entry.starterReentriesUsed).toBe(1);
    expect(resolveDiamondSubstitutionTarget(value, 'home', 1, 'current-batter', 'original-dh')?.role).toBe('batting');
  });

  it('exposes an initial FLEX defender without changing the batting order', () => {
    const value = snapshot();
    expect(getDiamondSubstitutionTargets(value, 'home').map(({ key }) => key)).toEqual(['1', 'flex:1']);
    expect(resolveDiamondSubstitutionTarget(value, 'home', 1, 'flex', 'bench', 'P')).toMatchObject({
      role: 'flex',
      entry: { starterPlayerId: 'flex' },
      defensivePosition: 'P'
    });
    expect(value.lineups.home[0].playerId).toBe('dp');
  });

  it('keeps bench FLEX re-entry history distinct from DP history', () => {
    const value = snapshot();
    value.lineupPersonnel!.home.flexDefense = {
      slot: 1,
      playerId: 'flex-bench',
      name: 'Bench FLEX',
      starterPlayerId: 'flex',
      starterReentriesUsed: 1,
      substitutions: ['flex-bench']
    };
    value.lineupPersonnel!.home.dpFlex = { ...value.lineupPersonnel!.home.dpFlex!, flexPlayerId: 'flex-bench' };
    value.defense.home.P = { playerId: 'flex-bench', name: 'Bench FLEX' };
    expect(resolveDiamondSubstitutionTarget(value, 'home', 1, 'flex-bench', 'flex')).toMatchObject({
      role: 'flex',
      entry: { starterPlayerId: 'flex', starterReentriesUsed: 1 }
    });
  });

  it('distinguishes DP taking FLEX defense from DP returning only to bat', () => {
    const value = snapshot();
    expect(resolveDiamondSubstitutionTarget(value, 'home', 1, 'flex', 'dp', 'P')?.role).toBe('flex');
    value.lineups.home[0] = { ...value.lineups.home[0]!, playerId: 'flex' };
    expect(resolveDiamondSubstitutionTarget(value, 'home', 1, 'flex', 'dp')?.role).toBe('batting');
  });

  it('restores FLEX from DP defense using FLEX history and current defender identity', () => {
    const value = snapshot();
    value.defense.home.P = { playerId: 'dp', name: 'Designated Player' };
    value.lineupPersonnel!.home.flexDefense = { slot: 1, playerId: 'flex', name: 'FLEX', starterPlayerId: 'flex', starterReentriesUsed: 0 };
    expect(resolveDiamondSubstitutionTarget(value, 'home', 1, 'dp', 'flex', 'P')).toMatchObject({
      role: 'flex',
      entry: { playerId: 'dp', name: 'Designated Player', starterPlayerId: 'flex' }
    });
  });

  it('infers only a unique initial DH defender and preserves later defensive history', () => {
    const value = snapshot();
    value.lineupPersonnel!.home.dpFlex = null;
    value.lineups.home[0] = { slot: 1, playerId: 'dh', name: 'DH', battingRole: 'dh' };
    expect(getDiamondSubstitutionTargets(value, 'home')[1]).toMatchObject({
      role: 'dh',
      entry: { playerId: 'flex', starterPlayerId: 'flex' }
    });
    value.defense.home.C = { playerId: 'other-defender', name: 'Other defender' };
    expect(getDiamondSubstitutionTargets(value, 'home')).toHaveLength(1);
    value.lineupPersonnel!.home.dhDefense = {
      slot: 1,
      playerId: 'flex',
      name: 'Defender',
      starterPlayerId: 'starter-pitcher',
      starterReentriesUsed: 1
    };
    expect(getDiamondSubstitutionTargets(value, 'home')[1]).toMatchObject({
      role: 'dh',
      entry: { starterPlayerId: 'starter-pitcher', starterReentriesUsed: 1 }
    });
  });
});
