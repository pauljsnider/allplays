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
        const statsLoopIndex = source.indexOf('for (const [playerId, stats] of Object.entries(gameState.playerStats))', eventLoopIndex);
        const finalUpdateIndex = source.indexOf("status: 'completed'", statsLoopIndex);

        expect(source).toContain('const maxBatchWrites = 500;');
        expect(source).toContain("const eventId = `finish-log-${String(eventIndex + 1).padStart(6, '0')}`;");
        expect(source).toContain('await commitBatchIfNeeded(true);');
        expect(eventLoopIndex).toBeGreaterThan(finishSubmitIndex);
        expect(statsLoopIndex).toBeGreaterThan(eventLoopIndex);
        expect(finalUpdateIndex).toBeGreaterThan(statsLoopIndex);
    });
});
