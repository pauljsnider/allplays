import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadNotificationInternals } = require('./send-category-notification-test-helpers.cjs');

function makeSnapshot(ref, data, exists = true) {
    return {
        id: ref.id,
        ref,
        exists,
        data: () => (data == null ? data : JSON.parse(JSON.stringify(data)))
    };
}

function makeChange(ref, beforeData, afterData) {
    return {
        before: makeSnapshot(ref, beforeData, beforeData != null),
        after: makeSnapshot(ref, afterData, afterData != null)
    };
}

test('notifyGameCreated sends a schedule notification once and records audit output', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-1'],
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { schedule: true } },
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { schedule: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/game-1');
        const snapshot = makeSnapshot(ref, {
            title: 'Game at Lions',
            type: 'game',
            opponent: 'Lions',
            date: '2026-06-20T16:00:00.000Z',
            createdBy: 'coach-1'
        });
        const context = { params: { teamId: 'team-1', gameId: 'game-1' } };

        const firstResult = await moduleExports.notifyGameCreated(snapshot, context);
        const secondResult = await moduleExports.notifyGameCreated(snapshot, context);

        assert.equal(firstResult?.successCount, 1);
        assert.equal(secondResult, null);
        assert.equal(env.counts.dedupTransactions, 2);
        assert.equal(env.messagingCalls.length, 1);
        assert.equal(env.messagingCalls[0].title, 'New game: Game at Lions');
        assert.equal(env.messagingCalls[0].body, 'Opponent: Lions. Starts Sat, Jun 20, 11:00 AM');
        assert.equal(env.messagingCalls[0].data.category, 'schedule');
        assert.equal(env.messagingCalls[0].data.eventId, 'game-1');
        assert.equal(env.messagingCalls[0].data.appRoute, '/schedule/team-1/game-1');
        assert.equal(env.auditWrites.length, 1);
        assert.equal(env.auditWrites[0].value.category, 'schedule');
        assert.equal(env.auditWrites[0].value.appRoute, '/schedule/team-1/game-1');
        assert.equal(env.auditWrites[0].value.dedupGuardApplied, true);
    } finally {
        cleanup();
    }
});

test('notifyGameCreated sends one team summary for schedule import batches over three events', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', name: 'Team Bears', adminEmails: [] },
        parentUserIds: ['parent-1'],
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { schedule: true } },
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { schedule: true } }
        ]
    });

    try {
        const importBatchId = 'schedule-import-1';
        const importedEvents = [
            { id: 'import-game-1', type: 'game', title: 'Game at Lions' },
            { id: 'import-practice-1', type: 'practice', title: 'Tuesday practice' },
            { id: 'import-game-2', type: 'game', title: 'Game vs Tigers' },
            { id: 'import-practice-2', type: 'practice', title: 'Thursday practice' }
        ];
        let finalResult = null;

        for (const [index, event] of importedEvents.entries()) {
            const ref = env.firestoreState.doc(`teams/team-1/games/${event.id}`);
            const snapshot = makeSnapshot(ref, {
                title: event.title,
                type: event.type,
                date: `2026-06-2${index}T16:00:00.000Z`,
                createdBy: 'coach-1',
                importBatch: {
                    batchId: importBatchId,
                    totalCount: importedEvents.length,
                    rowNumber: index + 1,
                    importedBy: 'coach-1'
                }
            });
            const context = { params: { teamId: 'team-1', gameId: event.id } };
            const result = await moduleExports.notifyGameCreated(snapshot, context);

            if (index < importedEvents.length - 1) {
                assert.equal(result, null);
            } else {
                finalResult = result;
            }
        }

        assert.deepEqual(finalResult, {
            title: 'Schedule import complete',
            body: 'Imported 4 schedule events for Team Bears (2 games, 2 practices).'
        });
        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens, ['parent-token']);
        assert.equal(env.messagingCalls[0].title, 'Schedule import complete');
        assert.equal(env.messagingCalls[0].body, 'Imported 4 schedule events for Team Bears (2 games, 2 practices).');
        assert.equal(env.messagingCalls[0].data.category, 'schedule');
        assert.equal(env.messagingCalls[0].data.appRoute, '/schedule?teamId=team-1');
        assert.equal(env.auditWrites.length, 1);
        assert.equal(env.auditWrites[0].value.body, 'Imported 4 schedule events for Team Bears (2 games, 2 practices).');

        const scheduleDedupWrites = env.dedupWrites.filter((write) => (
            write.path.startsWith('teams/team-1/notificationSendLog/')
            && write.value?.category === 'schedule'
        ));
        assert.equal(scheduleDedupWrites.length, 5);
        assert.equal(scheduleDedupWrites.some((write) => write.value.dedupKey === `import-batch:${importBatchId}`), true);
        assert.deepEqual(
            scheduleDedupWrites
                .filter((write) => !write.value.dedupKey)
                .map((write) => write.value.gameId)
                .sort(),
            importedEvents.map((event) => event.id).sort()
        );
    } finally {
        cleanup();
    }
});

test('notifyGameUpdated does not double-push an imported event after its batch summary', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', name: 'Team Bears', adminEmails: [] },
        parentUserIds: ['parent-1'],
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { schedule: true } }
        ]
    });

    try {
        const importBatchId = 'schedule-import-2';
        for (let index = 0; index < 4; index += 1) {
            const gameId = `imported-event-${index + 1}`;
            const ref = env.firestoreState.doc(`teams/team-1/games/${gameId}`);
            const snapshot = makeSnapshot(ref, {
                title: `Imported event ${index + 1}`,
                type: 'game',
                date: `2026-07-0${index + 1}T18:00:00.000Z`,
                createdBy: 'coach-1',
                importBatch: {
                    batchId: importBatchId,
                    totalCount: 4,
                    rowNumber: index + 1,
                    importedBy: 'coach-1'
                }
            });
            await moduleExports.notifyGameCreated(snapshot, { params: { teamId: 'team-1', gameId } });
        }

        const updateRef = env.firestoreState.doc('teams/team-1/games/imported-event-1');
        const updateResult = await moduleExports.notifyGameUpdated(
            makeChange(
                updateRef,
                { title: 'Imported event 1', date: '2026-07-01T18:00:00.000Z', location: 'Field 1' },
                { title: 'Imported event 1', date: '2026-07-01T19:00:00.000Z', location: 'Field 1', updatedBy: 'coach-1' }
            ),
            { params: { teamId: 'team-1', gameId: 'imported-event-1' } }
        );

        assert.equal(updateResult, null);
        assert.equal(env.messagingCalls.length, 1);
        assert.equal(env.messagingCalls[0].title, 'Schedule import complete');
        assert.equal(env.auditWrites.length, 1);
    } finally {
        cleanup();
    }
});

test('notifyGameCreated respects schedule preferences for practices and skips sends when disabled', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-1'],
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { practice: true, schedule: false } }
        ],
        preferenceDocs: {
            'users/parent-1/notificationPreferences/team-1': { schedule: false, practice: true }
        },
        deviceDocs: {
            'parent-1': [
                { id: 'parent-device', token: 'parent-token' }
            ]
        }
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/practice-1');
        const snapshot = makeSnapshot(ref, {
            title: 'Wednesday practice',
            type: 'practice',
            date: '2026-06-21T16:00:00.000Z',
            createdBy: 'coach-1'
        });
        const context = { params: { teamId: 'team-1', gameId: 'practice-1' } };

        const result = await moduleExports.notifyGameCreated(snapshot, context);

        assert.equal(result, null);
        assert.equal(env.messagingCalls.length, 0);
        assert.equal(env.auditWrites.length, 0);
        assert.equal(env.counts.dedupTransactions, 1);
    } finally {
        cleanup();
    }
});

test('notifyGameCreated sends a practice notification once and records audit output', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-1'],
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { schedule: true } },
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { schedule: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/practice-2');
        const snapshot = makeSnapshot(ref, {
            title: 'Thursday practice',
            type: 'practice',
            date: '2026-06-22T16:00:00.000Z',
            createdBy: 'coach-1'
        });
        const context = { params: { teamId: 'team-1', gameId: 'practice-2' } };

        const firstResult = await moduleExports.notifyGameCreated(snapshot, context);
        const secondResult = await moduleExports.notifyGameCreated(snapshot, context);

        assert.equal(firstResult?.successCount, 1);
        assert.equal(secondResult, null);
        assert.equal(env.counts.dedupTransactions, 2);
        assert.equal(env.messagingCalls.length, 1);
        assert.equal(env.messagingCalls[0].title, 'New practice: Thursday practice');
        assert.equal(env.messagingCalls[0].body, 'Starts Mon, Jun 22, 11:00 AM');
        assert.equal(env.messagingCalls[0].data.category, 'schedule');
        assert.equal(env.messagingCalls[0].data.appRoute, '/schedule/team-1/practice-2');
        assert.equal(env.auditWrites.length, 1);
        assert.equal(env.auditWrites[0].value.category, 'schedule');
        assert.equal(env.auditWrites[0].value.dedupGuardApplied, true);
    } finally {
        cleanup();
    }
});

