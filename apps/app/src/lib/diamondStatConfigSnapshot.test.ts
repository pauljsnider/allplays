import { describe, expect, it } from 'vitest';

import {
  buildActivationPinnedDiamondPresentationConfig,
  buildDiamondStatConfigSnapshotHash,
  currentDiamondStatConfigMatchesActivation
} from './diamondStatConfigSnapshot';
import {
  aggregateCoverageAwareSeasonStats,
  getPublicDiamondStatCatalog
} from './adapters/legacyDiamondStatPresentation';

const teamId = 'team-1';
const configId = 'diamond-config';
const exactConfig = {
  id: configId,
  diamondPublicTeamStatIds: ['r'],
  statDefinitions: [
    { id: 'r', label: 'Runs', scope: 'team', visibility: 'public' },
    { id: 'hr', label: 'Home runs', scope: 'player', visibility: 'private' },
    { id: 'h', label: 'Hits', scope: 'player', visibility: 'public' }
  ]
};
const expectedHash = 'sha256:132b6e5c9787a4de6384899cc3d2ac2b78e1c20c41847634122016db7caca340';

function gameWithHash(snapshotHash = expectedHash) {
  return {
    trackingEngine: 'diamond-v2',
    statTrackerConfigId: configId,
    diamondStatConfigSnapshotHash: snapshotHash
  };
}

