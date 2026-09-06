import { beforeEach, describe, expect, it, vi } from 'vitest';

const callable = vi.fn();
const firebaseMocks = vi.hoisted(() => ({
  functions: {},
  httpsCallable: vi.fn(() => callable)
}));
vi.mock('./adapters/legacyDiamondScorebookFirebase', () => firebaseMocks);

import { buildDiamondManagerStatsGameHeads, loadDiamondManagerStats } from './diamondManagerStatsService';

const instanceId = '00000000-0000-4000-8000-000000000001';
const checkpointHash = `sha256:${'a'.repeat(64)}`;
const configHash = `sha256:${'b'.repeat(64)}`;
const projectionHash = `sha256:${'c'.repeat(64)}`;

const game = {
  id: 'game-1',
  trackingEngine: 'diamond-v2',
  diamondProjectionStatus: 'current',
  diamondProjectionComplete: true,
  diamondScorebookInstanceId: instanceId,
  diamondProjectionRevision: 8,
  diamondProjectionCheckpointHash: checkpointHash,
  diamondStatConfigSnapshotHash: configHash,
  diamondProjectionHash: projectionHash
};

const privateDocument = {
  trackingEngine: 'diamond-v2',
  teamId: 'team-1',
  diamondGameId: 'game-1',
  playerId: 'p1',
  authoritative: true,
  complete: true,
  projectionSchemaVersion: 1,
  side: 'home',
  instanceId,
  diamondScorebookInstanceId: instanceId,
  projectionGeneration: instanceId,
  sourceRevision: 8,
  checkpointHash,
  statConfigSnapshotHash: configHash,
  projectionHash,
  stats: { h: 2 },
  observedStats: {},
  derivedStats: {},
  observedDerivedStats: {},
  statCoverage: { h: 'complete' },
  coverage: { batting: 'complete' }
};

const privateTeamDocument = {
  trackingEngine: 'diamond-v2',
  teamId: 'team-1',
  diamondGameId: 'game-1',
  complete: true,
  projectionSchemaVersion: 1,
  side: 'home',
  instanceId,
  diamondScorebookInstanceId: instanceId,
  projectionGeneration: instanceId,
  sourceRevision: 8,
  checkpointHash,
  statConfigSnapshotHash: configHash,
  projectionHash,
  stats: { r: 4 },
  observedStats: {},
  statCoverage: { r: 'complete' },
  coverage: { batting: 'complete' },
  inningLines: { home: [4], away: [0] }
};