test('notifyGameCreated sends one schedule notification for a recurring practice series master', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-1'],
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { schedule: true } },
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { schedule: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/practice-series-1');
        const snapshot = makeSnapshot(ref, {
            title: 'Monday skills',
            type: 'practice',
            date: '2026-06-29T16:00:00.000Z',
            createdBy: 'coach-1',
            isSeriesMaster: true,
            seriesId: 'series-1',
            recurrence: {
                freq: 'weekly',
                interval: 1,
                byDays: ['MO'],
                count: 6
            }
        });
        const context = { params: { teamId: 'team-1', gameId: 'practice-series-1' } };

        const result = await moduleExports.notifyGameCreated(snapshot, context);

        assert.equal(result?.successCount, 1);
        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens, ['parent-token']);
        assert.equal(env.messagingCalls[0].title, 'New practice series: Monday skills');
        assert.equal(env.messagingCalls[0].body, 'Starts Mon, Jun 29, 11:00 AM');
        assert.equal(env.messagingCalls[0].data.category, 'schedule');
        assert.equal(env.messagingCalls[0].data.eventId, 'practice-series-1');
        assert.equal(env.messagingCalls[0].data.appRoute, '/schedule/team-1/practice-series-1');
        assert.equal(env.auditWrites.length, 1);
        assert.equal(env.auditWrites[0].value.category, 'schedule');

        const scheduleDedupWrites = env.dedupWrites.filter((write) => (
            write.path.startsWith('teams/team-1/notificationSendLog/')
            && write.value?.category === 'schedule'
        ));
        assert.equal(scheduleDedupWrites.length, 1);
        assert.equal(scheduleDedupWrites[0].value.gameId, 'practice-series-1');
    } finally {
        cleanup();
    }
});

test('notifyRideOfferCreated notifies team parents except the driver and marks near events time-sensitive', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['driver-1', 'parent-2'],
        gameDocs: {
            'game-1': {
                title: "Saturday's game",
                date: new Date(Date.now() + (90 * 60 * 1000)).toISOString()
            }
        },
        indexedTargets: [
            { uid: 'driver-1', deviceId: 'driver-device', token: 'driver-token', categories: { rideshare: true } },
            { uid: 'parent-2', deviceId: 'parent-device', token: 'parent-token', categories: { rideshare: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/game-1/rideOffers/offer-1');
        const snapshot = makeSnapshot(ref, {
            driverUserId: 'driver-1',
            seatCapacity: 3,
            seatCountConfirmed: 0,
            status: 'open'
        });

        const result = await moduleExports.notifyRideOfferCreated(snapshot, {
            params: { teamId: 'team-1', gameId: 'game-1', offerId: 'offer-1' }
        });

        assert.equal(result?.successCount, 1);
        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens, ['parent-token']);
        assert.equal(env.messagingCalls[0].title, "Ride offered to Saturday's game — 3 seats");
        assert.equal(env.messagingCalls[0].data.category, 'rideshare');
        assert.equal(env.messagingCalls[0].data.appRoute, '/schedule/team-1/game-1?section=rideshare');
        assert.equal(env.messagingCalls[0].android?.priority, 'high');
        assert.equal(env.messagingCalls[0].apns?.payload?.aps?.['interruption-level'], 'time-sensitive');
        assert.equal(env.auditWrites[0].value.category, 'rideshare');
    } finally {
        cleanup();
    }
});

test('notifyRideClaimCreated targets only the driver with remaining-seat copy', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['driver-1', 'parent-2'],
        gameDocs: {
            'game-1': {
                title: "Saturday's game",
                date: '2026-06-28T16:00:00.000Z'
            }
        },
        rideOfferDocs: {
            'game-1/offer-1': {
                driverUserId: 'driver-1',
                seatCapacity: 3,
                seatCountConfirmed: 0,
                status: 'open'
            }
        },
        indexedTargets: [
            { uid: 'driver-1', deviceId: 'driver-device', token: 'driver-token', categories: { rideshare: true } },
            { uid: 'parent-2', deviceId: 'parent-device', token: 'parent-token', categories: { rideshare: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/game-1/rideOffers/offer-1/requests/request-1');
        const snapshot = makeSnapshot(ref, {
            parentUserId: 'parent-2',
            childId: 'player-2',
            childName: 'Sam Parker',
            status: 'pending'
        });

        const result = await moduleExports.notifyRideClaimCreated(snapshot, {
            params: { teamId: 'team-1', gameId: 'game-1', offerId: 'offer-1', requestId: 'request-1' }
        });

        assert.equal(result?.successCount, 1);
        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens, ['driver-token']);
        assert.equal(env.messagingCalls[0].title, 'Sam P. claimed a seat — 2 seats left');
        assert.equal(env.messagingCalls[0].data.category, 'rideshare');
        assert.equal(env.messagingCalls[0].data.appRoute, '/schedule/team-1/game-1?section=rideshare');
        assert.equal(env.auditWrites[0].value.category, 'rideshare');
    } finally {
        cleanup();
    }
});

test('notifyRideClaimUpdated notifies the driver when a prior request is reactivated', async () => {
    const requestedAt = { seconds: 1800000000, nanoseconds: 0 };
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['driver-1', 'parent-2'],
        gameDocs: {
            'game-1': {
                title: "Saturday's game",
                date: '2026-06-28T16:00:00.000Z'
            }
        },
        rideOfferDocs: {
            'game-1/offer-1': {
                driverUserId: 'driver-1',
                seatCapacity: 3,
                seatCountConfirmed: 1,
                status: 'open'
            }
        },
        indexedTargets: [
            { uid: 'driver-1', deviceId: 'driver-device', token: 'driver-token', categories: { rideshare: true } },
            { uid: 'parent-2', deviceId: 'parent-device', token: 'parent-token', categories: { rideshare: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/game-1/rideOffers/offer-1/requests/parent-2__player-2');
        const result = await moduleExports.notifyRideClaimUpdated(
            makeChange(ref, {
                parentUserId: 'parent-2',
                childId: 'player-2',
                childName: 'Sam Parker',
                status: 'waitlisted',
                requestedAt: { seconds: 1799999900, nanoseconds: 0 }
            }, {
                parentUserId: 'parent-2',
                childId: 'player-2',
                childName: 'Sam Parker',
                status: 'pending',
                requestedAt
            }),
            { params: { teamId: 'team-1', gameId: 'game-1', offerId: 'offer-1', requestId: 'parent-2__player-2' } }
        );

        assert.equal(result?.successCount, 1);
        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens, ['driver-token']);
        assert.equal(env.messagingCalls[0].title, 'Sam P. claimed a seat — 1 seat left');
        assert.equal(env.messagingCalls[0].data.category, 'rideshare');
    } finally {
        cleanup();
    }
});

test('notifyRideClaimUpdated ignores ordinary pending request edits without a new requestedAt', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['driver-1', 'parent-2'],
        rideOfferDocs: {
            'game-1/offer-1': {
                driverUserId: 'driver-1',
                seatCapacity: 3,
                seatCountConfirmed: 0,
                status: 'open'
            }
        },
        indexedTargets: [
            { uid: 'driver-1', deviceId: 'driver-device', token: 'driver-token', categories: { rideshare: true } }
        ]
    });

    try {
        const requestedAt = { seconds: 1800000000, nanoseconds: 0 };
        const ref = env.firestoreState.doc('teams/team-1/games/game-1/rideOffers/offer-1/requests/parent-2__player-2');
        const result = await moduleExports.notifyRideClaimUpdated(
            makeChange(ref, {
                parentUserId: 'parent-2',
                childId: 'player-2',
                childName: 'Sam',
                status: 'pending',
                requestedAt
            }, {
                parentUserId: 'parent-2',
                childId: 'player-2',
                childName: 'Sam Parker',
                status: 'pending',
                requestedAt
            }),
            { params: { teamId: 'team-1', gameId: 'game-1', offerId: 'offer-1', requestId: 'parent-2__player-2' } }
        );

        assert.equal(result, null);
        assert.equal(env.messagingCalls.length, 0);
    } finally {
        cleanup();
    }
});

test('notifyRideOfferCancelled targets only active claimants and respects rideshare preferences', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['driver-1', 'parent-2', 'parent-3'],
        gameDocs: {
            'game-1': {
                title: "Saturday's game",
                date: '2026-06-28T16:00:00.000Z'
            }
        },
        rideRequestDocs: {
            'game-1/offer-1': [
                { id: 'request-1', parentUserId: 'parent-2', status: 'confirmed' },
                { id: 'request-2', parentUserId: 'parent-3', status: 'pending' }
            ]
        },
        indexedTargets: [
            { uid: 'parent-2', deviceId: 'claimant-device', token: 'claimant-token', categories: { rideshare: true } },
            { uid: 'parent-3', deviceId: 'opt-out-device', token: 'opt-out-token', categories: { rideshare: false } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/game-1/rideOffers/offer-1');
        const result = await moduleExports.notifyRideOfferCancelled(
            makeChange(ref, {
                driverUserId: 'driver-1',
                status: 'open'
            }, {
                driverUserId: 'driver-1',
                status: 'cancelled'
            }),
            { params: { teamId: 'team-1', gameId: 'game-1', offerId: 'offer-1' } }
        );

        assert.equal(result?.successCount, 1);
        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens, ['claimant-token']);
        assert.equal(env.messagingCalls[0].title, "Ride canceled for Saturday's game");
        assert.equal(env.messagingCalls[0].data.category, 'rideshare');
        assert.equal(env.auditWrites[0].value.category, 'rideshare');
    } finally {
        cleanup();
    }
});

