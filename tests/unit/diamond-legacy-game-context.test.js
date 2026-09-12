import { describe, expect, it, vi } from 'vitest';

import {
    assertCompletePlayerStatEvidence,
    loadCompleteAiGameContext,
    loadCompleteAthleteProfileSeasonStats,
    loadCompleteCertificateNarrativeStats,
    loadCompleteDiamondPublicPlayerStats,
    loadCompleteGameEventsForAi,
    loadCompletePlayerStatsForGames
} from '../../js/diamond-legacy-game-context.js';

const instanceId = '00000000-0000-4000-8000-000000000001';
const checkpointHash = `sha256:${'a'.repeat(64)}`;
const statConfigSnapshotHash = `sha256:${'b'.repeat(64)}`;
const projectionHash = `sha256:${'c'.repeat(64)}`;

function diamondGame(id = 'diamond-game') {
    return {
        id,
        teamId: 'team-1',
        trackingEngine: 'diamond-v2',
        diamondProjectionStatus: 'current',
        diamondProjectionComplete: true,
        diamondScorebookInstanceId: instanceId,
        diamondProjectionRevision: 12,
        diamondProjectionCheckpointHash: checkpointHash,
        diamondStatConfigSnapshotHash: statConfigSnapshotHash,
        diamondProjectionHash: projectionHash
    };
}

function sharedDiamondGame({
    teamId = 'team-1',
    sourceTeamId = 'team-1',
    sourceGameId = 'diamond-game'
} = {}) {
    return {
        id: 'shared_tournaments%2Ftournament-1%2FsharedGames%2Fshared-game-1',
        teamId,
        trackingEngine: 'diamond-v2',
        isSharedGame: true,
        sharedGameId: 'shared-game-1',
        sharedGamePath: 'tournaments/tournament-1/sharedGames/shared-game-1',
        diamondSourceTeamId: sourceTeamId,
        diamondSourceGameId: sourceGameId,
        // Shared projections intentionally do not carry an authoritative
        // generation head and must never be used as one.
        diamondProjectionStatus: 'current',
        diamondProjectionRevision: 12,
        diamondScorebookInstanceId: instanceId,
        diamondProjectionCheckpointHash: checkpointHash,
        diamondProjectionHash: projectionHash
    };
}

function publicPlayerDocument({
    gameId = 'diamond-game',
    playerId = 'player-1',
    playerName = 'Riley',
    playerNumber = '7',
    stats = { ab: 4 },
    observedStats = { h: 2 },
    derivedStats = {},
    observedDerivedStats = {}
} = {}) {
    const publicStatIds = [...new Set([
        ...Object.keys(stats),
        ...Object.keys(observedStats),
        ...Object.keys(derivedStats),
        ...Object.keys(observedDerivedStats)
    ])].sort();
    const statCoverage = Object.fromEntries(publicStatIds.map((key) => [
        key,
        Object.prototype.hasOwnProperty.call(stats, key) || Object.prototype.hasOwnProperty.call(derivedStats, key)
            ? 'complete'
            : 'partial'
    ]));
    const statSources = Object.fromEntries(publicStatIds.map((key, index) => [key, [`event-${index + 1}`]]));
    return {
        id: playerId,
        data: {
            schemaVersion: 1,
            trackingEngine: 'diamond-v2',
            projectionSchemaVersion: 1,
            playerId,
            playerName,
            playerNumber,
            participated: true,
            participationStatus: 'appeared',
            participationSource: 'diamond-v2',
            complete: true,
            publicStatIds,
            stats,
            observedStats,
            derivedStats,
            observedDerivedStats,
            statCoverage,
            statSources,
            sourcePlayIds: Object.values(statSources).flat().sort(),
            unavailableDerivedStats: [],
            missingStatFamilies: observedStats && Object.keys(observedStats).length ? ['batting'] : [],
            coverage: { batting: observedStats && Object.keys(observedStats).length ? 'partial' : 'complete' },
            teamId: 'team-1',
            diamondGameId: gameId,
            instanceId,
            diamondScorebookInstanceId: instanceId,
            projectionGeneration: instanceId,
            sourceRevision: 12,
            checkpointHash,
            statConfigSnapshotHash,
            projectionHash
        }
    };
}

