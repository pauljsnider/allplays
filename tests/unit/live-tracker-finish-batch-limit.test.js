import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { commitFinishPlan } from '../../js/live-tracker-save-complete.js';

function createFirestoreHarness({ commitFailuresByBatchIndex = {} } = {}) {
    const batches = [];
    let autoId = 0;

    return {
        db: { name: 'mock-db' },
        batches,
        writeBatch: () => {
            const batchIndex = batches.length;
            const batch = {
                operations: [],
                commitCount: 0,
                set(ref, data) {
                    this.operations.push({ type: 'set', ref, data });
                },
                update(ref, data) {
                    this.operations.push({ type: 'update', ref, data });
                },
                delete(ref) {
                    this.operations.push({ type: 'delete', ref });
                },
                async commit() {
                    this.commitCount += 1;
                    if (commitFailuresByBatchIndex[batchIndex]) {
                        throw commitFailuresByBatchIndex[batchIndex];
                    }
                }
            };
            batches.push(batch);
            return batch;
        },
        collection: (_db, path) => ({ type: 'collection', path }),
        doc: (...args) => {
            if (args.length === 1 && args[0]?.type === 'collection') {
                autoId += 1;
                return { path: `${args[0].path}/auto-${autoId}` };
            }

            if (args.length === 3) {
                return { path: `${args[1]}/${args[2]}` };
            }

            throw new Error(`Unsupported doc() call: ${JSON.stringify(args)}`);
        }
    };
}

function buildFinishPlan({ eventCount, aggregatedStatsCount }) {
    return {
        eventWrites: Array.from({ length: eventCount }, (_, index) => ({
            data: {
                text: `Event ${index + 1}`,
                timestamp: index + 1
            }
        })),
        aggregatedStatsWrites: Array.from({ length: aggregatedStatsCount }, (_, index) => ({
            playerId: `player-${index + 1}`,
            data: {
                playerName: `Player ${index + 1}`,
                stats: { pts: index }
            }
        })),
        gameUpdate: {
            homeScore: 12,
            awayScore: 10,
            status: 'completed'
        }
    };
}

async function runCommit({ eventCount, aggregatedStatsCount, harness = createFirestoreHarness() }) {
    const result = await commitFinishPlan({
        finishPlan: buildFinishPlan({ eventCount, aggregatedStatsCount }),
        db: harness.db,
        currentTeamId: 'team-1',
        currentGameId: 'game-1',
        createBatch: harness.writeBatch,
        createCollectionRef: harness.collection,
        createDocRef: harness.doc
    });

    return { harness, result };
}