test('notifyRideOfferCancelled ignores a normal closed offer transition', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['driver-1', 'parent-2'],
        rideRequestDocs: {
            'game-1/offer-1': [
                { id: 'request-1', parentUserId: 'parent-2', status: 'confirmed' }
            ]
        },
        indexedTargets: [
            { uid: 'parent-2', deviceId: 'claimant-device', token: 'claimant-token', categories: { rideshare: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/game-1/rideOffers/offer-1');
        const result = await moduleExports.notifyRideOfferCancelled(
            makeChange(ref, {
                driverUserId: 'driver-1',
                status: 'open'
            }, {
                driverUserId: 'driver-1',
                status: 'closed'
            }),
            { params: { teamId: 'team-1', gameId: 'game-1', offerId: 'offer-1' } }
        );

        assert.equal(result, null);
        assert.equal(env.messagingCalls.length, 0);
    } finally {
        cleanup();
    }
});

test('notifyGameUpdated sends liveScore notifications and records once-only audit state', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-1'],
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { liveScore: true } },
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { liveScore: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/game-2');
        const change = makeChange(ref, { homeScore: 10, awayScore: 8 }, { homeScore: 12, awayScore: 8, updatedBy: 'coach-1' });
        const context = { params: { teamId: 'team-1', gameId: 'game-2' } };

        const result = await moduleExports.notifyGameUpdated(change, context);

        assert.equal(result?.successCount, 1);
        assert.equal(env.messagingCalls.length, 1);
        assert.equal(env.messagingCalls[0].data.category, 'liveScore');
        assert.equal(env.auditWrites.length, 1);
        assert.equal(env.auditWrites[0].value.category, 'liveScore');
        assert.equal(env.auditWrites[0].value.dedupGuardApplied, false);
    } finally {
        cleanup();
    }
});

test('notifyGameUpdated suppresses generic liveScore when a matching big-moment live event exists', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-1'],
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { liveScore: true } },
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { liveScore: true } }
        ]
    });

    try {
        await env.firestoreState.doc('teams/team-1/games/game-2/liveEvents/doc-event-1').set({
            type: 'stat',
            statKey: 'PTS',
            value: 2,
            playerName: 'Ava Cole',
            homeScore: 12,
            awayScore: 8,
            createdAt: new Date().toISOString()
        });

        const ref = env.firestoreState.doc('teams/team-1/games/game-2');
        const change = makeChange(ref, { homeScore: 10, awayScore: 8 }, { homeScore: 12, awayScore: 8, updatedBy: 'coach-1' });
        const context = { params: { teamId: 'team-1', gameId: 'game-2' } };

        const result = await moduleExports.notifyGameUpdated(change, context);

        assert.equal(result, null);
        assert.equal(env.counts.dedupTransactions, 0);
        assert.equal(env.messagingCalls.length, 0);
        assert.equal(env.auditWrites.length, 0);
    } finally {
        cleanup();
    }
});

test('notifyGameUpdated does not let a stale matching live event suppress a current score push', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-1'],
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { liveScore: true } }
        ]
    });

    try {
        await env.firestoreState.doc('teams/team-1/games/game-stale/liveEvents/stale-event').set({
            type: 'stat',
            statKey: 'PTS',
            value: 2,
            homeScore: 12,
            awayScore: 8,
            createdAt: new Date(Date.now() - (11 * 60 * 1000)).toISOString()
        });

        const gameRef = env.firestoreState.doc('teams/team-1/games/game-stale');
        const result = await moduleExports.notifyGameUpdated(
            makeChange(gameRef, { homeScore: 10, awayScore: 8 }, { homeScore: 12, awayScore: 8, updatedBy: 'coach-1' }),
            { params: { teamId: 'team-1', gameId: 'game-stale' } }
        );

        assert.equal(result?.successCount, 1);
        assert.equal(env.messagingCalls.length, 1);
        assert.equal(env.messagingCalls[0].title, 'Live score update');
    } finally {
        cleanup();
    }
});

test('notifyLiveEventCreated sends one deduped big-moment notification to eligible recipients except the actor', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-1'],
        indexedTargets: [
            { uid: 'coach-1', roles: ['staff'], deviceId: 'actor-device', token: 'actor-token', categories: { liveScore: true } },
            { uid: 'assistant-1', roles: ['staff'], deviceId: 'assistant-device', token: 'assistant-token', categories: { liveScore: true } },
            { uid: 'parent-1', roles: ['parent'], deviceId: 'parent-device', token: 'parent-token', categories: { liveScore: true } },
            { uid: 'opted-out-1', roles: ['parent'], deviceId: 'opted-out-device', token: 'opted-out-token', categories: { liveScore: false } },
            { uid: 'unrelated-1', roles: ['viewer'], deviceId: 'unrelated-device', token: 'unrelated-token', categories: { liveScore: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/game-3/liveEvents/doc-event-1');
        const snapshot = makeSnapshot(ref, {
            eventId: 'client-event-1',
            type: 'stat',
            statKey: 'PTS',
            value: 3,
            playerName: 'Ava Cole',
            period: 'Q4',
            homeScore: 55,
            awayScore: 53,
            createdAt: new Date().toISOString(),
            createdBy: 'coach-1',
            description: 'Ava hit a three while discussing a private sideline note'
        });
        const context = { params: { teamId: 'team-1', gameId: 'game-3', eventId: 'doc-event-1' } };

        const firstResult = await moduleExports.notifyLiveEventCreated(snapshot, context);
        const duplicateResult = await moduleExports.notifyLiveEventCreated(snapshot, context);

        assert.equal(firstResult?.successCount, 2);
        assert.equal(duplicateResult, null);
        assert.equal(env.counts.dedupTransactions, 2);
        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens.sort(), ['assistant-token', 'parent-token']);
        assert.equal(env.messagingCalls[0].title, '3 points: Ava Cole');
        assert.equal(env.messagingCalls[0].body, 'Q4 · Score 55–53');
        assert.equal(env.messagingCalls[0].body.includes('private'), false);
        assert.equal(env.messagingCalls[0].data.category, 'liveScore');
        assert.equal(env.messagingCalls[0].data.eventId, 'doc-event-1');
        assert.equal(env.messagingCalls[0].data.appRoute, '/schedule/team-1/game-3?section=game');
        assert.equal(env.messagingCalls[0].webLink, 'https://allplays.ai/live-game.html?teamId=team-1&gameId=game-3');
        assert.equal(env.auditWrites.length, 1);
        assert.deepEqual(env.auditWrites[0].value.targetUserIds.sort(), ['assistant-1', 'parent-1']);
        assert.equal(env.auditWrites[0].value.dedupGuardApplied, false);
        assert.equal(env.dedupWrites.some((write) => write.value?.dedupKey === 'live-event:doc-event-1'), true);
        assert.equal(env.dedupWrites.some((write) => write.value?.dedupKey === 'score-state:55:53'), true);
    } finally {
        cleanup();
    }
});

test('notifyLiveEventCreated shares a score-state claim with an earlier generic liveScore send', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-1'],
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { liveScore: true } }
        ]
    });

    try {
        const gameRef = env.firestoreState.doc('teams/team-1/games/game-race');
        const gameChange = makeChange(
            gameRef,
            { homeScore: 10, awayScore: 8 },
            { homeScore: 12, awayScore: 8, updatedBy: 'coach-1' }
        );
        await moduleExports.notifyGameUpdated(gameChange, { params: { teamId: 'team-1', gameId: 'game-race' } });

        const eventRef = env.firestoreState.doc('teams/team-1/games/game-race/liveEvents/event-late');
        const eventResult = await moduleExports.notifyLiveEventCreated(makeSnapshot(eventRef, {
            type: 'stat',
            statKey: 'PTS',
            value: 2,
            playerName: 'Ava Cole',
            homeScore: 12,
            awayScore: 8,
            createdAt: new Date().toISOString(),
            createdBy: 'coach-1'
        }), { params: { teamId: 'team-1', gameId: 'game-race', eventId: 'event-late' } });

        assert.equal(eventResult, null);
        assert.equal(env.messagingCalls.length, 1);
        assert.equal(env.messagingCalls[0].title, 'Live score update');
        assert.equal(env.dedupWrites.some((write) => write.value?.dedupKey === 'score:10:8->12:8'), true);
        assert.equal(env.dedupWrites.some((write) => write.value?.dedupKey === 'score-state:12:8'), true);
        assert.equal(env.dedupWrites.some((write) => write.value?.dedupKey === 'live-event:event-late'), false);
    } finally {
        cleanup();
    }
});

