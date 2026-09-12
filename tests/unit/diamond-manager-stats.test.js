import { describe, expect, it, vi } from 'vitest';

import {
    buildDiamondReportPlayers,
    buildDiamondManagerStatsGameHeads,
    loadCompleteDiamondManagerStats,
    loadDiamondManagerStats
} from '../../js/diamond-manager-stats.js';
import { buildDiamondStatsCsv } from '../../js/diamond-stat-export.js';
import { buildPlayerLeaderboardSnapshot } from '../../js/stat-leaderboards.js';

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

function buildGame(gameId) {
    return { ...game, id: gameId };
}

function buildPrivatePlayerDocument(gameId, playerId) {
    return {
        trackingEngine: 'diamond-v2',
        teamId: 'team-1',
        diamondGameId: gameId,
        playerId,
        playerName: `Recorded ${playerId}`,
        playerNumber: '',
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
        stats: { h: 1 },
        observedStats: {},
        derivedStats: {},
        observedDerivedStats: {},
        statCoverage: { h: 'complete' },
        coverage: { batting: 'complete' }
    };
}

function buildPrivateTeamDocument(gameId, stats = { r: 1 }) {
    return {
        ...privateTeamDocument,
        diamondGameId: gameId,
        stats
    };
}

function completeResponseForRequest(request, {
    includePlayerDocuments = true,
    includeTeamDocuments = true,
    teamStats = { r: 1 }
} = {}) {
    const documents = includePlayerDocuments
        ? request.gameHeads.flatMap(({ gameId }) => request.playerIds.map((playerId) => ({
            gameId,
            playerId,
            data: buildPrivatePlayerDocument(gameId, playerId)
        })))
        : [];
    const teamDocuments = includeTeamDocuments
        ? request.gameHeads.map(({ gameId }) => ({
            gameId,
            data: buildPrivateTeamDocument(gameId, teamStats)
        }))
        : [];
    const expectedDocumentCount = request.gameHeads.length * request.playerIds.length;
    return {
        data: {
            schemaVersion: 1,
            trackingEngine: 'diamond-v2',
            visibility: 'manager-internal',
            status: 'complete',
            complete: true,
            truncated: false,
            requestedGameCount: request.gameHeads.length,
            requestedPlayerCount: request.playerIds.length,
            expectedDocumentCount,
            documentCount: documents.length,
            missingDocumentCount: expectedDocumentCount - documents.length,
            absenceConfirmed: documents.length === 0,
            expectedTeamDocumentCount: request.gameHeads.length,
            teamDocumentCount: teamDocuments.length,
            missingTeamDocumentCount: request.gameHeads.length - teamDocuments.length,
            responseByteLimit: 7_000_000,
            responseByteCount: 1_024,
            documents,
            teamDocuments
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

    it('loads a 41-game player history in bounded complete chunks', async () => {
        const games = Array.from({ length: 41 }, (_, index) => buildGame(`game-${String(index + 1).padStart(2, '0')}`));
        const invoke = vi.fn(async (request) => completeResponseForRequest(request));

        const result = await loadCompleteDiamondManagerStats({
            teamId: 'team-1',
            games,
            playerIds: ['player-1'],
            invoke
        });

        expect(invoke).toHaveBeenCalledTimes(2);
        expect(invoke.mock.calls.map(([request]) => request.gameHeads.length)).toEqual([40, 1]);
        expect(result).toMatchObject({ status: 'complete', absenceConfirmed: false });
        expect(result.documentsByGameId.size).toBe(41);
        expect(result.teamDocumentsByGameId.size).toBe(41);
    });

    it('loads 26 players across 41 games as four bounded Cartesian chunks', async () => {
        const games = Array.from({ length: 41 }, (_, index) => buildGame(`game-${String(index + 1).padStart(2, '0')}`));
        const playerIds = Array.from({ length: 26 }, (_, index) => `player-${String(index + 1).padStart(2, '0')}`);
        const invoke = vi.fn(async (request) => completeResponseForRequest(request));

        const result = await loadCompleteDiamondManagerStats({ teamId: 'team-1', games, playerIds, invoke });

        expect(invoke).toHaveBeenCalledTimes(4);
        expect(invoke.mock.calls.map(([request]) => [request.gameHeads.length, request.playerIds.length])).toEqual([
            [40, 25],
            [40, 1],
            [1, 25],
            [1, 1]
        ]);
        expect(result).toMatchObject({ status: 'complete', absenceConfirmed: false });
        expect([...result.documentsByGameId.values()].flat()).toHaveLength(41 * 26);
        expect(result.teamDocumentsByGameId.size).toBe(41);
    });

    it('retries the whole set and returns no private evidence when a later chunk remains unavailable', async () => {
        const games = Array.from({ length: 41 }, (_, index) => buildGame(`game-${String(index + 1).padStart(2, '0')}`));
        const playerIds = Array.from({ length: 26 }, (_, index) => `player-${String(index + 1).padStart(2, '0')}`);
        let callNumber = 0;
        const invoke = vi.fn(async (request) => {
            callNumber += 1;
            if (callNumber === 2 || callNumber === 4) throw new Error('later chunk unavailable');
            return completeResponseForRequest(request);
        });

        const result = await loadCompleteDiamondManagerStats({ teamId: 'team-1', games, playerIds, invoke });

        expect(invoke).toHaveBeenCalledTimes(4);
        expect(invoke.mock.calls.map(([request]) => [request.gameHeads.length, request.playerIds.length])).toEqual([
            [40, 25],
            [40, 1],
            [40, 25],
            [40, 1]
        ]);
        expect(result).toMatchObject({ status: 'unavailable', absenceConfirmed: false });
        expect(result.documentsByGameId.size).toBe(0);
        expect(result.teamDocumentsByGameId.size).toBe(0);
    });

    it('rejects conflicting repeated team documents without exposing earlier private chunks', async () => {
        const playerIds = Array.from({ length: 26 }, (_, index) => `player-${String(index + 1).padStart(2, '0')}`);
        const invoke = vi.fn(async (request) => completeResponseForRequest(request, {
            teamStats: request.playerIds.length === 25 ? { r: 1 } : { r: 2 }
        }));

        const result = await loadCompleteDiamondManagerStats({
            teamId: 'team-1',
            games: [game],
            playerIds,
            invoke,
            maxAttempts: 1
        });

        expect(result).toMatchObject({
            status: 'partial',
            reason: 'private-team-document-conflict',
            absenceConfirmed: false
        });
        expect(result.documentsByGameId.size).toBe(0);
        expect(result.teamDocumentsByGameId.size).toBe(0);
    });

    it('confirms empty private player evidence only after every bounded chunk completes', async () => {
        const games = Array.from({ length: 41 }, (_, index) => buildGame(`game-${String(index + 1).padStart(2, '0')}`));
        const playerIds = Array.from({ length: 26 }, (_, index) => `player-${String(index + 1).padStart(2, '0')}`);
        const invoke = vi.fn(async (request) => completeResponseForRequest(request, { includePlayerDocuments: false }));

        const result = await loadCompleteDiamondManagerStats({ teamId: 'team-1', games, playerIds, invoke });

        expect(invoke).toHaveBeenCalledTimes(4);
        expect(result).toMatchObject({ status: 'complete', absenceConfirmed: true });
        expect(result.documentsByGameId.size).toBe(0);
        expect(result.teamDocumentsByGameId.size).toBe(41);
    });

    it('retries the whole set when a later batch omits its team document and retains only the recovered attempt', async () => {
        const games = Array.from({ length: 41 }, (_, index) => buildGame(`game-${String(index + 1).padStart(2, '0')}`));
        let callNumber = 0;
        const invoke = vi.fn(async (request) => {
            callNumber += 1;
            return completeResponseForRequest(request, {
                includeTeamDocuments: callNumber !== 2
            });
        });

        const result = await loadCompleteDiamondManagerStats({
            teamId: 'team-1',
            games,
            playerIds: ['player-1'],
            invoke
        });

        expect(invoke).toHaveBeenCalledTimes(4);
        expect(invoke.mock.calls.map(([request]) => request.gameHeads.length)).toEqual([40, 1, 40, 1]);
        expect(result).toMatchObject({ status: 'complete', absenceConfirmed: false });
        expect(result.documentsByGameId.size).toBe(41);
        expect(result.teamDocumentsByGameId.size).toBe(41);
    });

    it('returns zero private evidence after every retry has a missing team document', async () => {
        const invoke = vi.fn(async (request) => completeResponseForRequest(request, {
            includeTeamDocuments: false
        }));

        const result = await loadCompleteDiamondManagerStats({
            teamId: 'team-1',
            games: [game],
            playerIds: ['player-1'],
            invoke
        });

        expect(invoke).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({
            status: 'partial',
            reason: 'private-team-document-missing',
            absenceConfirmed: false
        });
        expect(result.documentsByGameId.size).toBe(0);
        expect(result.teamDocumentsByGameId.size).toBe(0);
    });

    it('returns zero private evidence after every retry has a malformed team document', async () => {
        const invoke = vi.fn(async (request) => completeResponseForRequest(request, {
            teamStats: null
        }));

        const result = await loadCompleteDiamondManagerStats({
            teamId: 'team-1',
            games: [game],
            playerIds: ['player-1'],
            invoke
        });

        expect(invoke).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({ status: 'partial', absenceConfirmed: false });
        expect(result.documentsByGameId.size).toBe(0);
        expect(result.teamDocumentsByGameId.size).toBe(0);
    });

    it('builds roster-first report identities and keeps projected-only rows off profile routes', () => {
        const players = buildDiamondReportPlayers({
            rosterPlayers: [
                { id: 'roster-2', name: 'Current Two', number: '22', photoUrl: 'https://example.test/two.png' },
                { id: 'roster-1', name: 'Current One', number: '11', photoUrl: 'https://example.test/one.png' }
            ],
            documents: [
                { id: 'manual:z', data: { playerId: 'manual:z', playerName: ' Guest\u202e\nPlayer ', playerNumber: ' 8\t' } },
                { id: 'roster-1', data: { playerId: 'roster-1', playerName: 'Recorded One', playerNumber: '1' } },
                { id: 'manual:a', data: { playerId: 'manual:a', playerName: '', playerNumber: '' } }
            ]
        });

        expect(players).toEqual([
            {
                id: 'roster-2',
                name: 'Current Two',
                number: '22',
                photoUrl: 'https://example.test/two.png',
                canOpenProfile: true
            },
            {
                id: 'roster-1',
                name: 'Recorded One',
                number: '1',
                photoUrl: 'https://example.test/one.png',
                canOpenProfile: true
            },
            {
                id: 'manual:a',
                name: 'Recorded player',
                number: '-',
                photoUrl: '',
                canOpenProfile: false
            },
            {
                id: 'manual:z',
                name: 'Guest Player',
                number: '8',
                photoUrl: '',
                canOpenProfile: false
            }
        ]);
        expect(players.filter(({ canOpenProfile }) => !canOpenProfile).map(({ name }) => name)).not.toContain('manual:a');
    });

    it('uses the latest projected identity deterministically when season game reads arrive reversed', () => {
        const earlierGroup = {
            game: { id: 'game-a', date: '2026-04-01T18:00:00.000Z' },
            documents: [
                { id: 'manual:z', data: { playerId: 'manual:z', playerName: 'Earlier Guest', playerNumber: '4' } },
                { id: 'roster-1', data: { playerId: 'roster-1', playerName: 'Earlier Pat', playerNumber: '5' } }
            ]
        };
        const laterGroup = {
            game: { id: 'game-b', date: '2026-04-08T18:00:00.000Z' },
            documents: [
                { id: 'roster-1', data: { playerId: 'roster-1', playerName: 'Latest Pat', playerNumber: '7' } },
                { id: 'manual:z', data: { playerId: 'manual:z', playerName: 'Latest Guest', playerNumber: '8' } }
            ]
        };
        const sameDateEarlierIdGroup = {
            game: { id: 'game-aa', date: '2026-04-08T18:00:00.000Z' },
            documents: [
                { id: 'roster-1', data: { playerId: 'roster-1', playerName: 'Same-date Earlier Pat', playerNumber: '6' } },
                { id: 'manual:z', data: { playerId: 'manual:z', playerName: 'Same-date Earlier Guest', playerNumber: '7' } }
            ]
        };
        const build = (documentGroups) => buildDiamondReportPlayers({
            rosterPlayers: [{ id: 'roster-1', name: 'Current Pat', number: '99' }],
            documentGroups
        });

        expect(build([laterGroup, earlierGroup, sameDateEarlierIdGroup])).toEqual(
            build([sameDateEarlierIdGroup, earlierGroup, laterGroup])
        );
        expect(build([laterGroup, earlierGroup, sameDateEarlierIdGroup])).toEqual([
            {
                id: 'roster-1',
                name: 'Latest Pat',
                number: '7',
                photoUrl: '',
                canOpenProfile: true
            },
            {
                id: 'manual:z',
                name: 'Latest Guest',
                number: '8',
                photoUrl: '',
                canOpenProfile: false
            }
        ]);
    });

    it('carries a manual team player through leaderboard and CSV output without exporting its raw id', () => {
        const players = buildDiamondReportPlayers({
            rosterPlayers: [{ id: 'roster-1', name: 'Roster Player', number: '4' }],
            documents: [{
                id: 'manual:private-key',
                data: {
                    playerId: 'manual:private-key',
                    playerName: 'Guest Batter',
                    playerNumber: '18'
                }
            }]
        });
        const statsByPlayerId = {
            'roster-1': { h: 1 },
            'manual:private-key': { h: 3 }
        };
        const leaderboard = buildPlayerLeaderboardSnapshot({
            config: {
                id: 'diamond',
                name: 'Diamond',
                statDefinitions: [{
                    id: 'h',
                    label: 'Hits',
                    scope: 'player',
                    visibility: 'public',
                    topStat: true,
                    rankingOrder: 'desc'
                }]
            },
            players,
            seasonStatsByPlayerId: statsByPlayerId
        });
        expect(leaderboard.topStats[0].leader).toMatchObject({
            playerId: 'manual:private-key',
            playerName: 'Guest Batter',
            playerNumber: '18',
            value: 3
        });

        const csv = buildDiamondStatsCsv({
            rows: players.map((player) => ({
                recordType: 'season_player',
                identity: {
                    playerId: player.canOpenProfile ? player.id : undefined,
                    playerName: player.name,
                    playerNumber: player.number
                },
                stats: statsByPlayerId[player.id],
                presentation: {
                    isDiamond: true,
                    statVisibility: 'public',
                    statCoverage: { h: 'complete' },
                    coverage: { batting: 'complete' }
                }
            })),
            statDefinitions: [{ id: 'h', label: 'Hits', scope: 'player', visibility: 'public' }],
            projection: { status: 'complete' },
            visibility: 'public'
        });
        expect(csv).toContain('"","Guest Batter","18"');
        expect(csv).not.toContain('manual:private-key');
    });
});
