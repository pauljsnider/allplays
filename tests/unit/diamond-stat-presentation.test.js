import { describe, expect, it } from 'vitest';

import {
    DIAMOND_PLAYER_STAT_CATALOG,
    aggregateCoverageAwareSeasonStats,
    aggregateCoverageAwareTeamStats,
    getCoverageAwareStatValue,
    getDiamondPublicPlayerStatsCollectionPath,
    getManagerDiamondStatCatalog,
    getPublicDiamondStatCatalog,
    readCoverageAwareOpponentStats,
    readCoverageAwareStatDocument,
    resolveDiamondManagerStatDocuments,
    resolveDiamondManagerTeamStatDocument,
    resolveDiamondProjectionState,
    resolveDiamondPublicStatDocuments,
    resolveDiamondPublicStatsResponse,
    resolveDiamondPublicTeamStatDocument
} from '../../js/diamond-stat-presentation.js';

const game = {
    trackingEngine: 'diamond-v2',
    diamondProjectionStatus: 'current',
    diamondProjectionRevision: 12,
    rulesProfileId: 'baseball-youth',
    status: 'completed'
};
const managerInstanceId = '00000000-0000-4000-8000-000000000001';
const managerCheckpointHash = `sha256:${'a'.repeat(64)}`;
const managerConfigHash = `sha256:${'b'.repeat(64)}`;
const managerProjectionHash = `sha256:${'c'.repeat(64)}`;