test('notifyLiveEventCreated skips retried live events whose client creation time is stale', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-1'],
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { liveScore: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/game-retry/liveEvents/retried-event');
        const result = await moduleExports.notifyLiveEventCreated(makeSnapshot(ref, {
            type: 'stat',
            statKey: 'PTS',
            value: 2,
            playerName: 'Ava Cole',
            homeScore: 12,
            awayScore: 8,
            clientCreatedAt: new Date(Date.now() - (11 * 60 * 1000)).toISOString(),
            createdAt: new Date().toISOString(),
            createdBy: 'coach-1'
        }), { params: { teamId: 'team-1', gameId: 'game-retry', eventId: 'retried-event' } });

        assert.equal(result, null);
        assert.equal(env.counts.dedupTransactions, 0);
        assert.equal(env.messagingCalls.length, 0);
        assert.equal(env.auditWrites.length, 0);
    } finally {
        cleanup();
    }
});

test('notifyLiveEventCreated ignores routine, generic, and reversed live events', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-1'],
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { liveScore: true } }
        ]
    });

    try {
        const ignoredEvents = [
            { type: 'clock_start' },
            { type: 'clock_pause' },
            { type: 'period_change' },
            { type: 'lineup' },
            { type: 'substitution' },
            { type: 'undo' },
            { type: 'note', text: 'Routine note' },
            { type: 'stat', statKey: 'rebounds', value: 1 },
            { type: 'stat', statKey: 'pts', value: -2 },
            { type: 'baseball', baseballAction: 'single' },
            { type: 'goal', homeScore: 2, awayScore: 1 },
            {
                type: 'goal',
                homeScore: 2,
                awayScore: 1,
                createdAt: new Date(Date.now() - (11 * 60 * 1000)).toISOString()
            }
        ];

        for (const [index, event] of ignoredEvents.entries()) {
            const eventId = `ignored-${index}`;
            const ref = env.firestoreState.doc(`teams/team-1/games/game-3/liveEvents/${eventId}`);
            const result = await moduleExports.notifyLiveEventCreated(
                makeSnapshot(ref, event),
                { params: { teamId: 'team-1', gameId: 'game-3', eventId } }
            );
            assert.equal(result, null);
        }

        assert.equal(env.counts.dedupTransactions, 0);
        assert.equal(env.messagingCalls.length, 0);
        assert.equal(env.auditWrites.length, 0);
    } finally {
        cleanup();
    }
});

test('notifyTeamChatMessageCreated sends mentions and liveChat only to enabled recipients and records audit entries', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: ['assistant@example.com'] },
        parentUserIds: ['parent-1'],
        authUsersByEmail: { 'assistant@example.com': 'coach-2' },
        userDocs: {
            'coach-1': { displayName: 'Coach Prime' },
            'coach-2': { displayName: 'Coach Helper' },
            'parent-1': { displayName: 'Jamie Parent' }
        },
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { liveChat: true, mentions: true } },
            { uid: 'coach-2', deviceId: 'assistant-device', token: 'assistant-token', categories: { liveChat: true, mentions: true } },
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { mentions: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/chatMessages/message-1');
        const snapshot = makeSnapshot(ref, {
            text: 'Nice work @Jamie',
            senderId: 'coach-1',
            senderName: 'Coach Prime',
            conversationId: 'team'
        });
        const context = { params: { teamId: 'team-1', messageId: 'message-1' } };

        const result = await moduleExports.notifyTeamChatMessageCreated(snapshot, context);

        assert.equal(result.length, 2);
        assert.equal(env.messagingCalls.length, 2);
        assert.deepEqual(env.messagingCalls.map((call) => call.data.category).sort(), ['liveChat', 'mentions']);
        assert.deepEqual(env.messagingCalls.map((call) => call.tokens[0]).sort(), ['assistant-token', 'parent-token']);
        assert.deepEqual(env.updatedDocs, [{ path: 'teams/team-1/chatMessages/message-1', value: { mentionedUids: ['parent-1'] } }]);
        assert.equal(env.auditWrites.length, 2);
        assert.deepEqual(env.auditWrites.map((entry) => entry.value.category).sort(), ['liveChat', 'mentions']);
    } finally {
        cleanup();
    }
});

test('notifyTeamChatMessageCreated honors conversation mutes while preserving direct mentions', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: ['assistant@example.com'] },
        parentUserIds: ['parent-1', 'parent-2'],
        authUsersByEmail: { 'assistant@example.com': 'coach-2' },
        userDocs: {
            'coach-1': { displayName: 'Coach Prime' },
            'coach-2': { displayName: 'Coach Helper' },
            'parent-1': {
                displayName: 'Jamie Parent',
                teamChatState: {
                    'team-1': {
                        mutedConversations: {
                            'thread-7': true
                        }
                    }
                }
            },
            'parent-2': {
                displayName: 'Taylor Parent',
                teamChatState: {
                    'team-1': {
                        mutedConversations: {
                            'thread-7': true
                        }
                    }
                }
            }
        },
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { liveChat: true, mentions: true } },
            { uid: 'coach-2', deviceId: 'assistant-device', token: 'assistant-token', categories: { liveChat: true, mentions: true } },
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { liveChat: true, mentions: true } },
            { uid: 'parent-2', deviceId: 'parent-2-device', token: 'parent-2-token', categories: { liveChat: true, mentions: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/chatMessages/message-2');
        const snapshot = makeSnapshot(ref, {
            text: 'Heads up @Jamie',
            senderId: 'coach-1',
            senderName: 'Coach Prime',
            conversationId: 'thread-7'
        });
        const context = { params: { teamId: 'team-1', messageId: 'message-2' } };

        const result = await moduleExports.notifyTeamChatMessageCreated(snapshot, context);

        assert.equal(result.length, 2);
        assert.equal(env.messagingCalls.length, 2);
        assert.deepEqual(env.messagingCalls.map((call) => `${call.data.category}:${call.tokens[0]}`).sort(), [
            'liveChat:assistant-token',
            'mentions:parent-token'
        ]);
        assert.equal(env.messagingCalls.some((call) => call.tokens.includes('parent-2-token')), false);
        assert.equal(env.messagingCalls.every((call) => call.data.conversationId === 'thread-7'), true);
        assert.deepEqual(env.updatedDocs, [{ path: 'teams/team-1/chatMessages/message-2', value: { mentionedUids: ['parent-1'] } }]);
    } finally {
        cleanup();
    }
});

test('notifyTeamChatMessageCreated detects roster name mentions and does not double-push live chat', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-2'],
        userDocs: {
            'coach-1': { displayName: 'Coach Prime' },
            'parent-1': {
                displayName: 'Pat Parent',
                teamChatState: {
                    'team-1': {
                        mutedConversations: {
                            'thread-9': true
                        }
                    }
                }
            },
            'parent-2': { displayName: 'Taylor Parent' }
        },
        playerDocs: {
            'player-1': {
                name: 'Avery Smith',
                parents: [{ userId: 'parent-1', name: 'Pat Parent' }]
            }
        },
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { liveChat: true, mentions: true } },
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { mentions: true, liveChat: false } },
            { uid: 'parent-2', deviceId: 'parent-2-device', token: 'parent-2-token', categories: { liveChat: true, mentions: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/chatMessages/message-2594');
        const snapshot = makeSnapshot(ref, {
            text: 'Can @Avery Smith bring both jerseys?',
            senderId: 'coach-1',
            senderName: 'Coach Prime',
            conversationId: 'thread-9'
        });
        const context = { params: { teamId: 'team-1', messageId: 'message-2594' } };

        const result = await moduleExports.notifyTeamChatMessageCreated(snapshot, context);

        assert.equal(result.length, 2);
        assert.deepEqual(env.messagingCalls.map((call) => `${call.data.category}:${call.tokens[0]}`).sort(), [
            'liveChat:parent-2-token',
            'mentions:parent-token'
        ]);
        assert.equal(env.messagingCalls.filter((call) => call.tokens.includes('parent-token')).length, 1);
        const mentionCall = env.messagingCalls.find((call) => call.data.category === 'mentions');
        assert.equal(mentionCall.data.appRoute, '/messages/team-1?conversation=thread-9');
        assert.equal(mentionCall.data.conversationId, 'thread-9');
        assert.equal(mentionCall.webLink, 'https://allplays.ai/team-chat.html?teamId=team-1&conversationId=thread-9');
        assert.deepEqual(env.updatedDocs, [{ path: 'teams/team-1/chatMessages/message-2594', value: { mentionedUids: ['parent-1'] } }]);
    } finally {
        cleanup();
    }
});

