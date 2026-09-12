import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadNotificationInternals } = require('./send-category-notification-test-helpers.cjs');
const {
    diamondNotificationProviderReceiptId
} = require('../diamond-scorebook-notification-sender.cjs');

function buildLargeFixture({ recipients = 500, devicesPerRecipient = 1 }) {
    const indexedTargets = [];
    for (let recipientIndex = 0; recipientIndex < recipients; recipientIndex += 1) {
        const uid = `user-${recipientIndex}`;
        for (let deviceIndex = 0; deviceIndex < devicesPerRecipient; deviceIndex += 1) {
            indexedTargets.push({
                uid,
                deviceId: `device-${deviceIndex}`,
                token: `token-${recipientIndex}-${deviceIndex}`,
                categories: { schedule: true }
            });
        }
    }

    return {
        teamDoc: {
            ownerId: 'user-0',
            adminEmails: []
        },
        parentUserIds: Array.from({ length: recipients - 1 }, (_, index) => `user-${index + 1}`),
        indexedTargets
    };
}


function buildExistingInboxItems(count) {
    const baseMillis = Date.parse('2026-06-28T11:59:00.000Z');
    return Array.from({ length: count }, (_, index) => ({
        id: `existing-${index}`,
        createdAtMillis: baseMillis - index
    }));
}