describe('Diamond manager stats bulk reader', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends exact authoritative game heads in one callable and accepts a complete bounded response', async () => {
    callable.mockResolvedValue({ data: {
      schemaVersion: 1,
      trackingEngine: 'diamond-v2',
      visibility: 'manager-internal',
      status: 'complete',
      complete: true,
      truncated: false,
      requestedGameCount: 1,
      requestedPlayerCount: 1,
      expectedDocumentCount: 1,
      documentCount: 1,
      missingDocumentCount: 0,
      absenceConfirmed: false,
      expectedTeamDocumentCount: 1,
      teamDocumentCount: 1,
      missingTeamDocumentCount: 0,
      responseByteLimit: 7_000_000,
      responseByteCount: 1_024,
      documents: [{ gameId: 'game-1', playerId: 'p1', data: privateDocument }],
      teamDocuments: [{ gameId: 'game-1', data: privateTeamDocument }]
    } });
    const result = await loadDiamondManagerStats({ teamId: 'team-1', games: [game], playerIds: ['p1'] });
    expect(firebaseMocks.httpsCallable).toHaveBeenCalledWith({}, 'getDiamondManagerStats');
    expect(callable).toHaveBeenCalledWith({
      teamId: 'team-1',
      playerIds: ['p1'],
      gameHeads: [{
        gameId: 'game-1',
        instanceId,
        sourceRevision: 8,
        checkpointHash,
        statConfigSnapshotHash: configHash,
        projectionHash
      }]
    });
    expect(result.status).toBe('complete');
    expect(result.documentsByGameId.get('game-1')).toEqual([{ id: 'p1', data: privateDocument }]);
    expect(result.teamDocumentsByGameId.get('game-1')).toEqual(privateTeamDocument);
  });

  it('fails closed before the callable when any requested Diamond head is pending or malformed', async () => {
    expect(buildDiamondManagerStatsGameHeads([{ ...game, diamondProjectionComplete: false }])).toBeNull();
    await expect(loadDiamondManagerStats({
      teamId: 'team-1',
      games: [{ ...game, diamondProjectionCheckpointHash: '' }],
      playerIds: ['p1']
    })).resolves.toMatchObject({ status: 'partial', reason: 'invalid-or-incomplete-request' });
    expect(callable).not.toHaveBeenCalled();
  });

  it('does not accept truncated, duplicate, out-of-scope, or unreadable results as absence', async () => {
    callable.mockResolvedValueOnce({ data: {
      schemaVersion: 1,
      trackingEngine: 'diamond-v2',
      visibility: 'manager-internal',
      status: 'complete',
      complete: true,
      truncated: true,
      requestedGameCount: 1,
      requestedPlayerCount: 1,
      expectedDocumentCount: 1,
      documentCount: 0,
      missingDocumentCount: 1,
      absenceConfirmed: true,
      expectedTeamDocumentCount: 1,
      teamDocumentCount: 0,
      missingTeamDocumentCount: 1,
      responseByteLimit: 7_000_000,
      responseByteCount: 512,
      documents: [],
      teamDocuments: []
    } });
    await expect(loadDiamondManagerStats({ teamId: 'team-1', games: [game], playerIds: ['p1'] }))
      .resolves.toMatchObject({ status: 'partial', reason: 'private-read-incomplete' });

    callable.mockRejectedValueOnce(new Error('offline'));
    await expect(loadDiamondManagerStats({ teamId: 'team-1', games: [game], playerIds: ['p1'] }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'private-read-unavailable' });
  });

  it('rejects a corrupt team-stat generation alias instead of mixing projections', async () => {
    callable.mockResolvedValue({ data: {
      schemaVersion: 1,
      trackingEngine: 'diamond-v2',
      visibility: 'manager-internal',
      status: 'complete',
      complete: true,
      truncated: false,
      requestedGameCount: 1,
      requestedPlayerCount: 1,
      expectedDocumentCount: 1,
      documentCount: 1,
      missingDocumentCount: 0,
      absenceConfirmed: false,
      expectedTeamDocumentCount: 1,
      teamDocumentCount: 1,
      missingTeamDocumentCount: 0,
      responseByteLimit: 7_000_000,
      responseByteCount: 1_024,
      documents: [{ gameId: 'game-1', playerId: 'p1', data: privateDocument }],
      teamDocuments: [{ gameId: 'game-1', data: { ...privateTeamDocument, projectionGeneration: '00000000-0000-4000-8000-000000000099' } }]
    } });
    await expect(loadDiamondManagerStats({ teamId: 'team-1', games: [game], playerIds: ['p1'] }))
      .resolves.toMatchObject({ status: 'partial', reason: 'private-team-response-mismatch' });
  });

  it('rejects a same-revision private document from a different projection hash', async () => {
    callable.mockResolvedValue({ data: {
      schemaVersion: 1,
      trackingEngine: 'diamond-v2',
      visibility: 'manager-internal',
      status: 'complete',
      complete: true,
      truncated: false,
      requestedGameCount: 1,
      requestedPlayerCount: 1,
      expectedDocumentCount: 1,
      documentCount: 1,
      missingDocumentCount: 0,
      absenceConfirmed: false,
      expectedTeamDocumentCount: 1,
      teamDocumentCount: 1,
      missingTeamDocumentCount: 0,
      responseByteLimit: 7_000_000,
      responseByteCount: 1_024,
      documents: [{
        gameId: 'game-1',
        playerId: 'p1',
        data: { ...privateDocument, projectionHash: `sha256:${'d'.repeat(64)}` }
      }],
      teamDocuments: [{ gameId: 'game-1', data: privateTeamDocument }]
    } });

    await expect(loadDiamondManagerStats({ teamId: 'team-1', games: [game], playerIds: ['p1'] }))
      .resolves.toMatchObject({ status: 'partial', reason: 'private-response-mismatch' });
  });
});