test('notifyOfficiatingNotificationCreated mirrors assignment records to the linked official', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        indexedTargets: [
            { uid: 'official-1', deviceId: 'official-device', token: 'official-token', categories: { officiating: true } },
            { uid: 'other-official', deviceId: 'other-device', token: 'other-token', categories: { officiating: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/officiatingNotifications/notification-1');
        const snapshot = makeSnapshot(ref, {
            type: 'officiating_assignment',
            event: 'assigned',
            position: 'Center Referee',
            gameId: 'game-1',
            gameReference: { gameId: 'game-1', opponent: 'Tigers' },
            recipientOfficialUserId: 'official-1',
            actorUserId: 'coach-1'
        });
        const context = { params: { teamId: 'team-1', notificationId: 'notification-1' } };

        const result = await moduleExports.notifyOfficiatingNotificationCreated(snapshot, context);

        assert.equal(result?.successCount, 1);
        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens, ['official-token']);
        assert.equal(env.messagingCalls[0].title, 'Officiating assignment: Center Referee');
        assert.equal(env.messagingCalls[0].body, 'vs. Tigers is ready for your response.');
        assert.equal(env.messagingCalls[0].data.category, 'officiating');
        assert.equal(env.messagingCalls[0].data.appRoute, '/officials?teamId=team-1');
    } finally {
        cleanup();
    }
});

test('notifyOfficiatingNotificationCreated resolves official recipients by email', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        authUsersByEmail: { 'ref@example.com': 'official-2' },
        indexedTargets: [
            { uid: 'official-2', deviceId: 'official-device', token: 'official-token', categories: { officiating: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/officiatingNotifications/notification-2');
        const snapshot = makeSnapshot(ref, {
            type: 'officiating_assignment',
            event: 'rescheduled',
            position: 'Line Judge',
            gameId: 'game-2',
            gameReference: { gameId: 'game-2', title: 'Cup semifinal' },
            recipientOfficialEmail: 'REF@example.com',
            actorUserId: 'coach-1'
        });
        const context = { params: { teamId: 'team-1', notificationId: 'notification-2' } };

        await moduleExports.notifyOfficiatingNotificationCreated(snapshot, context);

        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens, ['official-token']);
        assert.equal(env.messagingCalls[0].title, 'Officiating assignment updated: Line Judge');
        assert.equal(env.messagingCalls[0].body, 'Cup semifinal was rescheduled.');
    } finally {
        cleanup();
    }
});

test('notifyOfficiatingNotificationCreated routes assigner records to staff recipients', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: ['assistant@example.com'] },
        authUsersByEmail: { 'assistant@example.com': 'coach-2' },
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { officiating: true } },
            { uid: 'coach-2', deviceId: 'assistant-device', token: 'assistant-token', categories: { officiating: true } },
            { uid: 'official-1', deviceId: 'official-device', token: 'official-token', categories: { officiating: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/officiatingNotifications/notification-assigner');
        const snapshot = makeSnapshot(ref, {
            type: 'officiating_assignment',
            event: 'declined',
            position: 'Line Judge',
            gameId: 'game-2',
            gameReference: { gameId: 'game-2', title: 'Cup semifinal' },
            recipientType: 'assigner',
            recipientOfficialUserId: 'official-1',
            actorUserId: 'official-1'
        });
        const context = { params: { teamId: 'team-1', notificationId: 'notification-assigner' } };

        const result = await moduleExports.notifyOfficiatingNotificationCreated(snapshot, context);

        assert.equal(result?.successCount, 2);
        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens.sort(), ['assistant-token', 'coach-token']);
        assert.equal(env.messagingCalls[0].title, 'Officiating assignment declined: Line Judge');
        assert.equal(env.messagingCalls[0].body, 'Cup semifinal needs coverage.');
    } finally {
        cleanup();
    }
});

test('notifyOpenOfficiatingSlots sends open-slot pushes only for newly posted slots', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['official-1'],
        indexedTargets: [
            { uid: 'official-1', deviceId: 'official-device', token: 'official-token', categories: { officiating: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/game-3');
        const context = { params: { teamId: 'team-1', gameId: 'game-3' } };
        const change = makeChange(ref, {
            title: 'Cup final',
            officiatingSelfAssignmentEnabled: true,
            officiatingSlots: [
                { id: 'center', position: 'Center Referee', status: 'open' }
            ]
        }, {
            title: 'Cup final',
            updatedBy: 'coach-1',
            officiatingSelfAssignmentEnabled: true,
            officiatingSlots: [
                { id: 'center', position: 'Center Referee', status: 'open' },
                { id: 'line', position: 'Line Judge', status: 'open' },
                { id: 'claimed', position: 'Assistant Referee', status: 'accepted', officialUserId: 'official-2' }
            ]
        });

        const result = await moduleExports.notifyOpenOfficiatingSlots(change, context);

        assert.equal(result?.successCount, 1);
        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens, ['official-token']);
        assert.equal(env.messagingCalls[0].title, 'Open assignment: Line Judge');
        assert.equal(env.messagingCalls[0].body, 'Cup final needs an official. Claim it before someone else does.');
    } finally {
        cleanup();
    }
});

test('notifyOpenOfficiatingSlots sends notifications when self-assignment is enabled for existing open slots', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['official-1'],
        indexedTargets: [
            { uid: 'official-1', deviceId: 'official-device', token: 'official-token', categories: { officiating: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/game-4');
        const context = { params: { teamId: 'team-1', gameId: 'game-4' } };
        const change = makeChange(ref, {
            title: 'Semifinal',
            officiatingSelfAssignmentEnabled: false,
            officiatingSlots: [
                { id: 'center', position: 'Center Referee', status: 'open' }
            ]
        }, {
            title: 'Semifinal',
            updatedBy: 'coach-1',
            officiatingSelfAssignmentEnabled: true,
            officiatingSlots: [
                { id: 'center', position: 'Center Referee', status: 'open' }
            ]
        });

        const result = await moduleExports.notifyOpenOfficiatingSlots(change, context);

        assert.equal(result?.successCount, 1);
        assert.equal(env.messagingCalls.length, 1);
        assert.equal(env.messagingCalls[0].title, 'Open assignment: Center Referee');
    } finally {
        cleanup();
    }
});

test('notifyOpenOfficiatingSlots sends notifications when a game is created with open self-assignment slots', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['official-1'],
        indexedTargets: [
            { uid: 'official-1', deviceId: 'official-device', token: 'official-token', categories: { officiating: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/game-5');
        const context = { params: { teamId: 'team-1', gameId: 'game-5' } };
        const change = makeChange(ref, null, {
            title: 'Championship',
            createdBy: 'coach-1',
            officiatingSelfAssignmentEnabled: true,
            officiatingSlots: [
                { id: 'line', position: 'Line Judge', status: 'open' }
            ]
        });

        const result = await moduleExports.notifyOpenOfficiatingSlots(change, context);

        assert.equal(result?.successCount, 1);
        assert.equal(env.messagingCalls.length, 1);
        assert.equal(env.messagingCalls[0].title, 'Open assignment: Line Judge');
        assert.equal(env.messagingCalls[0].body, 'Championship needs an official. Claim it before someone else does.');
    } finally {
        cleanup();
    }
});

test('sendFeeUnpaidDueReminders sends eligible unpaid parent fee reminders with amount due date and fee route', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        userDocs: {
            'parent-1': { parentPlayerKeys: ['team-1::player-1'] }
        },
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { fees: true } }
        ],
        nowMillis: Date.parse('2026-06-28T12:00:00.000Z')
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1');
        await ref.set({
            status: 'unpaid',
            playerKey: 'team-1::player-1',
            feeTitle: 'Tournament dues',
            amountCents: 4500,
            dueDate: '2026-06-30T12:00:00.000Z'
        });

        await moduleExports.sendFeeUnpaidDueReminders();

        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens, ['parent-token']);
        assert.equal(env.messagingCalls[0].title, 'Reminder: Tournament dues is due soon');
        assert.equal(env.messagingCalls[0].body, '$45.00 is due Jun 30, 2026 (3 days or less).');
        assert.equal(env.messagingCalls[0].data.category, 'fees');
        assert.equal(env.messagingCalls[0].data.appRoute, '/parent-tools/fees?teamId=team-1&batchId=batch-1&recipientId=recipient-1');
        assert.equal(env.messagingCalls[0].webLink, 'https://allplays.ai/app/#/parent-tools/fees?teamId=team-1&batchId=batch-1&recipientId=recipient-1');
        assert.deepEqual(env.updatedDocs.map((write) => write.path), [
            'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1'
        ]);
        assert.equal(env.updatedDocs[0].value.reminderThresholdHours, 72);
    } finally {
        cleanup();
    }
});