describe('Diamond stat presentation', () => {
    it('catalogs the complete projected traditional raw and derived field set', () => {
        const ids = DIAMOND_PLAYER_STAT_CATALOG.map(({ id }) => id);
        expect(ids).toEqual(expect.arrayContaining([
            'pa', 'ab', '1b', '2b', '3b', 'hr', 'rbi', 'gidp',
            'avg', 'obp', 'slg', 'ops', 'sb', 'cs', 'stolen_base_rate',
            'p_app', 'ip_outs', 'p_so', 'wp', 'innings_pitched', 'era', 'whip',
            'po', 'a', 'e', 'dp', 'tp', 'pb', 'fpct', 'chances'
        ]));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('removes configured manager-private fields from public player and team catalogs', () => {
        const config = {
            diamondPublicTeamStatIds: ['r'],
            statDefinitions: [
                { id: 'pitches', scope: 'player', visibility: 'private' },
                { id: 'avg', label: 'Batting Average', scope: 'player', visibility: 'public', precision: 4 },
                { id: 'risp_hits', scope: 'team', visibility: 'private' }
            ]
        };
        const playerCatalog = getPublicDiamondStatCatalog(config, 'player');
        const teamCatalog = getPublicDiamondStatCatalog(config, 'team');

        expect(playerCatalog.some(({ id }) => id === 'pitches')).toBe(false);
        expect(playerCatalog.find(({ id }) => id === 'avg')).toMatchObject({ label: 'Batting Average', precision: 4, visibility: 'public' });
        expect(playerCatalog.some(({ id }) => id === 'h')).toBe(false);
        expect(teamCatalog.some(({ id }) => id === 'risp_hits')).toBe(false);
        expect(teamCatalog.some(({ id }) => id === 'r')).toBe(true);
        const managerCatalog = getManagerDiamondStatCatalog(config, 'player');
        expect(managerCatalog.find(({ id }) => id === 'pitches')).toMatchObject({ visibility: 'manager-internal' });
        expect(managerCatalog.find(({ id }) => id === 'h')).toMatchObject({ visibility: 'manager-internal' });
    });

    it('accepts manager-private player stats only as one complete projection generation', () => {
        const authoritativeGame = {
            ...game,
            diamondProjectionComplete: true,
            diamondScorebookInstanceId: managerInstanceId,
            diamondProjectionCheckpointHash: managerCheckpointHash,
            diamondStatConfigSnapshotHash: managerConfigHash,
            diamondProjectionHash: managerProjectionHash
        };
        const privateDocument = {
            trackingEngine: 'diamond-v2',
            authoritative: true,
            complete: true,
            projectionSchemaVersion: 1,
            playerId: 'p1',
            side: 'home',
            instanceId: managerInstanceId,
            diamondScorebookInstanceId: managerInstanceId,
            projectionGeneration: managerInstanceId,
            sourceRevision: 12,
            checkpointHash: managerCheckpointHash,
            statConfigSnapshotHash: managerConfigHash,
            projectionHash: managerProjectionHash,
            stats: { h: 1 },
            observedStats: {},
            derivedStats: { avg: 0.5 },
            observedDerivedStats: {},
            statCoverage: { h: 'complete', avg: 'complete' },
            coverage: { batting: 'complete' }
        };
        expect(resolveDiamondManagerStatDocuments({
            game: authoritativeGame,
            expectedPlayerIds: ['p1'],
            privateDocuments: [{ id: 'p1', data: privateDocument }]
        })).toMatchObject({ status: 'complete', appliedVisibility: 'manager-internal' });

        for (const mutation of [
            { instanceId: 'old-instance' },
            { sourceRevision: 11 },
            { checkpointHash: 'old-checkpoint' },
            { statConfigSnapshotHash: 'old-config' },
            { projectionHash: `sha256:${'d'.repeat(64)}` },
            { complete: false }
        ]) {
            expect(resolveDiamondManagerStatDocuments({
                game: authoritativeGame,
                expectedPlayerIds: ['p1'],
                privateDocuments: [{ id: 'p1', data: { ...privateDocument, ...mutation } }]
            })).toMatchObject({ status: 'partial', appliedVisibility: 'public', documents: [] });
        }
    });

    it('never treats empty, denied, or partial manager loads as authoritative absence', () => {
        const authoritativeGame = {
            ...game,
            diamondProjectionComplete: true,
            diamondScorebookInstanceId: managerInstanceId,
            diamondProjectionCheckpointHash: managerCheckpointHash,
            diamondStatConfigSnapshotHash: managerConfigHash,
            diamondProjectionHash: managerProjectionHash
        };
        expect(resolveDiamondManagerStatDocuments({
            game: authoritativeGame,
            expectedPlayerIds: ['p1'],
            privateDocuments: []
        })).toMatchObject({ status: 'partial', reason: 'private-read-empty', appliedVisibility: 'public' });
        expect(resolveDiamondManagerStatDocuments({
            game: authoritativeGame,
            expectedPlayerIds: ['p1'],
            privateDocuments: [{ id: 'p1', data: {} }],
            loadStatus: 'unavailable'
        })).toMatchObject({ status: 'partial', reason: 'private-read-incomplete', appliedVisibility: 'public' });
        expect(resolveDiamondManagerStatDocuments({
            game: authoritativeGame,
            expectedPlayerIds: ['p1', 'p2'],
            privateDocuments: [{ id: 'p1', data: {} }]
        })).toMatchObject({ status: 'partial', reason: 'private-read-partial', appliedVisibility: 'public' });
    });

    it('accepts a manager team stat document only when its complete envelope matches the game head', () => {
        const authoritativeGame = {
            ...game,
            diamondProjectionComplete: true,
            diamondScorebookInstanceId: managerInstanceId,
            diamondProjectionCheckpointHash: managerCheckpointHash,
            diamondStatConfigSnapshotHash: managerConfigHash,
            diamondProjectionHash: managerProjectionHash
        };
        const privateDocument = {
            trackingEngine: 'diamond-v2',
            complete: true,
            projectionSchemaVersion: 1,
            side: 'home',
            instanceId: managerInstanceId,
            diamondScorebookInstanceId: managerInstanceId,
            projectionGeneration: managerInstanceId,
            sourceRevision: 12,
            checkpointHash: managerCheckpointHash,
            statConfigSnapshotHash: managerConfigHash,
            projectionHash: managerProjectionHash,
            stats: { r: 4 },
            observedStats: {},
            statCoverage: { r: 'complete' },
            coverage: { batting: 'complete' }
        };
        expect(resolveDiamondManagerTeamStatDocument({ game: authoritativeGame, privateDocument }))
            .toMatchObject({ status: 'complete', appliedVisibility: 'manager-internal', document: privateDocument });
        expect(resolveDiamondManagerTeamStatDocument({
            game: authoritativeGame,
            privateDocument: { ...privateDocument, statConfigSnapshotHash: 'stale' }
        })).toMatchObject({ status: 'partial', appliedVisibility: 'public', document: null });
        expect(resolveDiamondManagerTeamStatDocument({ game: authoritativeGame, loadStatus: 'unavailable' }))
            .toMatchObject({ status: 'partial', appliedVisibility: 'public', document: null });
    });

    it('accepts only the pinned public team subset at the exact authoritative game head', () => {
        const projectionHash = `sha256:${'c'.repeat(64)}`;
        const authoritativeGame = {
            ...game,
            id: 'game-1',
            teamId: 'team-1',
            diamondProjectionComplete: true,
            diamondScorebookInstanceId: managerInstanceId,
            diamondProjectionCheckpointHash: managerCheckpointHash,
            diamondStatConfigSnapshotHash: managerConfigHash,
            diamondProjectionHash: projectionHash
        };
        const document = {
            trackingEngine: 'diamond-v2',
            complete: true,
            projectionSchemaVersion: 1,
            side: 'home',
            teamId: 'team-1',
            diamondGameId: 'game-1',
            instanceId: managerInstanceId,
            diamondScorebookInstanceId: managerInstanceId,
            projectionGeneration: managerInstanceId,
            sourceRevision: 12,
            checkpointHash: managerCheckpointHash,
            statConfigSnapshotHash: managerConfigHash,
            projectionHash,
            publicStatIds: ['r'],
            stats: { r: 4 },
            observedStats: {},
            statCoverage: { r: 'complete' },
            coverage: { batting: 'complete' }
        };

        const projectedGame = { ...authoritativeGame, diamondPublicTeamStats: document };
        expect(resolveDiamondPublicTeamStatDocument({ game: projectedGame }))
            .toMatchObject({ status: 'complete', appliedVisibility: 'public', document: { stats: { r: 4 } } });
        expect(resolveDiamondPublicTeamStatDocument({ game: projectedGame, allowedStatIds: [] }))
            .toMatchObject({ status: 'complete', document: { publicStatIds: [], stats: {}, statCoverage: {} } });

        for (const mutation of [
            { sourceRevision: 11 },
            { checkpointHash: `sha256:${'d'.repeat(64)}` },
            { projectionHash: `sha256:${'e'.repeat(64)}` },
            { stats: { r: 4, h: 9 } },
            { publicStatIds: ['r', 'h'] },
            { privateNotes: 'must never escape' }
        ]) {
            expect(resolveDiamondPublicTeamStatDocument({
                game: { ...authoritativeGame, diamondPublicTeamStats: { ...document, ...mutation } }
            })).toMatchObject({ status: 'partial', document: null });
        }
    });

    it('accepts the exact public callable stats envelope and keeps partial evidence data-free', () => {
        const publicTeamStats = {
            trackingEngine: 'diamond-v2',
            complete: true,
            projectionSchemaVersion: 1,
            side: 'home',
            teamId: 'team-1',
            diamondGameId: 'game-1',
            instanceId: managerInstanceId,
            diamondScorebookInstanceId: managerInstanceId,
            projectionGeneration: managerInstanceId,
            sourceRevision: 12,
            checkpointHash: managerCheckpointHash,
            statConfigSnapshotHash: managerConfigHash,
            projectionHash: managerProjectionHash,
            publicStatIds: ['r'],
            stats: { r: 4 },
            observedStats: {},
            statCoverage: { r: 'complete' },
            coverage: { batting: 'complete' }
        };
        const complete = {
            schemaVersion: 1,
            trackingEngine: 'diamond-v2',
            status: 'complete',
            complete: true,
            instanceId: managerInstanceId,
            sourceRevision: 12,
            checkpointHash: managerCheckpointHash,
            statConfigSnapshotHash: managerConfigHash,
            projectionHash: managerProjectionHash,
            publicTeamStats
        };
        expect(resolveDiamondPublicStatsResponse(complete)).toMatchObject({
            status: 'complete',
            complete: true,
            publicTeamStats: { stats: { r: 4 } }
        });
        expect(resolveDiamondPublicStatsResponse({
            schemaVersion: 1,
            trackingEngine: 'diamond-v2',
            status: 'partial',
            complete: false
        })).toEqual({
            status: 'partial',
            reason: 'public-stats-partial',
            complete: false,
            identity: null,
            publicTeamStats: null
        });
        for (const mutation of [
            { privateTeamStats: { h: 99 } },
            { projectionHash: `sha256:${'d'.repeat(64)}` },
            { publicTeamStats: { ...publicTeamStats, stats: { r: 4, h: 99 } } }
        ]) {
            expect(resolveDiamondPublicStatsResponse({ ...complete, ...mutation }))
                .toMatchObject({ status: 'unavailable', complete: false, publicTeamStats: null });
        }
    });

    it('accepts public player stats only from the exact generation path and head', () => {
        const authoritativeGame = {
            ...game,
            id: 'game-1',
            teamId: 'team-1',
            diamondProjectionComplete: true,
            diamondScorebookInstanceId: managerInstanceId,
            diamondProjectionCheckpointHash: managerCheckpointHash,
            diamondStatConfigSnapshotHash: managerConfigHash,
            diamondProjectionHash: managerProjectionHash
        };
        const publicDocument = {
            schemaVersion: 1,
            trackingEngine: 'diamond-v2',
            projectionSchemaVersion: 1,
            playerId: 'p1',
            playerName: 'Riley',
            playerNumber: '7',
            participated: true,
            participationStatus: 'appeared',
            participationSource: 'diamond-v2',
            complete: true,
            publicStatIds: ['avg', 'h'],
            stats: { h: 2 },
            observedStats: {},
            derivedStats: { avg: 0.5 },
            observedDerivedStats: {},
            statCoverage: { avg: 'complete', h: 'complete' },
            statSources: { h: ['event-1'] },
            sourcePlayIds: ['event-1'],
            unavailableDerivedStats: [],
            missingStatFamilies: [],
            coverage: { batting: 'complete' },
            teamId: 'team-1',
            diamondGameId: 'game-1',
            instanceId: managerInstanceId,
            diamondScorebookInstanceId: managerInstanceId,
            projectionGeneration: managerInstanceId,
            sourceRevision: 12,
            checkpointHash: managerCheckpointHash,
            statConfigSnapshotHash: managerConfigHash,
            projectionHash: managerProjectionHash
        };

        expect(getDiamondPublicPlayerStatsCollectionPath({
            teamId: 'team-1',
            gameId: 'game-1',
            game: authoritativeGame
        })).toBe(`teams/team-1/games/game-1/diamondStatGenerations/${managerInstanceId}/publicPlayerStats`);
        expect(resolveDiamondPublicStatDocuments({
            teamId: 'team-1',
            gameId: 'game-1',
            game: authoritativeGame,
            documents: [{ id: 'p1', data: publicDocument }]
        })).toMatchObject({ status: 'complete', absenceConfirmed: false });
        expect(resolveDiamondPublicStatDocuments({
            teamId: 'team-1',
            gameId: 'game-1',
            game: authoritativeGame,
            documents: []
        })).toMatchObject({ status: 'complete', absenceConfirmed: true });

        for (const mutation of [
            { instanceId: '00000000-0000-4000-8000-000000000002' },
            { projectionHash: `sha256:${'d'.repeat(64)}` },
            { statConfigSnapshotHash: `sha256:${'e'.repeat(64)}` },
            { publicStatIds: ['h'] },
            { privateNote: 'must not escape' }
        ]) {
            expect(resolveDiamondPublicStatDocuments({
                teamId: 'team-1',
                gameId: 'game-1',
                game: authoritativeGame,
                documents: [{ id: 'p1', data: { ...publicDocument, ...mutation } }]
            })).toMatchObject({ status: 'partial', documents: [], absenceConfirmed: false });
        }
        expect(getDiamondPublicPlayerStatsCollectionPath({
            teamId: 'team-1/other',
            gameId: 'game-1',
            game: authoritativeGame
        })).toBeNull();
    });

    it('aggregates validated public team counters and downgrades an unresolved game to observed', () => {
        const currentDocument = {
            trackingEngine: 'diamond-v2',
            sourceRevision: 12,
            complete: true,
            stats: { r: 3, h: 5 },
            observedStats: {},
            statCoverage: { r: 'complete', h: 'complete' },
            coverage: { batting: 'complete' }
        };
        const result = aggregateCoverageAwareTeamStats({
            allowedStatIds: ['r', 'h'],
            diamondGames: [
                { game, document: currentDocument },
                { game: { ...game, id: 'game-2' }, document: null }
            ]
        });
        expect(result.stats).toEqual({ r: 3, h: 5 });
        expect(result.completeStats).toEqual({});
        expect(result.presentation.statCoverage).toEqual({ h: 'partial', r: 'partial' });
        expect(result.presentation.observedStatKeys).toEqual(['h', 'r']);
        expect(result.projection.pending).toBe(true);
    });

    it('keeps complete, observed, and unavailable values distinct without turning omissions into zero', () => {
        const view = readCoverageAwareStatDocument({
            trackingEngine: 'diamond-v2',
            sourceRevision: 12,
            complete: true,
            stats: { ab: 4, h: 0 },
            observedStats: { sb: 1 },
            derivedStats: { avg: 0 },
            observedDerivedStats: { era: 2.5 },
            statCoverage: {
                ab: 'complete',
                h: 'complete',
                avg: 'complete',
                sb: 'partial',
                era: 'partial',
                whip: 'not_collected'
            },
            unavailableDerivedStats: ['whip']
        }, game);

        expect(view.values).toEqual({ ab: 4, h: 0, avg: 0, sb: 1, era: 2.5 });
        expect(view.completeValues).toEqual({ ab: 4, h: 0, avg: 0 });
        expect(view.observedStatKeys).toEqual(['era', 'sb']);
        expect(getCoverageAwareStatValue(view, view.values, 'h')).toMatchObject({ text: '0', status: 'complete', observed: false });
        expect(getCoverageAwareStatValue(view, view.values, 'sb')).toMatchObject({ text: '1', status: 'partial', observed: true });
        expect(getCoverageAwareStatValue(view, view.values, 'whip', { precision: 2 })).toMatchObject({ text: '—', status: 'not_collected', available: false });
    });

    it('fails closed for a v2 game carrying a legacy or stale stat document', () => {
        const legacyDocument = readCoverageAwareStatDocument({ stats: { h: 9 } }, game);
        expect(legacyDocument.values).toEqual({});
        expect(legacyDocument.projection.pending).toBe(true);

        const staleDocument = readCoverageAwareStatDocument({
            trackingEngine: 'diamond-v2',
            sourceRevision: 11,
            complete: true,
            stats: { h: 2 },
            statCoverage: { h: 'complete' }
        }, game);
        expect(staleDocument.values).toEqual({ h: 2 });
        expect(staleDocument.completeValues).toEqual({});
        expect(staleDocument.projection.pending).toBe(true);

        expect(resolveDiamondProjectionState(game, [11])).toMatchObject({
            status: 'pending',
            pending: true,
            authoritativeRevision: 12,
            sourceRevisions: [11]
        });
        expect(resolveDiamondProjectionState({ ...game, trackingEngine: 'standard' }, [11])).toMatchObject({
            status: 'legacy',
            pending: false
        });
    });

    it('infers opponent per-stat coverage from the family map and strips metadata', () => {
        const view = readCoverageAwareOpponentStats({
            name: 'Visitor',
            number: '8',
            h: 2,
            sb: 1,
            era: 0,
            diamondCoverage: { batting: 'complete', baserunning: 'partial', pitching: 'not_collected', fielding: 'not_collected', pitches: 'not_collected' },
            diamondSourceRevision: 12
        }, game);
        expect(view.values).toMatchObject({ h: 2, sb: 1 });
        expect(view.values).not.toHaveProperty('era');
        expect(view.statCoverage).toMatchObject({ h: 'complete', sb: 'partial', era: 'not_collected' });
        expect(view.observedStatKeys).toContain('sb');
        expect(view.values).not.toHaveProperty('diamondcoverage');
    });

    it('builds season lower bounds from partial capture and derives rates only from complete families', () => {
        const result = aggregateCoverageAwareSeasonStats({
            legacyStatsByPlayerId: { legacy: { h: 3 } },
            diamondGames: [{
                game,
                documents: [{
                    id: 'p1',
                    data: {
                        trackingEngine: 'diamond-v2',
                        sourceRevision: 12,
                        complete: true,
                        stats: { pa: 5, ab: 3, h: 1, bb: 1, ibb: 1, hbp: 0, sf: 0, tb: 2, ip_outs: 6, er: 1, p_bb: 1, p_ibb: 0, p_h: 2 },
                        observedStats: { sb: 2 },
                        statCoverage: {
                            pa: 'complete', ab: 'complete', h: 'complete', bb: 'complete', ibb: 'complete', hbp: 'complete', sf: 'complete', tb: 'complete',
                            ip_outs: 'complete', er: 'complete', p_bb: 'complete', p_ibb: 'complete', p_h: 'complete', sb: 'partial'
                        },
                        coverage: { batting: 'complete', baserunning: 'partial', pitching: 'complete', fielding: 'not_collected', pitches: 'not_collected' }
                    }
                }]
            }]
        });

        expect(result.statsByPlayerId.legacy).toEqual({ h: 3 });
        expect(result.statsByPlayerId.p1).toMatchObject({ h: 1, sb: 2, avg: 1 / 3, obp: 3 / 5, innings_pitched: '2.0', era: 3, whip: 1.5 });
        expect(result.completeStatsByPlayerId.p1).toMatchObject({ h: 1, avg: 1 / 3, era: 3 });
        expect(result.completeStatsByPlayerId.p1).not.toHaveProperty('sb');
        expect(result.presentationByPlayerId.p1.statCoverage).toMatchObject({ avg: 'complete', sb: 'partial', fpct: 'not_collected' });
        expect(getCoverageAwareStatValue(result.presentationByPlayerId.p1, result.statsByPlayerId.p1, 'avg', { precision: 3 }).text).toBe('.333');
        expect(getCoverageAwareStatValue(result.presentationByPlayerId.p1, result.statsByPlayerId.p1, 'fpct', { precision: 3 }).text).toBe('—');
    });

    it('treats mixed legacy and Diamond season totals as observed lower bounds instead of complete zeros', () => {
        const result = aggregateCoverageAwareSeasonStats({
            legacyStatsByPlayerId: { p1: { h: 2, hr: 0 } },
            diamondGames: [{
                game: { ...game, rulesProfileId: 'baseball-youth@1' },
                documents: [{
                    id: 'p1',
                    data: {
                        trackingEngine: 'diamond-v2',
                        sourceRevision: 12,
                        complete: true,
                        stats: { h: 1, hr: 0 },
                        statCoverage: { h: 'complete', hr: 'complete' },
                        coverage: { batting: 'complete' }
                    }
                }]
            }]
        });

        expect(result.statsByPlayerId.p1).toMatchObject({ h: 3, hr: 0 });
        expect(result.presentationByPlayerId.p1.statCoverage).toMatchObject({ h: 'partial', hr: 'partial' });
        expect(result.completeStatsByPlayerId.p1).toEqual({});
        expect(getCoverageAwareStatValue(result.presentationByPlayerId.p1, result.statsByPlayerId.p1, 'hr')).toMatchObject({
            text: '0',
            status: 'partial',
            observed: true
        });
    });

    it('downgrades loaded season values when another expected Diamond projection is pending', () => {
        const result = aggregateCoverageAwareSeasonStats({
            diamondGames: [
                {
                    game,
                    documents: [{
                        id: 'p1',
                        data: {
                            trackingEngine: 'diamond-v2',
                            sourceRevision: 12,
                            complete: true,
                            stats: { ab: 3, h: 1 },
                            statCoverage: { ab: 'complete', h: 'complete' },
                            coverage: { batting: 'complete' }
                        }
                    }]
                },
                {
                    game: { ...game, diamondProjectionRevision: 4, diamondProjectionStatus: 'pending' },
                    documents: []
                }
            ]
        });

        expect(result.projection.pending).toBe(true);
        expect(result.statsByPlayerId.p1).toMatchObject({ ab: 3, h: 1 });
        expect(result.presentationByPlayerId.p1.statCoverage).toMatchObject({ ab: 'partial', h: 'partial', avg: 'partial' });
        expect(result.completeStatsByPlayerId.p1).toEqual({});
        expect(getCoverageAwareStatValue(result.presentationByPlayerId.p1, result.statsByPlayerId.p1, 'h')).toMatchObject({
            text: '1',
            status: 'partial',
            observed: true
        });
    });
});