describe('legacy Diamond game-context bridge', () => {
    it('keeps classic reads on legacy loaders and exposes only complete public Diamond stats', async () => {
        const classicGame = { id: 'classic-game', trackingEngine: 'classic' };
        const diamond = diamondGame();
        const loadClassicAggregatedStats = vi.fn().mockResolvedValue({
            'classic-player': { goals: 3 }
        });
        const loadPublicDocuments = vi.fn().mockResolvedValue({
            documents: [publicPlayerDocument()],
            loadStatus: 'complete'
        });
        const loadClassicGameEvents = vi.fn().mockResolvedValue([
            { id: 'classic-event', type: 'goal', privateLegacyField: 'preserved-classic-behavior' }
        ]);
        const loadDiamondReportEvents = vi.fn().mockResolvedValue({
            events: [
                { id: 'event-1', revision: 1, description: 'Single' },
                { id: 'event-2', revision: 2, description: 'Double' }
            ],
            visibility: 'public',
            source: 'public-sanitized'
        });

        const result = await loadCompleteAiGameContext({
            teamId: 'team-1',
            statsGames: [classicGame, diamond],
            eventGames: [classicGame, diamond],
            loadClassicAggregatedStats,
            loadClassicGameEvents,
            loadPublicDocuments,
            loadDiamondReportEvents,
            eventLimit: 1
        });

        expect(loadClassicAggregatedStats).toHaveBeenCalledWith('team-1', ['classic-game']);
        expect(loadClassicGameEvents).toHaveBeenCalledWith('team-1', 'classic-game', { limit: 1 });
        expect(loadPublicDocuments).toHaveBeenCalledTimes(1);
        expect(loadDiamondReportEvents).toHaveBeenCalledWith(expect.objectContaining({
            teamId: 'team-1',
            gameId: 'diamond-game',
            requestedVisibility: 'public'
        }));
        expect(result.stats.classicTotalsByPlayer).toEqual({ 'classic-player': { goals: 3 } });
        expect(result.stats.diamondPlayersByGame['diamond-game'][0]).toMatchObject({
            playerId: 'player-1',
            stats: { ab: 4 },
            completeStatKeys: ['ab'],
            omittedOrIncompleteStatKeys: ['h'],
            visibility: 'public'
        });
        expect(result.stats.diamondPlayersByGame['diamond-game'][0].stats).not.toHaveProperty('h');
        expect(result.events.eventsByGame['diamond-game']).toEqual([
            { id: 'event-2', revision: 2, description: 'Double' }
        ]);
        expect(result.events.evidenceByGame['diamond-game']).toMatchObject({
            complete: true,
            truncated: true,
            absenceConfirmed: false,
            visibility: 'public'
        });
    });

    it('retries a partial empty projection without treating it as absence', async () => {
        const loadPublicDocuments = vi.fn()
            .mockResolvedValueOnce({ documents: [], loadStatus: 'partial' })
            .mockResolvedValueOnce({ documents: [publicPlayerDocument()], loadStatus: 'complete' });

        const result = await loadCompleteDiamondPublicPlayerStats({
            teamId: 'team-1',
            game: diamondGame(),
            loadPublicDocuments
        });

        expect(loadPublicDocuments).toHaveBeenCalledTimes(2);
        expect(result.absenceConfirmed).toBe(false);
        expect(result.players).toHaveLength(1);
    });

    it('accepts canonical string innings-pitched values in a complete single-game projection', async () => {
        const result = await loadCompleteDiamondPublicPlayerStats({
            teamId: 'team-1',
            game: diamondGame(),
            loadPublicDocuments: vi.fn().mockResolvedValue({
                documents: [publicPlayerDocument({
                    stats: { ip_outs: 5 },
                    observedStats: {},
                    derivedStats: { innings_pitched: '1.2', era: 3.5 }
                })],
                loadStatus: 'complete'
            })
        });

        expect(result.players[0]).toMatchObject({
            stats: { ip_outs: 5, innings_pitched: '1.2', era: 3.5 },
            completeStatKeys: ['era', 'innings_pitched', 'ip_outs']
        });
    });

    it('resolves a source-owned shared Diamond projection to its authoritative canonical game before reading stats', async () => {
        const sharedGame = sharedDiamondGame();
        const loadCanonicalGame = vi.fn().mockResolvedValue({
            game: diamondGame(),
            loadStatus: 'complete'
        });
        const loadPublicDocuments = vi.fn().mockResolvedValue({
            documents: [publicPlayerDocument()],
            loadStatus: 'complete'
        });

        const result = await loadCompleteDiamondPublicPlayerStats({
            teamId: 'team-1',
            game: sharedGame,
            loadCanonicalGame,
            loadPublicDocuments
        });

        expect(loadCanonicalGame).toHaveBeenCalledWith({
            teamId: 'team-1',
            gameId: 'diamond-game'
        });
        expect(loadPublicDocuments).toHaveBeenCalledWith(expect.objectContaining({
            teamId: 'team-1',
            gameId: 'diamond-game',
            game: expect.objectContaining({
                id: 'diamond-game',
                diamondProjectionComplete: true,
                diamondStatConfigSnapshotHash: statConfigSnapshotHash
            }),
            collectionPath: `teams/team-1/games/diamond-game/diamondStatGenerations/${instanceId}/publicPlayerStats`
        }));
        expect(result).toMatchObject({
            gameId: sharedGame.id,
            canonicalGameId: 'diamond-game',
            sourceTeamId: 'team-1',
            complete: true
        });
    });

    it('retries a cache-only canonical shared-game head before reading its public projection', async () => {
        const loadCanonicalGame = vi.fn()
            .mockResolvedValueOnce({ game: null, loadStatus: 'partial' })
            .mockResolvedValueOnce({ game: diamondGame(), loadStatus: 'complete' });
        const loadPublicDocuments = vi.fn().mockResolvedValue({
            documents: [publicPlayerDocument()],
            loadStatus: 'complete'
        });

        const result = await loadCompleteDiamondPublicPlayerStats({
            teamId: 'team-1',
            game: sharedDiamondGame(),
            loadCanonicalGame,
            loadPublicDocuments
        });

        expect(loadCanonicalGame).toHaveBeenCalledTimes(2);
        expect(loadPublicDocuments).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ complete: true, absenceConfirmed: false });
    });

    it('rejects repeated cache-only canonical shared-game heads without claiming absence', async () => {
        const loadCanonicalGame = vi.fn().mockResolvedValue({
            game: null,
            loadStatus: 'partial'
        });
        const loadPublicDocuments = vi.fn();

        await expect(loadCompleteDiamondPublicPlayerStats({
            teamId: 'team-1',
            game: sharedDiamondGame(),
            loadCanonicalGame,
            loadPublicDocuments
        })).rejects.toMatchObject({
            code: 'diamond-public-stats-incomplete',
            reason: 'canonical-game-read-incomplete',
            retryable: true,
            evidence: { complete: false, absenceConfirmed: false }
        });

        expect(loadCanonicalGame).toHaveBeenCalledTimes(2);
        expect(loadPublicDocuments).not.toHaveBeenCalled();
    });

    it('fails closed for an opponent-side shared Diamond projection without reading another team canonical game', async () => {
        const loadCanonicalGame = vi.fn();
        const loadPublicDocuments = vi.fn();

        await expect(loadCompleteDiamondPublicPlayerStats({
            teamId: 'team-2',
            game: sharedDiamondGame({ teamId: 'team-2', sourceTeamId: 'team-1' }),
            loadCanonicalGame,
            loadPublicDocuments
        })).rejects.toMatchObject({
            code: 'diamond-public-stats-inaccessible',
            reason: 'shared-game-source-not-owned',
            retryable: false,
            message: 'Player stats for this shared Diamond game belong to the other team’s scorebook and are unavailable for this team.',
            evidence: {
                complete: false,
                accessible: false,
                absenceConfirmed: false,
                visibility: 'unavailable'
            }
        });

        expect(loadCanonicalGame).not.toHaveBeenCalled();
        expect(loadPublicDocuments).not.toHaveBeenCalled();
    });

    it('uses the same canonical source binding for a source-owned shared Diamond public replay', async () => {
        const sharedGame = sharedDiamondGame();
        const loadCanonicalGame = vi.fn().mockResolvedValue({
            game: diamondGame(),
            loadStatus: 'complete'
        });
        const loadDiamondReportEvents = vi.fn().mockResolvedValue({
            events: [{ id: 'play-1', description: 'Single' }],
            visibility: 'public',
            source: 'public-sanitized'
        });

        const result = await loadCompleteGameEventsForAi({
            teamId: 'team-1',
            games: [sharedGame],
            loadClassicGameEvents: vi.fn(),
            loadCanonicalGame,
            loadDiamondReportEvents
        });

        expect(loadDiamondReportEvents).toHaveBeenCalledWith(expect.objectContaining({
            teamId: 'team-1',
            gameId: 'diamond-game',
            game: expect.objectContaining({ id: 'diamond-game', diamondProjectionComplete: true }),
            requestedVisibility: 'public'
        }));
        expect(result.eventsByGame[sharedGame.id]).toEqual([{ id: 'play-1', description: 'Single' }]);
    });

    it('blocks foreign shared Diamond AI context instead of feeding incomplete stats or events', async () => {
        const foreignShared = sharedDiamondGame({ teamId: 'team-2', sourceTeamId: 'team-1' });
        await expect(loadCompleteAiGameContext({
            teamId: 'team-2',
            statsGames: [foreignShared],
            eventGames: [foreignShared],
            loadClassicAggregatedStats: vi.fn(),
            loadClassicGameEvents: vi.fn()
        })).rejects.toMatchObject({
            evidence: {
                complete: false,
                absenceConfirmed: false,
                reason: 'shared-game-source-not-owned'
            }
        });
    });

    it('blocks foreign shared Diamond certificate totals rather than generating from a partial window', async () => {
        await expect(loadCompleteCertificateNarrativeStats({
            teamId: 'team-2',
            games: [sharedDiamondGame({ teamId: 'team-2', sourceTeamId: 'team-1' })],
            loadClassicAggregatedStats: vi.fn()
        })).rejects.toMatchObject({
            code: 'diamond-public-stats-inaccessible',
            reason: 'shared-game-source-not-owned',
            evidence: { absenceConfirmed: false }
        });
    });

    it('blocks only the foreign shared Diamond incentive stat load without caching false player absence', async () => {
        await expect(loadCompletePlayerStatsForGames({
            teamId: 'team-2',
            games: [sharedDiamondGame({ teamId: 'team-2', sourceTeamId: 'team-1' })],
            playerId: 'player-2',
            loadClassicPlayerStats: vi.fn()
        })).rejects.toMatchObject({
            code: 'diamond-public-stats-inaccessible',
            evidence: { complete: false, absenceConfirmed: false }
        });
    });

    it('blocks a foreign shared Diamond athlete snapshot rather than persisting partial season totals', async () => {
        await expect(loadCompleteAthleteProfileSeasonStats({
            teamId: 'team-2',
            games: [sharedDiamondGame({ teamId: 'team-2', sourceTeamId: 'team-1' })],
            playerId: 'player-2',
            loadClassicPlayerRecord: vi.fn()
        })).rejects.toMatchObject({
            code: 'diamond-public-stats-inaccessible',
            evidence: { complete: false, absenceConfirmed: false }
        });
    });

    it('rejects repeated partial emptiness, accepts complete emptiness, and never caches a partial nonempty load', async () => {
        const partialEmpty = vi.fn().mockResolvedValue({ documents: [], loadStatus: 'partial' });
        await expect(loadCompleteDiamondPublicPlayerStats({
            teamId: 'team-1',
            game: diamondGame(),
            loadPublicDocuments: partialEmpty
        })).rejects.toThrow(/complete public Diamond stats/i);
        expect(partialEmpty).toHaveBeenCalledTimes(2);

        const completeEmpty = await loadCompleteDiamondPublicPlayerStats({
            teamId: 'team-1',
            game: diamondGame(),
            loadPublicDocuments: vi.fn().mockResolvedValue({ documents: [], loadStatus: 'complete' })
        });
        expect(completeEmpty).toMatchObject({ players: [], absenceConfirmed: true });

        const recoveringLoader = vi.fn()
            .mockResolvedValueOnce({ documents: [publicPlayerDocument()], loadStatus: 'partial' })
            .mockResolvedValueOnce({ documents: [publicPlayerDocument()], loadStatus: 'partial' })
            .mockResolvedValueOnce({
                documents: [
                    publicPlayerDocument(),
                    publicPlayerDocument({ playerId: 'player-2', playerName: 'Jordan', playerNumber: '8' })
                ],
                loadStatus: 'complete'
            });
        await expect(loadCompleteDiamondPublicPlayerStats({
            teamId: 'team-1',
            game: diamondGame(),
            loadPublicDocuments: recoveringLoader
        })).rejects.toThrow(/complete public Diamond stats/i);
        const recovered = await loadCompleteDiamondPublicPlayerStats({
            teamId: 'team-1',
            game: diamondGame(),
            loadPublicDocuments: recoveringLoader
        });
        expect(recovered.players.map(({ playerId }) => playerId)).toEqual(['player-1', 'player-2']);
        expect(recoveringLoader).toHaveBeenCalledTimes(3);
    });

    it('fails the AI context atomically when Diamond evidence stays unavailable and can recover later', async () => {
        const diamond = diamondGame();
        const loadPublicDocuments = vi.fn().mockResolvedValue({
            documents: [publicPlayerDocument()],
            loadStatus: 'complete'
        });
        const loadDiamondReportEvents = vi.fn()
            .mockRejectedValueOnce(new Error('permission denied'))
            .mockRejectedValueOnce(new Error('still unavailable'))
            .mockResolvedValueOnce({
                events: [{ id: 'event-1', revision: 1, description: 'Recovered' }],
                visibility: 'public',
                source: 'public-sanitized'
            });

        await expect(loadCompleteAiGameContext({
            teamId: 'team-1',
            statsGames: [diamond],
            eventGames: [diamond],
            loadClassicAggregatedStats: vi.fn(),
            loadClassicGameEvents: vi.fn(),
            loadPublicDocuments,
            loadDiamondReportEvents
        })).rejects.toThrow(/complete public Diamond events/i);

        const recovered = await loadCompleteAiGameContext({
            teamId: 'team-1',
            statsGames: [diamond],
            eventGames: [diamond],
            loadClassicAggregatedStats: vi.fn(),
            loadClassicGameEvents: vi.fn(),
            loadPublicDocuments,
            loadDiamondReportEvents
        });
        expect(recovered.evidence.complete).toBe(true);
        expect(recovered.events.eventsByGame['diamond-game']).toHaveLength(1);
        expect(loadDiamondReportEvents).toHaveBeenCalledTimes(3);
    });

    it('partitions parent incentive reads and marks incomplete or private Diamond stat keys unusable', async () => {
        const classicGame = { id: 'classic-game', trackingEngine: 'classic' };
        const diamond = diamondGame();
        const loadClassicPlayerStats = vi.fn().mockResolvedValue({ goals: 2 });

        const result = await loadCompletePlayerStatsForGames({
            teamId: 'team-1',
            games: [classicGame, diamond],
            playerId: 'player-1',
            loadClassicPlayerStats,
            loadPublicDocuments: vi.fn().mockResolvedValue({
                documents: [publicPlayerDocument()],
                loadStatus: 'complete'
            })
        });

        expect(loadClassicPlayerStats).toHaveBeenCalledTimes(1);
        expect(loadClassicPlayerStats).toHaveBeenCalledWith('team-1', 'classic-game', 'player-1');
        expect(result[0]).toMatchObject({
            game: classicGame,
            stats: { goals: 2 },
            evidence: { complete: true, source: 'legacy-classic' }
        });
        expect(result[1]).toMatchObject({
            game: diamond,
            stats: { ab: 4 },
            evidence: {
                complete: true,
                absenceConfirmed: false,
                completeStatKeys: ['ab'],
                omittedOrIncompleteStatKeys: ['h'],
                source: 'diamond-public-projection'
            }
        });
        expect(() => assertCompletePlayerStatEvidence({
            evidence: result[1].evidence,
            requiredStatKeys: ['ab']
        })).not.toThrow();
        expect(() => assertCompletePlayerStatEvidence({
            evidence: result[1].evidence,
            requiredStatKeys: ['h']
        })).toThrow(/complete public Diamond stats are unavailable for: h/i);
        expect(() => assertCompletePlayerStatEvidence({
            evidence: {
                ...result[1].evidence,
                absenceConfirmed: true,
                completeStatKeys: []
            },
            requiredStatKeys: ['h']
        })).not.toThrow();
    });

    it('builds certificate totals from classic plus complete public Diamond values and labels omitted counters unknown', async () => {
        const classicGame = { id: 'classic-game', trackingEngine: 'classic' };
        const diamond = diamondGame();
        const loadClassicAggregatedStats = vi.fn().mockResolvedValue({
            'player-1': { ab: 1, h: 1 },
            'classic-only': { goals: 2 }
        });

        const result = await loadCompleteCertificateNarrativeStats({
            teamId: 'team-1',
            games: [classicGame, diamond],
            loadClassicAggregatedStats,
            loadPublicDocuments: vi.fn().mockResolvedValue({
                documents: [publicPlayerDocument()],
                loadStatus: 'complete'
            })
        });

        expect(loadClassicAggregatedStats).toHaveBeenCalledWith('team-1', ['classic-game']);
        expect(result.totalsByPlayer).toEqual({
            'player-1': { ab: 5 },
            'classic-only': { goals: 2 }
        });
        expect(result.statsEvidenceByPlayer['player-1']).toMatchObject({
            complete: false,
            visibility: 'public',
            omittedOrIncompleteStatKeys: ['h']
        });
        expect(result.promptEvidence.instructions).toMatch(/unknown, never zero/i);
    });

    it('keeps certificate classic-only totals unchanged and adds no Diamond prompt evidence', async () => {
        const totals = { 'player-1': { goals: 3, assists: 1 } };
        const result = await loadCompleteCertificateNarrativeStats({
            teamId: 'team-1',
            games: [{ id: 'classic-game', trackingEngine: 'classic' }],
            loadClassicAggregatedStats: vi.fn().mockResolvedValue(totals)
        });

        expect(result.totalsByPlayer).toBe(totals);
        expect(result.promptEvidence).toBeNull();
    });

    it('builds a mixed athlete season only after exact Diamond evidence and never stores unavailable minutes as zero', async () => {
        const classicGame = { id: 'classic-game', trackingEngine: 'classic' };
        const diamond = diamondGame();
        const result = await loadCompleteAthleteProfileSeasonStats({
            teamId: 'team-1',
            games: [classicGame, diamond],
            playerId: 'player-1',
            loadClassicPlayerRecord: vi.fn().mockResolvedValue({
                stats: { ab: 1 },
                timeMs: 60_000
            }),
            loadPublicDocuments: vi.fn().mockResolvedValue({
                documents: [publicPlayerDocument({ stats: { ab: 4 }, observedStats: {} })],
                loadStatus: 'complete'
            })
        });

        expect(result).toMatchObject({
            gamesPlayed: 2,
            totalTimeMs: null,
            playingTimeComplete: false,
            statTotals: { ab: 5 },
            evidence: {
                complete: true,
                visibility: 'public',
                classicGameIds: ['classic-game'],
                diamondGameIds: ['diamond-game'],
                playingTime: {
                    complete: false,
                    unavailableGameIds: ['diamond-game']
                }
            }
        });
        expect(result.evidence.diamondByGame['diamond-game']).toMatchObject({
            complete: true,
            absenceConfirmed: false,
            sourceRevision: 12
        });
    });

    it('omits a season counter globally when a participating Diamond stat is incomplete', async () => {
        const result = await loadCompleteAthleteProfileSeasonStats({
            teamId: 'team-1',
            games: [{ id: 'classic-game', trackingEngine: 'classic' }, diamondGame()],
            playerId: 'player-1',
            loadClassicPlayerRecord: vi.fn().mockResolvedValue({ stats: { ab: 1, h: 1 }, timeMs: 60_000 }),
            loadPublicDocuments: vi.fn().mockResolvedValue({
                documents: [publicPlayerDocument()],
                loadStatus: 'complete'
            })
        });

        expect(result.statTotals).toEqual({ ab: 5 });
        expect(result.evidence).toMatchObject({
            complete: false,
            omittedOrIncompleteStatKeys: ['h']
        });
    });

    it('omits Diamond per-game derived values from certificate and athlete multi-game totals', async () => {
        const games = [diamondGame('diamond-game'), diamondGame('diamond-game-2')];
        const loadPublicDocuments = vi.fn(({ gameId }) => Promise.resolve({
            documents: [publicPlayerDocument({
                gameId,
                stats: { ip_outs: 5, p_so: 2 },
                observedStats: {},
                derivedStats: { innings_pitched: '1.2', era: 3.5, whip: 1.2 }
            })],
            loadStatus: 'complete'
        }));

        const certificate = await loadCompleteCertificateNarrativeStats({
            teamId: 'team-1',
            games,
            loadClassicAggregatedStats: vi.fn(),
            loadPublicDocuments
        });
        expect(certificate.totalsByPlayer['player-1']).toEqual({ ip_outs: 10, p_so: 4 });
        expect(certificate.statsEvidenceByPlayer['player-1']).toMatchObject({
            complete: false,
            completeStatKeys: ['ip_outs', 'p_so'],
            omittedOrIncompleteStatKeys: ['era', 'innings_pitched', 'whip']
        });

        const athlete = await loadCompleteAthleteProfileSeasonStats({
            teamId: 'team-1',
            games,
            playerId: 'player-1',
            loadClassicPlayerRecord: vi.fn(),
            loadPublicDocuments
        });
        expect(athlete.statTotals).toEqual({ ip_outs: 10, p_so: 4 });
        expect(athlete.evidence).toMatchObject({
            complete: false,
            completeStatKeys: ['ip_outs', 'p_so'],
            omittedOrIncompleteStatKeys: ['era', 'innings_pitched', 'whip']
        });
    });
});