test('sendFeeUnpaidDueReminders excludes paid fees and parents with disabled fee notifications', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        userDocs: {
            'parent-1': { parentPlayerKeys: ['team-1::player-1'] },
            'parent-2': { parentPlayerKeys: ['team-1::player-2'] },
            'parent-3': { parentPlayerKeys: ['team-1::player-3'] }
        },
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { fees: true } },
            { uid: 'parent-2', deviceId: 'paid-device', token: 'paid-token', categories: { fees: true } },
            { uid: 'parent-3', deviceId: 'disabled-device', token: 'disabled-token', categories: { fees: false } }
        ],
        nowMillis: Date.parse('2026-06-28T12:00:00.000Z')
    });

    try {
        await env.firestoreState.doc('teams/team-1/feeBatches/batch-1/feeRecipients/eligible').set({
            status: 'pending',
            playerKey: 'team-1::player-1',
            feeTitle: 'Open dues',
            amountCents: 2500,
            dueDate: '2026-06-29T12:00:00.000Z'
        });
        await env.firestoreState.doc('teams/team-1/feeBatches/batch-1/feeRecipients/paid').set({
            status: 'paid',
            playerKey: 'team-1::player-2',
            feeTitle: 'Paid dues',
            amountCents: 2500,
            dueDate: '2026-06-29T12:00:00.000Z'
        });
        await env.firestoreState.doc('teams/team-1/feeBatches/batch-1/feeRecipients/disabled').set({
            status: 'unpaid',
            playerKey: 'team-1::player-3',
            feeTitle: 'Silent dues',
            amountCents: 2500,
            dueDate: '2026-06-29T12:00:00.000Z'
        });

        await moduleExports.sendFeeUnpaidDueReminders();

        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens, ['parent-token']);
        assert.equal(env.messagingCalls[0].title, 'Reminder: Open dues is due soon');
        assert.deepEqual(env.updatedDocs.map((write) => write.path), [
            'teams/team-1/feeBatches/batch-1/feeRecipients/eligible'
        ]);
    } finally {
        cleanup();
    }
});

test('sendFeeUnpaidDueReminders dedupes repeated scheduler runs without suppressing different fees', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        userDocs: {
            'parent-1': { parentPlayerKeys: ['team-1::player-1'] }
        },
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { fees: true } }
        ],
        nowMillis: Date.parse('2026-06-28T12:00:00.000Z')
    });

    try {
        await env.firestoreState.doc('teams/team-1/feeBatches/batch-1/feeRecipients/recipient-a').set({
            status: 'unpaid',
            playerKey: 'team-1::player-1',
            feeTitle: 'Tournament dues',
            amountCents: 4500,
            dueDate: '2026-06-30T12:00:00.000Z'
        });
        await env.firestoreState.doc('teams/team-1/feeBatches/batch-2/feeRecipients/recipient-b').set({
            status: 'unpaid',
            playerKey: 'team-1::player-1',
            feeTitle: 'Uniform dues',
            amountCents: 3000,
            dueDate: '2026-06-30T12:00:00.000Z'
        });

        await moduleExports.sendFeeUnpaidDueReminders();
        await moduleExports.sendFeeUnpaidDueReminders();

        assert.equal(env.messagingCalls.length, 2);
        assert.deepEqual(env.messagingCalls.map((call) => call.data.appRoute).sort(), [
            '/parent-tools/fees?teamId=team-1&batchId=batch-1&recipientId=recipient-a',
            '/parent-tools/fees?teamId=team-1&batchId=batch-2&recipientId=recipient-b'
        ]);
        assert.deepEqual(env.updatedDocs.map((write) => write.path).sort(), [
            'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-a',
            'teams/team-1/feeBatches/batch-2/feeRecipients/recipient-b'
        ]);
    } finally {
        cleanup();
    }
});

test('notifyFeeAssigned sends fees notifications only to opted-in payer targets', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-1'],
        playerDocs: {
            'player-1': { parents: [{ userId: 'parent-1' }] }
        },
        privateProfileDocs: {
            'player-1': { parents: [{ userId: 'parent-1' }] }
        },
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { fees: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1');
        const snapshot = makeSnapshot(ref, {
            playerId: 'player-1',
            feeTitle: 'Tournament dues',
            amountCents: 4500,
            dueDate: '2026-07-01T12:00:00.000Z'
        });
        const context = { params: { teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' } };

        const result = await moduleExports.notifyFeeAssigned(snapshot, context);

        assert.equal(result?.successCount, 1);
        assert.equal(env.messagingCalls.length, 1);
        assert.equal(env.messagingCalls[0].title, 'New fee assigned: Tournament dues ($45.00)');
        assert.equal(env.messagingCalls[0].body, '$45.00 has been assigned, due Jul 1, 2026.');
        assert.equal(env.messagingCalls[0].data.category, 'fees');
        assert.equal(env.messagingCalls[0].data.appRoute, '/parent-tools/fees?teamId=team-1&batchId=batch-1');
        assert.equal(env.auditWrites.length, 1);
        assert.equal(env.auditWrites[0].value.category, 'fees');
    } finally {
        cleanup();
    }
});

test('notifyFeeAssigned resolves app-created child fee recipients through parentPlayerKeys', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        userDocs: {
            'parent-2': { parentPlayerKeys: ['team-1::player-2'] }
        },
        indexedTargets: [
            { uid: 'parent-2', deviceId: 'parent-device', token: 'parent-token', categories: { fees: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/feeBatches/batch-2/feeRecipients/recipient-2');
        const snapshot = makeSnapshot(ref, {
            childId: 'player-2',
            playerKey: 'team-1::player-2',
            feeTitle: 'Winter dues',
            balanceDueCents: 8000
        });
        const context = { params: { teamId: 'team-1', batchId: 'batch-2', recipientId: 'recipient-2' } };

        const result = await moduleExports.notifyFeeAssigned(snapshot, context);

        assert.equal(result?.successCount, 1);
        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens, ['parent-token']);
        assert.equal(env.messagingCalls[0].title, 'New fee assigned: Winter dues ($80.00)');
    } finally {
        cleanup();
    }
});

test('notifyFeeAssigned sends one combined batch assignment push when a parent has multiple recipients', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        userDocs: {
            'parent-1': { parentPlayerKeys: ['team-1::player-1', 'team-1::player-2'] }
        },
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { fees: true } }
        ]
    });

    try {
        const recipientA = {
            playerKey: 'team-1::player-1',
            childName: 'Avery',
            feeTitle: 'Spring dues',
            amountCents: 2500,
            dueDate: '2026-07-01T12:00:00.000Z'
        };
        const recipientB = {
            playerKey: 'team-1::player-2',
            childName: 'Blake',
            feeTitle: 'Spring dues',
            amountCents: 2500,
            dueDate: '2026-07-01T12:00:00.000Z'
        };
        const refA = env.firestoreState.doc('teams/team-1/feeBatches/batch-3/feeRecipients/recipient-a');
        const refB = env.firestoreState.doc('teams/team-1/feeBatches/batch-3/feeRecipients/recipient-b');
        await refA.set(recipientA);
        await refB.set(recipientB);
        const contextA = { params: { teamId: 'team-1', batchId: 'batch-3', recipientId: 'recipient-a' } };
        const contextB = { params: { teamId: 'team-1', batchId: 'batch-3', recipientId: 'recipient-b' } };

        const firstResult = await moduleExports.notifyFeeAssigned(makeSnapshot(refA, recipientA), contextA);
        const secondResult = await moduleExports.notifyFeeAssigned(makeSnapshot(refB, recipientB), contextB);

        assert.equal(firstResult?.successCount, 1);
        assert.equal(secondResult, null);
        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens, ['parent-token']);
        assert.equal(env.messagingCalls[0].title, 'New fees assigned: Spring dues ($50.00 total)');
        assert.equal(env.messagingCalls[0].body, '$50.00 has been assigned for Avery and Blake, due Jul 1, 2026.');
        assert.equal(env.counts.parentQueries, 2);
        assert.equal(env.counts.userRecordGets, 1);
    } finally {
        cleanup();
    }
});

test('notifyFeeAssigned releases assignment claims when delivery fails so retries can resend', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        userDocs: {
            'parent-1': { parentPlayerKeys: ['team-1::player-1'] }
        },
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { fees: true } }
        ],
        sendEachErrors: [new Error('temporary FCM outage')]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/feeBatches/batch-5/feeRecipients/recipient-5');
        const snapshot = makeSnapshot(ref, {
            playerKey: 'team-1::player-1',
            feeTitle: 'Retry dues',
            amountCents: 2500
        });
        const context = { params: { teamId: 'team-1', batchId: 'batch-5', recipientId: 'recipient-5' } };

        await assert.rejects(() => moduleExports.notifyFeeAssigned(snapshot, context), /temporary FCM outage/);
        const retryResult = await moduleExports.notifyFeeAssigned(snapshot, context);

        assert.equal(retryResult?.successCount, 1);
        assert.equal(env.messagingCalls.length, 2);
        assert.equal(env.deletedPaths.includes('teams/team-1/feeBatches/batch-5/assignmentNotificationClaims/parent-1'), true);
        assert.equal(env.auditWrites.length, 1);
    } finally {
        cleanup();
    }
});

