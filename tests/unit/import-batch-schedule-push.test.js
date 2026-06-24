import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadNotificationInternals } = require('../../functions/test/send-category-notification-test-helpers.cjs');

function createSnapshot(data) {
    return {
        data: () => data
    };
}

describe('schedule import batch push notifications', () => {
    it('does not send created-event pushes for draft schedule records', async () => {
        const harness = loadNotificationInternals({
            teamDoc: { ownerId: 'user-1' },
            indexedTargets: [{
                uid: 'user-1',
                deviceId: 'device-1',
                token: 'token-1',
                categories: { schedule: true, practice: true }
            }]
        });

        try {
            const result = await harness.internals.notifyGameCreated(
                createSnapshot({
                    type: 'game',
                    opponent: 'Falcons',
                    status: 'draft',
                    createdBy: 'coach-1'
                }),
                { params: { teamId: 'team-1', gameId: 'game-draft' } }
            );

            expect(result).toBeNull();
            expect(harness.env.messagingCalls).toHaveLength(0);
        } finally {
            harness.cleanup();
        }
    });

    it('sends one schedule summary push for app imports larger than three events and suppresses follow-on updates', async () => {
        const harness = loadNotificationInternals({
            teamDoc: { ownerId: 'user-1' },
            indexedTargets: [{
                uid: 'user-1',
                deviceId: 'device-1',
                token: 'token-1',
                categories: { schedule: true }
            }]
        });

        try {
            const batch = {
                batchId: 'batch-large',
                totalCount: 4
            };
            for (let index = 0; index < 4; index += 1) {
                await harness.internals.notifyGameCreated(
                    createSnapshot({
                        type: index % 2 === 0 ? 'game' : 'practice',
                        title: index % 2 === 0 ? null : `Practice ${index + 1}`,
                        opponent: index % 2 === 0 ? `Opponent ${index + 1}` : null,
                        status: 'scheduled',
                        createdBy: 'coach-1',
                        importBatch: {
                            ...batch,
                            rowNumber: index + 1
                        }
                    }),
                    { params: { teamId: 'team-1', gameId: `game-${index + 1}` } }
                );
            }

            expect(harness.env.messagingCalls).toHaveLength(1);
            expect(harness.env.messagingCalls[0]).toMatchObject({
                title: 'Schedule import complete',
                body: 'Imported 4 schedule events (2 games, 2 practices).'
            });
            const batchSnapshot = await harness.env.firestoreState
                .doc('teams/team-1/scheduleImportNotificationBatches/batch-large')
                .get();
            expect(batchSnapshot.data()).toMatchObject({
                sentAt: { __serverTimestamp: true },
                summaryTitle: 'Schedule import complete',
                summaryBody: 'Imported 4 schedule events (2 games, 2 practices).'
            });

            const duplicateUpdate = await harness.internals.sendCategoryNotification({
                teamId: 'team-1',
                category: 'schedule',
                gameId: 'game-1',
                title: 'Schedule update',
                body: 'Practice moved.'
            });

            expect(duplicateUpdate).toBeNull();
            expect(harness.env.messagingCalls).toHaveLength(1);
        } finally {
            harness.cleanup();
        }
    });

    it('keeps per-event create pushes for app imports of three or fewer events', async () => {
        const harness = loadNotificationInternals({
            teamDoc: { ownerId: 'user-1' },
            indexedTargets: [{
                uid: 'user-1',
                deviceId: 'device-1',
                token: 'token-1',
                categories: { schedule: true, practice: true }
            }]
        });

        try {
            const batch = {
                batchId: 'batch-small',
                totalCount: 3
            };
            for (let index = 0; index < 3; index += 1) {
                await harness.internals.notifyGameCreated(
                    createSnapshot({
                        type: index === 2 ? 'practice' : 'game',
                        title: index === 2 ? 'Speed Session' : null,
                        opponent: index === 2 ? null : `Opponent ${index + 1}`,
                        status: 'scheduled',
                        createdBy: 'coach-1',
                        importBatch: {
                            ...batch,
                            rowNumber: index + 1
                        }
                    }),
                    { params: { teamId: 'team-1', gameId: `game-${index + 1}` } }
                );
            }

            expect(harness.env.messagingCalls).toHaveLength(3);
            expect(harness.env.messagingCalls[0].title).toContain('New game:');
            expect(harness.env.messagingCalls[2].title).toContain('New practice:');
        } finally {
            harness.cleanup();
        }
    });

    it('does not count duplicate create trigger retries toward large import summary totals', async () => {
        const harness = loadNotificationInternals({
            teamDoc: { ownerId: 'user-1' },
            indexedTargets: [{
                uid: 'user-1',
                deviceId: 'device-1',
                token: 'token-1',
                categories: { schedule: true }
            }]
        });

        try {
            const batch = {
                batchId: 'batch-retry',
                totalCount: 4
            };
            const events = [
                { gameId: 'game-1', type: 'game', opponent: 'Opponent 1', rowNumber: 1 },
                { gameId: 'game-1', type: 'game', opponent: 'Opponent 1', rowNumber: 1 },
                { gameId: 'game-2', type: 'practice', title: 'Practice 2', rowNumber: 2 },
                { gameId: 'game-3', type: 'game', opponent: 'Opponent 3', rowNumber: 3 }
            ];

            for (const item of events) {
                await harness.internals.notifyGameCreated(
                    createSnapshot({
                        type: item.type,
                        title: item.title || null,
                        opponent: item.opponent || null,
                        status: 'scheduled',
                        createdBy: 'coach-1',
                        importBatch: {
                            ...batch,
                            rowNumber: item.rowNumber
                        }
                    }),
                    { params: { teamId: 'team-1', gameId: item.gameId } }
                );
            }

            expect(harness.env.messagingCalls).toHaveLength(0);

            await harness.internals.notifyGameCreated(
                createSnapshot({
                    type: 'practice',
                    title: 'Practice 4',
                    status: 'scheduled',
                    createdBy: 'coach-1',
                    importBatch: {
                        ...batch,
                        rowNumber: 4
                    }
                }),
                { params: { teamId: 'team-1', gameId: 'game-4' } }
            );

            expect(harness.env.messagingCalls).toHaveLength(1);
            expect(harness.env.messagingCalls[0]).toMatchObject({
                title: 'Schedule import complete',
                body: 'Imported 4 schedule events (2 games, 2 practices).'
            });
        } finally {
            harness.cleanup();
        }
    });

    it('falls back to per-event create pushes when a large app import finishes with only three successful events', async () => {
        const harness = loadNotificationInternals({
            teamDoc: { ownerId: 'user-1' },
            indexedTargets: [{
                uid: 'user-1',
                deviceId: 'device-1',
                token: 'token-1',
                categories: { schedule: true, practice: true }
            }]
        });

        try {
            const batch = {
                batchId: 'batch-partial',
                totalCount: 4
            };
            const events = [
                { gameId: 'game-1', type: 'game', opponent: 'Opponent 1', rowNumber: 1 },
                { gameId: 'game-2', type: 'game', opponent: 'Opponent 2', rowNumber: 2 },
                { gameId: 'game-4', type: 'practice', title: 'Speed Session', rowNumber: 4 }
            ];

            for (const item of events) {
                await harness.internals.notifyGameCreated(
                    createSnapshot({
                        type: item.type,
                        title: item.title || null,
                        opponent: item.opponent || null,
                        status: 'scheduled',
                        createdBy: 'coach-1',
                        importBatch: {
                            ...batch,
                            rowNumber: item.rowNumber
                        }
                    }),
                    { params: { teamId: 'team-1', gameId: item.gameId } }
                );
            }

            expect(harness.env.messagingCalls).toHaveLength(0);

            await harness.env.firestoreState.doc('teams/team-1/games/game-1').set({
                type: 'game',
                opponent: 'Opponent 1',
                status: 'scheduled',
                createdBy: 'coach-1'
            });
            await harness.env.firestoreState.doc('teams/team-1/games/game-2').set({
                type: 'game',
                opponent: 'Opponent 2',
                status: 'scheduled',
                createdBy: 'coach-1'
            });
            await harness.env.firestoreState.doc('teams/team-1/games/game-4').set({
                type: 'practice',
                title: 'Speed Session',
                status: 'scheduled',
                createdBy: 'coach-1'
            });

            await harness.internals.notifyScheduleImportBatchCompleted(
                {
                    before: createSnapshot(null),
                    after: {
                        exists: true,
                        data: () => ({
                            batchId: 'batch-partial',
                            totalCount: 3,
                            eventIds: ['game-1', 'game-2', 'game-4'],
                            importCompletedAt: { toMillis: () => Date.now() },
                            gameCount: 2,
                            practiceCount: 1
                        })
                    }
                },
                { params: { teamId: 'team-1', batchId: 'batch-partial' } }
            );

            expect(harness.env.messagingCalls).toHaveLength(3);
            expect(harness.env.messagingCalls[0].title).toContain('New game:');
            expect(harness.env.messagingCalls[1].title).toContain('New game:');
            expect(harness.env.messagingCalls[2].title).toContain('New practice:');
        } finally {
            harness.cleanup();
        }
    });
});
