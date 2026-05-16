import { describe, expect, it } from 'vitest';
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

        expect(result.primaryBatchWriteCount).toBe(491);
        expect(result.aggregatedStatsBatchSizes).toEqual([25]);
        expect(harness.batches).toHaveLength(2);

        const [statsBatch, primaryBatch] = harness.batches;
        expect(statsBatch.commitCount).toBe(1);
        expect(statsBatch.operations).toHaveLength(25);
        expect(statsBatch.operations.every((op) => op.type === 'set')).toBe(true);
        expect(statsBatch.operations.every((op) => op.ref.path.includes('/aggregatedStats/'))).toBe(true);

        expect(primaryBatch.commitCount).toBe(1);
        expect(primaryBatch.operations).toHaveLength(491);
        expect(primaryBatch.operations.filter((op) => op.type === 'set')).toHaveLength(490);
        expect(primaryBatch.operations.filter((op) => op.type === 'update')).toHaveLength(1);
        expect(primaryBatch.operations.some((op) => op.ref.path.includes('/aggregatedStats/'))).toBe(false);
    });

    it('chunks large aggregated stats into secondary batches', async () => {
        const { harness, result } = await runCommit({
            eventCount: 499,
            aggregatedStatsCount: 905
        });

        expect(result.primaryBatchWriteCount).toBe(500);
        expect(result.aggregatedStatsBatchSizes).toEqual([450, 450, 5]);
        expect(harness.batches).toHaveLength(4);
        expect(harness.batches.slice(0, 3).map((batch) => batch.operations.length)).toEqual([450, 450, 5]);
        expect(harness.batches[3].operations).toHaveLength(500);
    });

    it('rejects before any commit when the primary finish batch would overflow', async () => {
        const harness = createFirestoreHarness();

        await expect(commitFinishPlan({
            finishPlan: buildFinishPlan({ eventCount: 500, aggregatedStatsCount: 25 }),
            db: harness.db,
            currentTeamId: 'team-1',
            currentGameId: 'game-1',
            createBatch: harness.writeBatch,
            createCollectionRef: harness.collection,
            createDocRef: harness.doc
        })).rejects.toThrow("Game has 500 live log entries. Finish requires chunked event persistence before it can safely exceed Firestore's 500-write batch limit.");

        expect(harness.batches).toHaveLength(0);
    });

    it('rejects when a secondary aggregated stats batch fails before primary commit', async () => {
        const statsBatchFailure = new Error('Secondary aggregated stats batch failed');
        const harness = createFirestoreHarness({
            commitFailuresByBatchIndex: {
                1: statsBatchFailure
            }
        });

        await expect(runCommit({
            eventCount: 499,
            aggregatedStatsCount: 905,
            harness
        })).rejects.toBe(statsBatchFailure);

        expect(harness.batches).toHaveLength(2);
        expect(harness.batches[0].commitCount).toBe(1);
        expect(harness.batches[1].commitCount).toBe(1);
        expect(harness.batches[0].operations).toHaveLength(450);
        expect(harness.batches[1].operations).toHaveLength(450);
        expect(harness.batches.some((batch) => batch.operations.some((op) => op.type === 'update'))).toBe(false);
    });
});
