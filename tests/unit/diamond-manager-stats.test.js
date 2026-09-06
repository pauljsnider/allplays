import { describe, expect, it, vi } from 'vitest';

import {
    buildDiamondManagerStatsGameHeads,
    loadDiamondManagerStats
} from '../../js/diamond-manager-stats.js';

const instanceId = '00000000-0000-4000-8000-000000000001';
const checkpointHash = `sha256:${'a'.repeat(64)}`;
const configHash = `sha256:${'b'.repeat(64)}`;
const projectionHash = `sha256:${'c'.repeat(64)}`;

const game = Object.freeze({
    id: 'game-1',
    trackingEngine: 'diamond-v2',
    diamondProjectionStatus: 'current',
    diamondProjectionComplete: true,
    diamondScorebookInstanceId: instanceId,
    diamondProjectionRevision: 8,
    diamondProjectionCheckpointHash: checkpointHash,
    diamondStatConfigSnapshotHash: configHash,
    diamondProjectionHash: projectionHash
});

const privateTeamDocument = Object.freeze({
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
    stats: { r: 1 },
    observedStats: {},
    statCoverage: { r: 'complete' },
    coverage: { batting: 'complete' },
    inningLines: { home: [1], away: [0] }
});

function completeResponse(documents = []) {
    return {
        data: {
            schemaVersion: 1,
            trackingEngine: 'diamond-v2',
            visibility: 'manager-internal',
            status: 'complete',
            complete: true,
            truncated: false,
            requestedGameCount: 1,
            requestedPlayerCount: 1,
            expectedDocumentCount: 1,
            documentCount: documents.length,
            missingDocumentCount: 1 - documents.length,
            absenceConfirmed: documents.length === 0,
            expectedTeamDocumentCount: 1,
            teamDocumentCount: 1,
            missingTeamDocumentCount: 0,
            responseByteLimit: 7_000_000,
            responseByteCount: 1_024,
            documents,
            teamDocuments: [{ gameId: 'game-1', data: privateTeamDocument }]
        }
    };
}

describe('legacy Diamond manager stat bulk reader', () => {
    it('pins one exact authoritative game head and preserves complete absence evidence', async () => {
        const invoke = vi.fn().mockResolvedValue(completeResponse([]));
        const result = await loadDiamondManagerStats({
            teamId: 'team-1',
            games: [game],
            playerIds: ['p1'],
            invoke
        });
        expect(invoke).toHaveBeenCalledOnce();
        expect(invoke).toHaveBeenCalledWith({
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
        expect(result).toMatchObject({ status: 'complete', absenceConfirmed: true });
        expect(result.documentsByGameId.size).toBe(0);
        expect(result.teamDocumentsByGameId.get('game-1')).toEqual(privateTeamDocument);
    });

    it('fails before invocation for pending heads and never promotes partial or malformed responses', async () => {
        const invoke = vi.fn();
        expect(buildDiamondManagerStatsGameHeads([{ ...game, diamondProjectionComplete: false }])).toBeNull();
        await expect(loadDiamondManagerStats({
            teamId: 'team-1',
            games: [{ ...game, diamondProjectionStatus: 'pending' }],
            playerIds: ['p1'],
            invoke
        })).resolves.toMatchObject({ status: 'partial', absenceConfirmed: false });
        expect(invoke).not.toHaveBeenCalled();

        invoke.mockResolvedValue({
            ...completeResponse([]),
            data: { ...completeResponse([]).data, absenceConfirmed: false }
        });
        await expect(loadDiamondManagerStats({ teamId: 'team-1', games: [game], playerIds: ['p1'], invoke }))
            .resolves.toMatchObject({ status: 'partial', reason: 'private-read-incomplete', absenceConfirmed: false });
    });

    it('rejects duplicates, out-of-scope documents, and unreadable loads without caching absence', async () => {
        const invoke = vi.fn()
            .mockResolvedValueOnce(completeResponse([
                { gameId: 'other-game', playerId: 'p1', data: {} }
            ]))
            .mockRejectedValueOnce(new Error('offline'));
        await expect(loadDiamondManagerStats({ teamId: 'team-1', games: [game], playerIds: ['p1'], invoke }))
            .resolves.toMatchObject({ status: 'partial', reason: 'private-response-mismatch', absenceConfirmed: false });
        await expect(loadDiamondManagerStats({ teamId: 'team-1', games: [game], playerIds: ['p1'], invoke }))
            .resolves.toMatchObject({ status: 'unavailable', reason: 'private-read-unavailable', absenceConfirmed: false });
    });

    it('rejects a same-revision team document from another projection hash', async () => {
        const invoke = vi.fn().mockResolvedValue({
            ...completeResponse([]),
            data: {
                ...completeResponse([]).data,
                teamDocuments: [{
                    gameId: 'game-1',
                    data: { ...privateTeamDocument, projectionHash: `sha256:${'d'.repeat(64)}` }
                }]
            }
        });
        await expect(loadDiamondManagerStats({ teamId: 'team-1', games: [game], playerIds: ['p1'], invoke }))
            .resolves.toMatchObject({ status: 'partial', reason: 'private-team-response-mismatch' });
    });
});