describe('sendCategoryNotification load coverage', () => {
    it('suppresses Diamond resource and recipient identifiers from generic failure telemetry', async () => {
        const secretTeamId = 'diamond-team-secret';
        const secretGameId = 'diamond-game-secret';
        const secretUserId = 'diamond-user-secret';
        const secretToken = 'diamond-token-secret';
        const secretProviderError = 'provider failed for diamond-game-secret';
        const { internals, env, cleanup } = loadNotificationInternals({
            teamId: secretTeamId,
            teamDoc: {
                ownerId: secretUserId,
                adminEmails: []
            },
            indexedTargets: [
                {
                    uid: secretUserId,
                    deviceId: 'device-secret',
                    token: secretToken,
                    categories: { liveScore: true }
                }
            ],
            sendEachErrors: [new Error(secretProviderError)],
            rejectedNotificationInboxUids: [secretUserId]
        });

        try {
            const result = await internals.sendCategoryNotification({
                teamId: secretTeamId,
                gameId: secretGameId,
                eventId: 'diamond-event-secret',
                category: 'liveScore',
                title: 'Score update',
                body: 'The score changed.',
                suppressResourceTelemetry: true
            });

            assert.equal(result.failureCount, 1);
            assert.equal(result.inboxFailureCount, 1);
            assert.ok(env.platformLogs.some((entry) => entry.level === 'warn'));
            assert.equal(env.auditWrites[0].value.teamId, secretTeamId);
            assert.equal(env.auditWrites[0].value.gameId, secretGameId);
            assert.deepEqual(env.auditWrites[0].value.targetUserIds, [secretUserId]);
            const serializedLogs = JSON.stringify(env.platformLogs);
            for (const privateValue of [
                secretTeamId,
                secretGameId,
                secretUserId,
                secretToken,
                secretProviderError
            ]) {
                assert.equal(serializedLogs.includes(privateValue), false);
            }
        } finally {
            cleanup();
        }
    });

    it('uses a stable delivery key for one inbox row per user and preserves read state on retry', async () => {
        const deliveryIdempotencyKey = `diamond-${'a'.repeat(64)}`;
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            indexedTargets: [
                {
                    uid: 'coach-1',
                    deviceId: 'coach-device',
                    token: 'coach-token',
                    categories: { liveScore: true }
                }
            ]
        });

        const request = {
            teamId: 'team-1',
            gameId: 'game-1',
            eventId: 'event-1',
            category: 'liveScore',
            title: 'Score update',
            body: 'The score changed.',
            dedupKey: 'stable-original',
            deliveryIdempotencyKey,
            suppressResourceTelemetry: true
        };
        const inboxPath = `users/coach-1/notificationInbox/${deliveryIdempotencyKey}`;

        try {
            await internals.sendCategoryNotification(request);
            const firstInboxRecord = env.getStoredDoc(inboxPath);
            assert.equal(firstInboxRecord.deliveryIdempotencyKey, deliveryIdempotencyKey);
            env.setStoredDoc(inboxPath, {
                ...firstInboxRecord,
                readAt: 'read-marker'
            });

            await internals.sendCategoryNotification(request);

            assert.equal(env.getNotificationInboxDocCount('coach-1'), 1);
            assert.equal(env.getStoredDoc(inboxPath).readAt, 'read-marker');
            assert.equal(env.messagingCalls.length, 2);
            assert.deepEqual(
                env.messagingCalls.map((call) => call.webpush?.notification?.tag),
                [deliveryIdempotencyKey, deliveryIdempotencyKey]
            );
        } finally {
            cleanup();
        }
    });

    it('keeps retained Diamond inbox rows generation-scoped through the production delivery adapter', async () => {
        const firstInstanceId = '00000000-0000-4000-8000-000000000101';
        const replacementInstanceId = '00000000-0000-4000-8000-000000000102';
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            indexedTargets: [
                {
                    uid: 'coach-1',
                    deviceId: 'coach-device',
                    token: 'coach-token',
                    categories: { liveScore: true }
                }
            ]
        });
        const makeRequest = (instanceId) => ({
            teamId: 'team-1',
            gameId: 'game-1',
            instanceId,
            sourceEventId: 'event-8',
            category: 'liveScore',
            title: 'Game update',
            body: 'Away Player homered · Score 0–1',
            link: 'https://share.allplays.ai/watch?teamId=team-1&gameId=game-1',
            dedupKey: `diamond-v2:team-1:game-1:instance:${instanceId}:notification:r0000000008`
        });
        const firstRequest = makeRequest(firstInstanceId);
        const replacementRequest = makeRequest(replacementInstanceId);
        const firstProviderId = diamondNotificationProviderReceiptId(firstRequest);
        const replacementProviderId = diamondNotificationProviderReceiptId(replacementRequest);
        const dispatchedProviderIds = new Set();
        const deliveryHooks = (providerId) => ({
            beforeProviderDispatch: async () => {
                if (dispatchedProviderIds.has(providerId)) {
                    throw new Error('The durable provider boundary was already crossed.');
                }
                dispatchedProviderIds.add(providerId);
            }
        });

        try {
            await internals.deliverDiamondScorebookNotification(firstRequest, {
                instanceId: firstInstanceId,
                idempotencyKey: firstRequest.idempotencyKey,
                providerRequestId: firstProviderId
            }, deliveryHooks(firstProviderId));
            const firstInboxPath = `users/coach-1/notificationInbox/${firstProviderId}`;
            const retainedFirst = env.getStoredDoc(firstInboxPath);
            env.setStoredDoc(firstInboxPath, { ...retainedFirst, readAt: 'read-marker' });

            await assert.rejects(
                internals.deliverDiamondScorebookNotification(firstRequest, {
                    instanceId: firstInstanceId,
                    idempotencyKey: firstRequest.idempotencyKey,
                    providerRequestId: firstProviderId
                }, deliveryHooks(firstProviderId)),
                /provider boundary was already crossed/
            );
            await internals.deliverDiamondScorebookNotification(replacementRequest, {
                instanceId: replacementInstanceId,
                idempotencyKey: replacementRequest.idempotencyKey,
                providerRequestId: replacementProviderId
            }, deliveryHooks(replacementProviderId));

            assert.equal(env.getNotificationInboxDocCount('coach-1'), 2);
            assert.equal(env.getStoredDoc(firstInboxPath).readAt, 'read-marker');
            assert.equal(
                env.getStoredDoc(`users/coach-1/notificationInbox/${replacementProviderId}`)
                    .deliveryIdempotencyKey,
                replacementProviderId
            );
            assert.deepEqual(
                env.messagingCalls.map((call) => call.webpush?.notification?.tag),
                [firstProviderId, replacementProviderId]
            );

            await assert.rejects(
                internals.deliverDiamondScorebookNotification(
                    { ...firstRequest, body: 'Conflicting payload' },
                    {
                        instanceId: firstInstanceId,
                        idempotencyKey: firstRequest.idempotencyKey,
                        providerRequestId: firstProviderId
                    },
                    deliveryHooks(firstProviderId)
                ),
                /idempotency validation failed/
            );
            assert.throws(
                () => internals.deliverDiamondScorebookNotification(firstRequest, {
                    instanceId: replacementInstanceId,
                    idempotencyKey: firstRequest.idempotencyKey,
                    providerRequestId: replacementProviderId
                }, deliveryHooks(replacementProviderId)),
                /generation is inconsistent/
            );
            assert.equal(env.getNotificationInboxDocCount('coach-1'), 2);
        } finally {
            cleanup();
        }
    });

    it('selects a shared-game audience by team while routing inbox and FCM data to the canonical Diamond source', async () => {
        const instanceId = '00000000-0000-4000-8000-000000000101';
        const audienceTeamId = 'team-2';
        const sourceTeamId = 'team-1';
        const sourceGameId = 'game-1';
        const sharedGamePath = 'organizations/org-1/sharedGames/shared-1';
        const idempotencyKey = `diamond-v2:${audienceTeamId}:${sourceGameId}:instance:${instanceId}:notification:r0000000008`;
        const link = `https://share.allplays.ai/watch?teamId=${sourceTeamId}&gameId=${sourceGameId}`;
        const sharedRouteGameId = `shared_${encodeURIComponent(sharedGamePath)}`;
        const appRoute = `/schedule/${audienceTeamId}/${encodeURIComponent(sharedRouteGameId)}?section=game&sharedGamePath=${encodeURIComponent(sharedGamePath)}`;
        const request = {
            teamId: audienceTeamId,
            gameId: sourceGameId,
            viewerTeamId: sourceTeamId,
            viewerGameId: sourceGameId,
            sharedGamePath,
            instanceId,
            sourceRevision: 8,
            sourceEventId: 'event-8',
            category: 'liveScore',
            title: 'Game update',
            body: 'Away Player homered · Score 0–1',
            liveViewerLink: link,
            link,
            dedupKey: idempotencyKey,
            idempotencyKey
        };
        const providerId = diamondNotificationProviderReceiptId(request);
        const { internals, env, cleanup } = loadNotificationInternals({
            teamId: audienceTeamId,
            teamDoc: {
                ownerId: 'shared-coach',
                adminEmails: []
            },
            indexedTargets: [
                {
                    uid: 'shared-coach',
                    deviceId: 'shared-device',
                    token: 'shared-token',
                    categories: { liveScore: true }
                }
            ]
        });

        try {
            const result = await internals.deliverDiamondScorebookNotification(
                request,
                {
                    instanceId,
                    idempotencyKey,
                    providerRequestId: providerId
                },
                { beforeProviderDispatch: async () => {} }
            );

            assert.equal(result.successCount, 1);
            const inbox = env.getStoredDoc(
                `users/shared-coach/notificationInbox/${providerId}`
            );
            assert.equal(inbox.teamId, audienceTeamId);
            assert.equal(inbox.gameId, sharedRouteGameId);
            assert.equal(inbox.appRoute, appRoute);
            assert.equal(env.messagingCalls.length, 1);
            assert.equal(env.messagingCalls[0].data.teamId, audienceTeamId);
            assert.equal(env.messagingCalls[0].data.gameId, sharedRouteGameId);
            assert.equal(env.messagingCalls[0].data.appRoute, appRoute);
            assert.equal(env.messagingCalls[0].webLink, link);
            assert.equal(env.auditWrites[0].value.teamId, audienceTeamId);
        } finally {
            cleanup();
        }
    });

    it('surfaces an ambiguous FCM response after the durable boundary and never bypasses that fence', async () => {
        const instanceId = '00000000-0000-4000-8000-000000000101';
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            indexedTargets: [
                {
                    uid: 'coach-1',
                    deviceId: 'coach-device',
                    token: 'coach-token',
                    categories: { liveScore: true }
                }
            ],
            sendEachErrors: [Object.assign(new Error('Response lost after send'), {
                code: 'messaging/internal-error'
            })]
        });
        const deliveryRequest = {
            teamId: 'team-1',
            gameId: 'game-1',
            instanceId,
            sourceEventId: 'event-8',
            category: 'liveScore',
            title: 'Game update',
            body: 'Away Player homered · Score 0–1',
            link: 'https://share.allplays.ai/watch?teamId=team-1&gameId=game-1',
            dedupKey: `diamond-v2:team-1:game-1:instance:${instanceId}:notification:r0000000008`
        };
        const providerId = diamondNotificationProviderReceiptId(deliveryRequest);
        let dispatchBoundaryCrossed = false;
        const metadata = {
            instanceId,
            idempotencyKey: deliveryRequest.idempotencyKey,
            providerRequestId: providerId
        };
        const hooks = {
            beforeProviderDispatch: async () => {
                if (dispatchBoundaryCrossed) {
                    throw new Error('The durable provider boundary was already crossed.');
                }
                assert.equal(env.getNotificationInboxDocCount('coach-1'), 1);
                assert.equal(env.messagingCalls.length, 0);
                dispatchBoundaryCrossed = true;
            }
        };

        try {
            await assert.rejects(
                async () => internals.deliverDiamondScorebookNotification(
                    deliveryRequest,
                    metadata
                ),
                /provider-dispatch boundary is required/
            );
            assert.equal(env.getNotificationInboxDocCount('coach-1'), 0);
            assert.equal(env.messagingCalls.length, 0);

            const result = await internals.deliverDiamondScorebookNotification(
                deliveryRequest,
                metadata,
                hooks
            );
            assert.equal(result.providerDispatchAttempted, true);
            assert.equal(result.providerDeliveryUncertain, true);
            assert.equal(result.uncertainFailureCount, 1);
            assert.equal(result.inboxWriteCount, 1);
            assert.equal(env.messagingCalls.length, 1);
            assert.equal(env.getNotificationInboxDocCount('coach-1'), 1);

            await assert.rejects(
                internals.deliverDiamondScorebookNotification(
                    deliveryRequest,
                    metadata,
                    hooks
                ),
                /provider boundary was already crossed/
            );
            assert.equal(env.messagingCalls.length, 1);
            assert.equal(env.getNotificationInboxDocCount('coach-1'), 1);
        } finally {
            cleanup();
        }
    });

    it('fails before push when a stable delivery key is reused with changed visible content', async () => {
        const deliveryIdempotencyKey = `diamond-${'b'.repeat(64)}`;
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            indexedTargets: [
                {
                    uid: 'coach-1',
                    deviceId: 'coach-device',
                    token: 'coach-token',
                    categories: { rsvp: true }
                }
            ]
        });
        const original = {
            teamId: 'team-1',
            gameId: 'game-1',
            eventId: 'event-1',
            childId: 'child-1',
            category: 'rsvp',
            title: 'Score update',
            body: 'The score changed.',
            deliveryIdempotencyKey,
            suppressResourceTelemetry: true
        };
        const inboxPath = `users/coach-1/notificationInbox/${deliveryIdempotencyKey}`;

        try {
            await internals.sendCategoryNotification(original);
            const firstInboxRecord = env.getStoredDoc(inboxPath);

            await assert.rejects(
                internals.sendCategoryNotification({
                    ...original,
                    title: 'Different update',
                    body: 'A different event was substituted.',
                    dedupKey: 'changed-content'
                }),
                /idempotency validation failed/
            );
            await assert.rejects(
                internals.sendCategoryNotification({
                    ...original,
                    childId: 'child-2',
                    dedupKey: 'changed-route'
                }),
                /idempotency validation failed/
            );

            assert.equal(env.messagingCalls.length, 1);
            assert.deepEqual(env.getStoredDoc(inboxPath), firstInboxRecord);
        } finally {
            cleanup();
        }
    });

    it('rejects an unsafe delivery key before sending or writing an inbox row', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            indexedTargets: [
                {
                    uid: 'coach-1',
                    deviceId: 'coach-device',
                    token: 'coach-token',
                    categories: { liveScore: true }
                }
            ]
        });

        try {
            await assert.rejects(
                internals.sendCategoryNotification({
                    teamId: 'team-1',
                    gameId: 'game-1',
                    category: 'liveScore',
                    title: 'Score update',
                    body: 'The score changed.',
                    deliveryIdempotencyKey: 'unsafe/key'
                }),
                /deliveryIdempotencyKey/
            );
            assert.equal(env.messagingCalls.length, 0);
            assert.equal(env.getNotificationInboxDocCount('coach-1'), 0);
        } finally {
            cleanup();
        }
    });

    it('handles a 500-recipient indexed send without legacy per-user scans', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            ...buildLargeFixture({
                recipients: 500,
                devicesPerRecipient: 1
            }),
            notificationInboxDocs: {
                'user-0': buildExistingInboxItems(50)
            },
            deferNotificationInboxOperations: true
        });

        try {
            const result = await internals.sendCategoryNotification({
                teamId: 'team-1',
                category: 'schedule',
                title: 'Schedule updated',
                body: 'The bus leaves at 5:30.'
            });

            assert.equal(result.successCount, 500);
            assert.equal(result.failureCount, 0);
            assert.equal(env.counts.recipientQueries, 1);
            assert.equal(env.counts.parentQueries, 1);
            assert.equal(env.counts.preferenceGets, 0);
            assert.equal(env.counts.deviceGets, 0);
            assert.equal(env.counts.inboxCleanupQueries, 501);
            assert.equal(env.counts.inboxCleanupLimitQueries, 501);
            assert.deepEqual(new Set(env.inboxCleanupLimits), new Set([51, 500]));
            assert.equal(env.counts.inboxCleanupOffsetQueries, 0);
            assert.equal(env.counts.deleteCalls, 1);
            assert.equal(env.getNotificationInboxDocCount('user-0'), 50);
            assert.equal(env.messagingCalls.length, 1);
            assert.equal(env.messagingCalls[0].tokens.length, 500);
            assert.equal(env.inboxWrites.length, 500);
            assert.equal(env.peakNotificationInboxPipelines, internals.NOTIFICATION_INBOX_WRITE_CONCURRENCY);
            assert.equal(env.activeNotificationInboxPipelines, 0);
        } finally {
            cleanup();
        }
    });

    it('continues bounded inbox writes after one recipient pipeline fails', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            ...buildLargeFixture({
                recipients: 500,
                devicesPerRecipient: 1
            }),
            rejectedNotificationInboxUids: ['user-7'],
            deferNotificationInboxOperations: true
        });

        try {
            const result = await internals.sendCategoryNotification({
                teamId: 'team-1',
                category: 'schedule',
                title: 'Schedule updated',
                body: 'The bus leaves at 5:30.'
            });

            assert.equal(result.inboxWriteCount, 499);
            assert.equal(result.inboxCleanupCount, 0);
            assert.equal(result.inboxFailureCount, 1);
            assert.equal(env.inboxWrites.length, 499);
            assert.ok(env.inboxWrites.some((write) => write.uid === 'user-499'));
            assert.ok(env.peakNotificationInboxPipelines <= internals.NOTIFICATION_INBOX_WRITE_CONCURRENCY);
            assert.equal(env.activeNotificationInboxPipelines, 0);
        } finally {
            cleanup();
        }
    });

    it('deletes all existing overflow records when an inbox is already over the cap', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            ...buildLargeFixture({
                recipients: 1,
                devicesPerRecipient: 1
            }),
            notificationInboxDocs: {
                'user-0': buildExistingInboxItems(75)
            }
        });

        try {
            const result = await internals.sendCategoryNotification({
                teamId: 'team-1',
                category: 'schedule',
                title: 'Schedule updated',
                body: 'The bus leaves at 5:30.'
            });

            assert.equal(result.successCount, 1);
            assert.equal(result.inboxCleanupCount, 26);
            assert.equal(env.counts.deleteCalls, 26);
            assert.equal(env.getNotificationInboxDocCount('user-0'), 50);
            assert.deepEqual(env.inboxCleanupLimits, [51, 500, 500]);
        } finally {
            cleanup();
        }
    });

    it('preserves 500-token FCM chunking for large indexed sends', async () => {
        const { internals, env, cleanup } = loadNotificationInternals(buildLargeFixture({
            recipients: 500,
            devicesPerRecipient: 2
        }));

        try {
            const result = await internals.sendCategoryNotification({
                teamId: 'team-1',
                category: 'schedule',
                title: 'Schedule updated',
                body: 'Two buses this time.'
            });

            assert.equal(result.successCount, 1000);
            assert.equal(result.failureCount, 0);
            assert.equal(env.counts.recipientQueries, 1);
            assert.equal(env.counts.parentQueries, 1);
            assert.equal(env.counts.preferenceGets, 0);
            assert.equal(env.counts.deviceGets, 0);
            assert.equal(env.messagingCalls.length, 2);
            assert.deepEqual(env.messagingCalls.map((call) => call.tokens.length), [500, 500]);
            assert.equal(env.inboxWrites.length, 500);
        } finally {
            cleanup();
        }
    });
});