describe('live broadcast tracker finish batch limits', () => {
    it('keeps aggregated stats out of the primary finish batch', async () => {
        const { harness, result } = await runCommit({
            eventCount: 490,
            aggregatedStatsCount: 25
        });

        expect(result.eventBatchSizes).toEqual([490]);
        expect(result.aggregatedStatsBatchSizes).toEqual([50]);
        expect(result.gameUpdateBatchSize).toBe(1);
        expect(harness.batches).toHaveLength(3);

        const [eventBatch, statsBatch, gameUpdateBatch] = harness.batches;
        expect(eventBatch.commitCount).toBe(1);
        expect(eventBatch.operations).toHaveLength(490);
        expect(eventBatch.operations.every((op) => op.type === 'set')).toBe(true);
        expect(eventBatch.operations.some((op) => op.ref.path.includes('/aggregatedStats/'))).toBe(false);

        expect(statsBatch.commitCount).toBe(1);
        expect(statsBatch.operations).toHaveLength(50);
        expect(statsBatch.operations.every((op) => ['set', 'delete'].includes(op.type))).toBe(true);
        expect(statsBatch.operations.filter((op) => op.type === 'set').every((op) => op.ref.path.includes('/aggregatedStats/'))).toBe(true);
        expect(statsBatch.operations.filter((op) => op.type === 'delete').every((op) => op.ref.path.includes('/privatePlayerStats/'))).toBe(true);

        expect(gameUpdateBatch.commitCount).toBe(1);
        expect(gameUpdateBatch.operations).toEqual([
            expect.objectContaining({ type: 'update', ref: { path: 'teams/team-1/games/game-1' } })
        ]);
    });

    it('deletes stale private player stats when a live finish plan has no private data', async () => {
        const harness = createFirestoreHarness();

        await commitFinishPlan({
            finishPlan: {
                eventWrites: [],
                aggregatedStatsWrites: [
                    {
                        playerId: 'player-1',
                        data: {
                            playerName: 'Player 1',
                            stats: { pts: 4 }
                        }
                    }
                ],
                gameUpdate: {
                    homeScore: 4,
                    awayScore: 2,
                    status: 'completed'
                }
            },
            db: harness.db,
            currentTeamId: 'team-1',
            currentGameId: 'game-1',
            createBatch: harness.writeBatch,
            createCollectionRef: harness.collection,
            createDocRef: harness.doc
        });

        expect(harness.batches[0].operations).toEqual([
            expect.objectContaining({
                type: 'set',
                ref: { path: 'teams/team-1/games/game-1/aggregatedStats/player-1' }
            }),
            {
                type: 'delete',
                ref: { path: 'teams/team-1/games/game-1/privatePlayerStats/player-1' }
            }
        ]);
    });

    it('chunks large aggregated stats into secondary batches', async () => {
        const { harness, result } = await runCommit({
            eventCount: 499,
            aggregatedStatsCount: 905
        });

        expect(result.eventBatchSizes).toEqual([499]);
        expect(result.aggregatedStatsBatchSizes).toEqual([450, 450, 450, 450, 10]);
        expect(harness.batches).toHaveLength(7);
        expect(harness.batches.map((batch) => batch.operations.length)).toEqual([499, 450, 450, 450, 450, 10, 1]);
    });

    it('chunks more than 500 live log entries instead of rejecting the finish', async () => {
        const { harness, result } = await runCommit({
            eventCount: 1001,
            aggregatedStatsCount: 25
        });

        expect(result.eventBatchSizes).toEqual([500, 500, 1]);
        expect(result.aggregatedStatsBatchSizes).toEqual([50]);
        expect(harness.batches.map((batch) => batch.operations.length)).toEqual([500, 500, 1, 50, 1]);
        expect(harness.batches[0].operations[0].ref.path).toBe('teams/team-1/games/game-1/events/finish-log-000001');
        expect(harness.batches[0].operations[499].ref.path).toBe('teams/team-1/games/game-1/events/finish-log-000500');
        expect(harness.batches[1].operations[0].ref.path).toBe('teams/team-1/games/game-1/events/finish-log-000501');
        expect(harness.batches[2].operations[0].ref.path).toBe('teams/team-1/games/game-1/events/finish-log-001001');
        expect(harness.batches.at(-1).operations).toEqual([
            expect.objectContaining({ type: 'update', data: expect.objectContaining({ status: 'completed' }) })
        ]);
    });

    it('rewrites deterministic live finish docs when retrying after the final game update fails', async () => {
        const gameUpdateFailure = new Error('Final game update failed');
        const harness = createFirestoreHarness({
            commitFailuresByBatchIndex: {
                2: gameUpdateFailure
            }
        });
        const firstFinishPlan = {
            eventWrites: [
                { data: { text: 'Ava made a basket', clock: '05:11', period: 'Q2', timestamp: 123 } },
                { data: { text: 'Ava drew a foul', clock: '04:58', period: 'Q2', timestamp: 124 } }
            ],
            aggregatedStatsWrites: [
                {
                    playerId: 'p1',
                    data: {
                        playerName: 'Ava',
                        stats: { pts: 2 }
                    },
                    privateData: {
                        playerName: 'Ava',
                        stats: { effort: 4 }
                    }
                }
            ],
            gameUpdate: {
                homeScore: 14,
                awayScore: 12,
                status: 'completed',
                liveStatus: 'completed'
            }
        };

        await expect(commitFinishPlan({
            finishPlan: firstFinishPlan,
            db: harness.db,
            currentTeamId: 'team-1',
            currentGameId: 'game-1',
            createBatch: harness.writeBatch,
            createCollectionRef: harness.collection,
            createDocRef: harness.doc
        })).rejects.toBe(gameUpdateFailure);

        const firstAttemptEventPaths = harness.batches[0].operations.map((op) => op.ref.path);
        const firstAttemptStatPaths = harness.batches[1].operations.map((op) => op.ref.path);

        expect(firstAttemptEventPaths).toEqual([
            'teams/team-1/games/game-1/events/finish-log-000001',
            'teams/team-1/games/game-1/events/finish-log-000002'
        ]);
        expect(firstAttemptStatPaths).toEqual([
            'teams/team-1/games/game-1/aggregatedStats/p1',
            'teams/team-1/games/game-1/privatePlayerStats/p1'
        ]);
        expect(harness.batches[2].operations).toEqual([
            expect.objectContaining({
                type: 'update',
                ref: { path: 'teams/team-1/games/game-1' },
                data: expect.objectContaining({
                    homeScore: 14,
                    awayScore: 12,
                    status: 'completed',
                    liveStatus: 'completed'
                })
            })
        ]);

        const result = await commitFinishPlan({
            finishPlan: {
                ...firstFinishPlan,
                aggregatedStatsWrites: [
                    {
                        playerId: 'p1',
                        data: {
                            playerName: 'Ava',
                            stats: { pts: 5 }
                        },
                        privateData: {
                            playerName: 'Ava',
                            stats: { effort: 7 }
                        }
                    }
                ],
                gameUpdate: {
                    homeScore: 18,
                    awayScore: 16,
                    status: 'completed',
                    liveStatus: 'completed'
                }
            },
            db: harness.db,
            currentTeamId: 'team-1',
            currentGameId: 'game-1',
            createBatch: harness.writeBatch,
            createCollectionRef: harness.collection,
            createDocRef: harness.doc
        });

        expect(result).toMatchObject({
            eventBatchSizes: [2],
            aggregatedStatsBatchSizes: [2],
            gameUpdateBatchSize: 1
        });
        expect(harness.batches).toHaveLength(6);
        expect(harness.batches.map((batch) => batch.commitCount)).toEqual([1, 1, 1, 1, 1, 1]);
        expect(harness.batches[3].operations.map((op) => op.ref.path)).toEqual(firstAttemptEventPaths);
        expect(harness.batches[4].operations.map((op) => op.ref.path)).toEqual(firstAttemptStatPaths);
        expect(harness.batches[4].operations).toEqual([
            expect.objectContaining({
                ref: { path: 'teams/team-1/games/game-1/aggregatedStats/p1' },
                data: expect.objectContaining({ stats: { pts: 5 } })
            }),
            expect.objectContaining({
                ref: { path: 'teams/team-1/games/game-1/privatePlayerStats/p1' },
                data: expect.objectContaining({ stats: { effort: 7 } })
            })
        ]);
        expect(harness.batches[5].operations).toEqual([
            expect.objectContaining({
                type: 'update',
                ref: { path: 'teams/team-1/games/game-1' },
                data: {
                    homeScore: 18,
                    awayScore: 16,
                    status: 'completed',
                    liveStatus: 'completed'
                }
            })
        ]);
        expect(harness.batches.slice(3).filter((batch) => (
            batch.operations.some((op) => op.type === 'update' && op.ref.path === 'teams/team-1/games/game-1')
        ))).toHaveLength(1);
    });

    it('rejects when a secondary aggregated stats batch fails before primary commit', async () => {
        const statsBatchFailure = new Error('Secondary aggregated stats batch failed');
        const harness = createFirestoreHarness({
            commitFailuresByBatchIndex: {
                2: statsBatchFailure
            }
        });

        await expect(runCommit({
            eventCount: 499,
            aggregatedStatsCount: 905,
            harness
        })).rejects.toBe(statsBatchFailure);

        expect(harness.batches).toHaveLength(3);
        expect(harness.batches[0].commitCount).toBe(1);
        expect(harness.batches[1].commitCount).toBe(1);
        expect(harness.batches[2].commitCount).toBe(1);
        expect(harness.batches[0].operations).toHaveLength(499);
        expect(harness.batches[1].operations).toHaveLength(450);
        expect(harness.batches[2].operations).toHaveLength(450);
        expect(harness.batches.some((batch) => batch.operations.some((op) => op.type === 'update'))).toBe(false);
    });

    it('chunks the legacy track-live.html finish writes before completing the game', () => {
        const source = readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');
        const finishSubmitIndex = source.indexOf("finishForm.addEventListener('submit'");
        const eventLoopIndex = source.indexOf('for (const [eventIndex, entry] of gameState.gameLog.entries())', finishSubmitIndex);
        const statsSetIndex = source.indexOf('const playerIdsToPersist = new Set(Object.keys(gameState.playerStats));', eventLoopIndex);
        const statsLoopIndex = source.indexOf('for (const playerId of playerIdsToPersist)', statsSetIndex);
        const finalUpdateIndex = source.indexOf("status: 'completed'", statsLoopIndex);

        expect(source).toContain('const maxBatchWrites = 500;');
        expect(source).toContain("const eventId = `finish-log-${String(eventIndex + 1).padStart(6, '0')}`;");
        expect(source).toContain('await commitBatchIfNeeded(true);');
        expect(source).toContain('const stats = gameState.playerStats[playerId] || {};');
        expect(source).not.toContain('for (const [playerId, stats] of Object.entries(gameState.playerStats))');
        expect(eventLoopIndex).toBeGreaterThan(finishSubmitIndex);
        expect(statsSetIndex).toBeGreaterThan(eventLoopIndex);
        expect(statsLoopIndex).toBeGreaterThan(statsSetIndex);
        expect(finalUpdateIndex).toBeGreaterThan(statsLoopIndex);
    });
});