describe('Diamond stat config activation snapshot matching', () => {
  it('reproduces the server schema-v2 canonical snapshot hash', () => {
    expect(buildDiamondStatConfigSnapshotHash({ teamId, configId, config: exactConfig })).toBe(expectedHash);
    expect(currentDiamondStatConfigMatchesActivation({ teamId, game: gameWithHash(), config: exactConfig })).toBe(true);
  });

  it('uses the server code-point ordering for underscore stat IDs', () => {
    expect(buildDiamondStatConfigSnapshotHash({
      teamId,
      configId: 'underscore-order',
      config: {
        id: 'underscore-order',
        statDefinitions: [
          { id: 'a_', scope: 'player', visibility: 'public' },
          { id: 'a0', scope: 'player', visibility: 'private' }
        ]
      }
    })).toBe('sha256:87f387b952f627b521ebbc9fb749c3d6caa194a106c60510c68fff59313c3388');
  });

  it('keeps presentation-only edits compatible with the activation snapshot', () => {
    expect(currentDiamondStatConfigMatchesActivation({
      teamId,
      game: gameWithHash(),
      config: {
        ...exactConfig,
        columns: ['H', 'HR'],
        statDefinitions: exactConfig.statDefinitions.map((definition) => ({
          ...definition,
          label: `Updated ${definition.label}`,
          precision: 3,
          topStat: true
        }))
      }
    })).toBe(true);
  });

  it('allows a label edit but pins formula semantics and derived season coverage to the fixed catalog', () => {
    const activatedConfig = {
      id: configId,
      statDefinitions: [
        { id: 'ab', label: 'AB', scope: 'player', visibility: 'public' },
        { id: 'h', label: 'H', scope: 'player', visibility: 'public' },
        { id: 'avg', label: 'AVG', formula: 'H/AB', scope: 'player', visibility: 'public' }
      ]
    };
    const snapshotHash = buildDiamondStatConfigSnapshotHash({ teamId, configId, config: activatedConfig });
    const mutatedConfig = {
      ...activatedConfig,
      statDefinitions: activatedConfig.statDefinitions.map((definition) => (
        definition.id === 'avg'
          ? { ...definition, label: 'Batting average', formula: 'RBI/AB' }
          : definition
      ))
    };
    const game = {
      trackingEngine: 'diamond-v2',
      statTrackerConfigId: configId,
      diamondStatConfigSnapshotHash: snapshotHash,
      diamondProjectionStatus: 'current',
      diamondProjectionComplete: true,
      diamondProjectionRevision: 1
    };

    expect(currentDiamondStatConfigMatchesActivation({ teamId, game, config: mutatedConfig })).toBe(true);
    const presentationConfig = buildActivationPinnedDiamondPresentationConfig(mutatedConfig);
    const averageDefinition = getPublicDiamondStatCatalog(presentationConfig, 'player')
      .find((definition) => definition.id === 'avg');
    expect(averageDefinition).toMatchObject({
      id: 'avg',
      label: 'Batting average',
      formula: 'H/AB',
      visibility: 'public'
    });

    const projection = aggregateCoverageAwareSeasonStats({
      diamondGames: [{
        game,
        documents: [{
          id: 'player-1',
          data: {
            trackingEngine: 'diamond-v2',
            complete: true,
            sourceRevision: 1,
            stats: { ab: 2, h: 1 },
            derivedStats: { avg: 99 },
            observedStats: {},
            observedDerivedStats: {},
            statCoverage: { ab: 'complete', h: 'complete', avg: 'complete' },
            coverage: { batting: 'complete' }
          }
        }]
      }]
    });
    expect(projection.statsByPlayerId['player-1'].avg).toBe(0.5);
    expect(projection.presentationByPlayerId['player-1'].statCoverage.avg).toBe('complete');
  });

  it.each([
    ['public player stat made private', {
      ...exactConfig,
      statDefinitions: exactConfig.statDefinitions.map((definition) => (
        definition.id === 'h' ? { ...definition, visibility: 'private' } : definition
      ))
    }],
    ['private player stat made public', {
      ...exactConfig,
      statDefinitions: exactConfig.statDefinitions.map((definition) => (
        definition.id === 'hr' ? { ...definition, visibility: 'public' } : definition
      ))
    }],
    ['stat scope changed', {
      ...exactConfig,
      statDefinitions: exactConfig.statDefinitions.map((definition) => (
        definition.id === 'h' ? { ...definition, scope: 'team' } : definition
      ))
    }],
    ['public team allowlist changed', { ...exactConfig, diamondPublicTeamStatIds: ['h', 'r'] }]
  ])('rejects the mutable config when %s', (_label, config) => {
    expect(currentDiamondStatConfigMatchesActivation({ teamId, game: gameWithHash(), config })).toBe(false);
  });

  it.each([
    ['missing definitions', { id: configId }],
    ['duplicate definitions', {
      id: configId,
      statDefinitions: [
        { id: 'h', scope: 'player', visibility: 'public' },
        { id: 'h', scope: 'player', visibility: 'public' }
      ]
    }],
    ['coerced visibility', {
      id: configId,
      statDefinitions: [{ id: 'h', scope: 'player', visibility: 'PUBLIC' }]
    }],
    ['object-coerced scope', {
      id: configId,
      statDefinitions: [{
        id: 'h',
        scope: { toString: (): string => 'player' },
        visibility: 'public'
      }]
    }],
    ['unsafe public team stat id', {
      id: configId,
      statDefinitions: [{ id: 'h', scope: 'player', visibility: 'public' }],
      diamondPublicTeamStatIds: ['bad/id']
    }]
  ])('fails closed for %s', (_label, config) => {
    expect(buildDiamondStatConfigSnapshotHash({ teamId, configId, config })).toBeNull();
    expect(currentDiamondStatConfigMatchesActivation({ teamId, game: gameWithHash(), config })).toBe(false);
  });

  it('rejects a config document whose identity differs from the game reference', () => {
    expect(currentDiamondStatConfigMatchesActivation({
      teamId,
      game: gameWithHash(),
      config: { ...exactConfig, id: 'other-config' }
    })).toBe(false);
  });

  it.each([
    ['team ID', { teamId: 'team\u0000bad', configId }],
    ['team ID at the C0 upper boundary', { teamId: 'team\u001fbad', configId }],
    ['config ID', { teamId, configId: 'config\u007fbad' }]
  ])('rejects control characters in the %s exactly like the server', (_label, ids) => {
    expect(buildDiamondStatConfigSnapshotHash({ ...ids, config: exactConfig })).toBeNull();
  });

  it('accepts printable characters immediately outside the blocked ASCII control ranges', () => {
    expect(buildDiamondStatConfigSnapshotHash({
      teamId: 'team id',
      configId: 'config~id',
      config: exactConfig
    })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