test('notifyFeeAssigned stays silent when the payer disabled fee notifications', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        userDocs: {
            'parent-3': { parentPlayerKeys: ['team-1::player-3'] }
        },
        indexedTargets: [
            { uid: 'parent-3', deviceId: 'parent-device', token: 'parent-token', categories: { fees: false } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/feeBatches/batch-4/feeRecipients/recipient-4');
        const snapshot = makeSnapshot(ref, {
            playerKey: 'team-1::player-3',
            feeTitle: 'Silent dues',
            amountCents: 2500
        });
        const context = { params: { teamId: 'team-1', batchId: 'batch-4', recipientId: 'recipient-4' } };

        const result = await moduleExports.notifyFeeAssigned(snapshot, context);

        assert.equal(result, null);
        assert.equal(env.messagingCalls.length, 0);
        assert.equal(env.auditWrites.length, 0);
    } finally {
        cleanup();
    }
});

test('notifyFeeMarkedPaid sends fees notifications to payer and staff and records audit entries', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: ['assistant@example.com'] },
        parentUserIds: ['parent-1'],
        authUsersByEmail: { 'assistant@example.com': 'coach-2' },
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { fees: true } },
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { fees: true } },
            { uid: 'coach-2', deviceId: 'assistant-device', token: 'assistant-token', categories: { fees: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/feeBatches/batch-1/feeRecipients/recipient-2');
        const change = makeChange(ref, { status: 'pending', amountPaidCents: 0 }, {
            status: 'paid',
            feeTitle: 'Tournament dues',
            userId: 'parent-1',
            parentName: 'Pat Parent',
            amountPaidCents: 2500,
            manualPayment: { amountPaidCents: 2500 }
        });
        const context = { params: { teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-2' } };

        const result = await moduleExports.notifyFeeMarkedPaid(change, context);

        assert.equal(result, null);
        assert.equal(env.messagingCalls.length, 2);
        assert.deepEqual(env.messagingCalls.map((call) => call.tokens.length).sort(), [1, 2]);
        const payerNotification = env.messagingCalls.find((call) => call.tokens.includes('parent-token'));
        const staffNotification = env.messagingCalls.find((call) => call.tokens.includes('coach-token'));
        assert.equal(payerNotification.title, 'Payment received: Tournament dues');
        assert.equal(payerNotification.body, 'We received your $25.00 payment. Thank you!');
        assert.equal(payerNotification.data.appRoute, '/parent-tools/fees?teamId=team-1&batchId=batch-1&recipientId=recipient-2');
        assert.equal(staffNotification.title, 'Fee paid: Tournament dues');
        assert.equal(staffNotification.body, 'Pat Parent paid $25.00.');
        assert.equal(staffNotification.data.appRoute, '/teams/team-1/fees/batch-1?recipientId=recipient-2');
        assert.equal(env.auditWrites.length, 2);
        assert.deepEqual(env.auditWrites.map((entry) => entry.value.category), ['fees', 'fees']);
        assert.deepEqual(env.auditWrites.map((entry) => entry.value.appRoute).sort(), [
            '/parent-tools/fees?teamId=team-1&batchId=batch-1&recipientId=recipient-2',
            '/teams/team-1/fees/batch-1?recipientId=recipient-2'
        ]);
    } finally {
        cleanup();
    }
});


test('notifyFeeMarkedPaid avoids payment wording when a credit marks the fee as paid', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: ['assistant@example.com'] },
        parentUserIds: ['parent-1'],
        authUsersByEmail: { 'assistant@example.com': 'coach-2' },
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { fees: true } },
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { fees: true } },
            { uid: 'coach-2', deviceId: 'assistant-device', token: 'assistant-token', categories: { fees: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/feeBatches/batch-1/feeRecipients/recipient-3');
        const change = makeChange(ref, { status: 'pending', amountPaidCents: 2500 }, {
            status: 'paid',
            feeTitle: 'Tournament dues',
            userId: 'parent-1',
            parentName: 'Pat Parent',
            amountPaidCents: 2500,
            amountDueCents: 2500
        });
        const context = { params: { teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-3' } };

        const result = await moduleExports.notifyFeeMarkedPaid(change, context);

        assert.equal(result, null);
        assert.equal(env.messagingCalls.length, 2);
        const payerNotification = env.messagingCalls.find((call) => call.tokens.includes('parent-token'));
        const staffNotification = env.messagingCalls.find((call) => call.tokens.includes('coach-token'));
        assert.equal(payerNotification.title, 'Fee paid: Tournament dues');
        assert.equal(payerNotification.body, 'Your fee balance is now marked as paid.');
        assert.equal(staffNotification.title, 'Fee paid: Tournament dues');
        assert.equal(staffNotification.body, "Pat Parent's fee balance is now marked as paid.");
    } finally {
        cleanup();
    }
});

test('notifyPublishedCertificateAward sends awards notifications to linked parents', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        userDocs: {
            'parent-1': { parentPlayerKeys: ['team-1::player-1'] },
            'parent-2': { parentPlayerKeys: ['team-1::player-2'] }
        },
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { awards: true } },
            { uid: 'parent-2', deviceId: 'other-parent-device', token: 'other-parent-token', categories: { awards: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/certificates/certificate-1');
        const publishedCertificate = {
            status: 'published',
            playerId: 'player-1',
            recipientName: 'Jordan B.',
            awardTitle: 'Player of the Match'
        };
        await ref.set(publishedCertificate);

        await moduleExports.notifyPublishedCertificateAward(
            makeChange(ref, { status: 'draft', playerId: 'player-1' }, publishedCertificate),
            { params: { teamId: 'team-1', certificateId: 'certificate-1' }, eventId: 'event-award-1' }
        );

        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens, ['parent-token']);
        assert.equal(env.messagingCalls[0].title, 'Award published for Jordan B.');
        assert.equal(env.messagingCalls[0].body, 'Player of the Match is ready to view in ParentTools.');
        assert.equal(env.messagingCalls[0].data.category, 'awards');
        assert.equal(env.messagingCalls[0].data.appRoute, '/parent-tools/certificates?teamId=team-1&certificateId=certificate-1');
        assert.equal(env.messagingCalls[0].webLink, 'https://allplays.ai/app/#/parent-tools/certificates?teamId=team-1&certificateId=certificate-1');
        assert.equal(env.auditWrites.length, 1);
        assert.equal(env.auditWrites[0].value.category, 'awards');
        assert.equal(env.updatedDocs.some((write) => (
            write.path === 'teams/team-1/certificates/certificate-1'
            && write.value.awardNotificationProcessedEventId === 'event-award-1'
        )), true);

        const storedCertificate = (await ref.get()).data();
        assert.equal(storedCertificate.awardNotificationProcessedEventId, 'event-award-1');
        assert.equal('awardNotificationProcessingEventId' in storedCertificate, false);
        assert.equal('awardNotificationProcessingStartedAt' in storedCertificate, false);
    } finally {
        cleanup();
    }
});

test('notifyParentMembershipRequestCreated sends access notifications only to staff reviewers', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: ['assistant@example.com'] },
        parentUserIds: ['parent-1'],
        authUsersByEmail: { 'assistant@example.com': 'coach-2' },
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { access: true } },
            { uid: 'coach-2', deviceId: 'assistant-device', token: 'assistant-token', categories: { access: true } },
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { access: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/membershipRequests/request-1');
        const snapshot = makeSnapshot(ref, {
            requesterUserId: 'parent-1',
            requesterName: 'Sam P.',
            playerName: 'Jordan B.',
            relation: 'Parent'
        });
        const context = { params: { teamId: 'team-1', requestId: 'request-1' } };

        await moduleExports.notifyParentMembershipRequestCreated(snapshot, context);

        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens.sort(), ['assistant-token', 'coach-token']);
        assert.equal(env.messagingCalls[0].title, 'Access request: Sam P. for Jordan B.');
        assert.equal(env.messagingCalls[0].data.category, 'access');
        assert.equal(env.messagingCalls[0].data.appRoute, '/parent-tools/access?teamId=team-1');
        assert.equal(env.messagingCalls[0].webLink, 'https://allplays.ai/edit-roster.html?teamId=team-1');
    } finally {
        cleanup();
    }
});

