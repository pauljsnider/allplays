import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { commitStandardTrackerFinishData } from '../../js/track-finish.js';

function createFirestoreHarness() {
    const batches = [];
    let autoId = 0;

    return {
        db: { name: 'mock-db' },
        batches,
        writeBatch: () => {
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

function buildGameLog(count) {
    return Array.from({ length: count }, (_, index) => ({
        text: `Event ${index + 1}`,
        time: '00:01',
        period: 'Q1',
        timestamp: index + 1,
        undoData: {
            type: 'stat',
            playerId: `player-${index + 1}`,
            statKey: 'PTS',
            value: 1,
            isOpponent: false
        }
    }));
}

function buildRoster(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `player-${index + 1}`,
        name: `Player ${index + 1}`,
        number: String(index + 1)
    }));
}

async function runFinishSave({ eventCount, rosterCount }) {
    const harness = createFirestoreHarness();

    const result = await commitStandardTrackerFinishData({
        db: harness.db,
        writeBatch: harness.writeBatch,
        doc: harness.doc,
        collection: harness.collection,
        teamId: 'team-1',
        gameId: 'game-1',
        currentUserUid: 'coach-1',
        gameLog: buildGameLog(eventCount),
        players: buildRoster(rosterCount),
        playerStatsByPlayerId: {},
        columns: ['PTS', 'AST'],
        finalHome: 12,
        finalAway: 10,
        summary: 'Finished cleanly.',
        opponentStats: {}
    });

    return { harness, result };
}

describe('standard tracker finish batch limits', () => {
    it('commits 499 game logs plus final update and chunks 905 aggregated stat writes', async () => {
        const { harness, result } = await runFinishSave({
            eventCount: 499,
            rosterCount: 905
        });

        expect(result.primaryBatchWriteCount).toBe(500);
        expect(result.aggregatedStatsBatchSizes).toEqual([450, 450, 5]);
        expect(harness.batches).toHaveLength(4);

        const [primaryBatch, ...secondaryBatches] = harness.batches;
        expect(primaryBatch.commitCount).toBe(1);
        expect(primaryBatch.operations).toHaveLength(500);
        expect(primaryBatch.operations.filter((op) => op.type === 'set')).toHaveLength(499);
        expect(primaryBatch.operations.filter((op) => op.type === 'update')).toHaveLength(1);

        expect(secondaryBatches.map((batch) => batch.operations.length)).toEqual([450, 450, 5]);
        secondaryBatches.forEach((batch) => {
            expect(batch.commitCount).toBe(1);
            expect(batch.operations.every((op) => op.type === 'set')).toBe(true);
        });
    });

    it('rejects 500 game logs plus final update before any batch commit', async () => {
        const harness = createFirestoreHarness();

        await expect(commitStandardTrackerFinishData({
            db: harness.db,
            writeBatch: harness.writeBatch,
            doc: harness.doc,
            collection: harness.collection,
            teamId: 'team-1',
            gameId: 'game-1',
            currentUserUid: 'coach-1',
            gameLog: buildGameLog(500),
            players: buildRoster(905),
            playerStatsByPlayerId: {},
            columns: ['PTS'],
            finalHome: 12,
            finalAway: 10,
            summary: 'Should not save.',
            opponentStats: {}
        })).rejects.toThrow("Game has 500 logged events. Finish requires chunked event persistence before it can safely exceed Firestore's 500-write batch limit.");

        expect(harness.batches).toHaveLength(0);
    });

    it('wires the production track.html submit path through the tested finish helper', () => {
        const source = readFileSync(new URL('../../track.html', import.meta.url), 'utf8');

        expect(source).toContain("import { commitStandardTrackerFinishData } from './js/track-finish.js?v=1';");
        expect(source).toContain('await commitStandardTrackerFinishData({');
    });
});