test('notifyParentMembershipRequestUpdated sends approval and decline decisions only once to the requester', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', name: 'Team Bears', adminEmails: [] },
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { access: true } }
        ]
    });

    try {
        const approveRef = env.firestoreState.doc('teams/team-1/membershipRequests/request-2');
        const declineRef = env.firestoreState.doc('teams/team-1/membershipRequests/request-3');
        const approveContext = { params: { teamId: 'team-1', requestId: 'request-2' } };
        const declineContext = { params: { teamId: 'team-1', requestId: 'request-3' } };

        const firstResult = await moduleExports.notifyParentMembershipRequestUpdated(
            makeChange(approveRef,
                { requesterUserId: 'parent-1', playerName: 'Jordan B.', status: 'pending' },
                { requesterUserId: 'parent-1', playerName: 'Jordan B.', status: 'approved' }
            ),
            approveContext
        );
        const secondResult = await moduleExports.notifyParentMembershipRequestUpdated(
            makeChange(approveRef,
                { requesterUserId: 'parent-1', playerName: 'Jordan B.', status: 'approved' },
                { requesterUserId: 'parent-1', playerName: 'Jordan B.', status: 'approved', decisionNote: 'Still approved' }
            ),
            approveContext
        );
        await moduleExports.notifyParentMembershipRequestUpdated(
            makeChange(declineRef,
                { requesterUserId: 'parent-1', playerName: 'Casey B.', status: 'pending' },
                { requesterUserId: 'parent-1', playerName: 'Casey B.', status: 'declined' }
            ),
            declineContext
        );
        await moduleExports.notifyParentMembershipRequestUpdated(
            makeChange(declineRef,
                { requesterUserId: 'parent-1', playerName: 'Casey B.', status: 'declined' },
                { requesterUserId: 'parent-1', playerName: 'Casey B.', status: 'declined', decisionNote: 'Still declined' }
            ),
            declineContext
        );

        assert.equal(firstResult, null);
        assert.equal(secondResult, null);
        assert.equal(env.messagingCalls.length, 2);
        assert.equal(env.messagingCalls[0].tokens[0], 'parent-token');
        assert.equal(env.messagingCalls[0].title, 'You now have access to Team Bears');
        assert.equal(env.messagingCalls[0].webLink, 'https://allplays.ai/app/#/teams/team-1');
        assert.equal(env.messagingCalls[1].tokens[0], 'parent-token');
        assert.equal(env.messagingCalls[1].title, 'Access request declined for Team Bears');
        assert.equal(env.messagingCalls[1].body, 'Your request for Casey B. was declined.');
    } finally {
        cleanup();
    }
});

test('notifyRegistrationSubmitted sends access notifications to staff review targets', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { access: true } },
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { access: true } }
        ],
        parentUserIds: ['parent-1']
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/registrationForms/form-1/registrations/reg-1');
        const snapshot = makeSnapshot(ref, {
            participant: { name: 'Jordan B.' },
            programName: 'Summer Skills Camp'
        });
        const context = { params: { teamId: 'team-1', formId: 'form-1', registrationId: 'reg-1' } };

        await moduleExports.notifyRegistrationSubmitted(snapshot, context);

        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens, ['coach-token']);
        assert.equal(env.messagingCalls[0].title, 'Registration submitted: Jordan B.');
        assert.equal(env.messagingCalls[0].data.appRoute, '/teams/team-1/registrations/form-1');
        assert.equal(env.messagingCalls[0].webLink, 'https://allplays.ai/edit-roster.html?teamId=team-1');
    } finally {
        cleanup();
    }
});

test('notifyRegistrationStatusChanged sends distinct approve, decline, and promotion notifications without refiring on resave', async () => {
    const baseOptions = {
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        authUsersByEmail: { 'guardian@example.com': 'parent-1' },
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { access: true } }
        ]
    };

    const approvedEnv = loadNotificationInternals(baseOptions);
    try {
        const ref = approvedEnv.env.firestoreState.doc('teams/team-1/registrationForms/form-1/registrations/reg-approved');
        const context = { params: { teamId: 'team-1', formId: 'form-1', registrationId: 'reg-approved' } };
        await approvedEnv.moduleExports.notifyRegistrationStatusChanged(
            makeChange(ref,
                { guardian: { email: 'guardian@example.com' }, participant: { name: 'Jordan B.' }, programName: 'Summer Skills Camp', status: 'pending' },
                { guardian: { email: 'guardian@example.com' }, participant: { name: 'Jordan B.' }, programName: 'Summer Skills Camp', status: 'enrolled' }
            ),
            context
        );
        await approvedEnv.moduleExports.notifyRegistrationStatusChanged(
            makeChange(ref,
                { guardian: { email: 'guardian@example.com' }, participant: { name: 'Jordan B.' }, programName: 'Summer Skills Camp', status: 'enrolled' },
                { guardian: { email: 'guardian@example.com' }, participant: { name: 'Jordan B.' }, programName: 'Summer Skills Camp', status: 'enrolled', decisionNote: 'Resaved' }
            ),
            context
        );

        assert.equal(approvedEnv.env.messagingCalls.length, 1);
        assert.equal(approvedEnv.env.messagingCalls[0].title, 'Registration approved: Jordan B.');
        assert.equal(approvedEnv.env.messagingCalls[0].body, 'Jordan B. is approved for Summer Skills Camp.');
        assert.equal(approvedEnv.env.messagingCalls[0].data.appRoute, '/parent-tools/registrations/team-1/form-1?registrationId=reg-approved');
    } finally {
        approvedEnv.cleanup();
    }

    const declinedEnv = loadNotificationInternals(baseOptions);
    try {
        const ref = declinedEnv.env.firestoreState.doc('teams/team-1/registrationForms/form-1/registrations/reg-declined');
        const context = { params: { teamId: 'team-1', formId: 'form-1', registrationId: 'reg-declined' } };
        await declinedEnv.moduleExports.notifyRegistrationStatusChanged(
            makeChange(ref,
                { guardian: { email: 'guardian@example.com' }, participant: { name: 'Jordan B.' }, programName: 'Summer Skills Camp', status: 'pending' },
                { guardian: { email: 'guardian@example.com' }, participant: { name: 'Jordan B.' }, programName: 'Summer Skills Camp', status: 'rejected' }
            ),
            context
        );

        assert.equal(declinedEnv.env.messagingCalls.length, 1);
        assert.equal(declinedEnv.env.messagingCalls[0].title, 'Registration declined: Jordan B.');
        assert.equal(declinedEnv.env.messagingCalls[0].body, "Jordan B.'s Summer Skills Camp application was declined.");
    } finally {
        declinedEnv.cleanup();
    }

    const promotedEnv = loadNotificationInternals(baseOptions);
    try {
        const ref = promotedEnv.env.firestoreState.doc('teams/team-1/registrationForms/form-1/registrations/reg-promoted');
        const context = { params: { teamId: 'team-1', formId: 'form-1', registrationId: 'reg-promoted' } };
        await promotedEnv.moduleExports.notifyRegistrationStatusChanged(
            makeChange(ref,
                { guardian: { email: 'guardian@example.com' }, participant: { name: 'Jordan B.' }, programName: 'Summer Skills Camp', status: 'waitlisted' },
                { guardian: { email: 'guardian@example.com' }, participant: { name: 'Jordan B.' }, programName: 'Summer Skills Camp', status: 'offer-extended' }
            ),
            context
        );

        assert.equal(promotedEnv.env.messagingCalls.length, 1);
        assert.equal(promotedEnv.env.messagingCalls[0].title, 'Spot available: Jordan B.');
        assert.equal(promotedEnv.env.messagingCalls[0].body, 'Summer Skills Camp has an available spot for Jordan B..');
    } finally {
        promotedEnv.cleanup();
    }
});

test('notifyInviteRedeemed resolves the inviter only when a roster or staff invite is accepted', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        userDocs: {
            'parent-2': { displayName: 'Pat R.' }
        },
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { access: true } },
            { uid: 'coach-2', deviceId: 'other-coach-device', token: 'other-coach-token', categories: { access: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('accessCodes/CODE123');
        const context = { params: { codeId: 'CODE123' } };

        await moduleExports.notifyInviteRedeemed(
            makeChange(ref,
                { type: 'parent_invite', teamId: 'team-1', generatedBy: 'coach-1', used: false },
                { type: 'parent_invite', teamId: 'team-1', generatedBy: 'coach-1', used: true, usedBy: 'parent-2' }
            ),
            context
        );
        await moduleExports.notifyInviteRedeemed(
            makeChange(ref,
                { type: 'parent_invite', teamId: 'team-1', generatedBy: 'coach-1', used: true, usedBy: 'parent-2' },
                { type: 'parent_invite', teamId: 'team-1', generatedBy: 'coach-1', used: true, usedBy: 'parent-2', note: 'Resaved' }
            ),
            context
        );

        assert.equal(env.messagingCalls.length, 1);
        assert.deepEqual(env.messagingCalls[0].tokens, ['coach-token']);
        assert.equal(env.messagingCalls[0].title, 'Pat R. accepted your invite');
        assert.equal(env.messagingCalls[0].webLink, 'https://allplays.ai/app/#/teams/team-1');
    } finally {
        cleanup();
    }
});

for (const category of ['schedule', 'practice', 'liveScore', 'liveChat', 'mentions', 'fees', 'access']) {
    test(`sendCategoryNotification suppresses ${category} when every indexed recipient opted out`, async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: { ownerId: 'coach-1', adminEmails: [] },
            indexedRecipients: [
                { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { [category]: false } }
            ]
        });

        try {
            const result = await internals.sendCategoryNotification({
                teamId: 'team-1',
                gameId: `${category}-game`,
                category,
                title: 'Notification regression check',
                body: 'This should not send.'
            });

            assert.equal(result, null);
            assert.equal(env.messagingCalls.length, 0);
            assert.equal(env.inboxWrites.length, 0);
            assert.equal(env.auditWrites.length, 0);
        } finally {
            cleanup();
        }
    });
}
