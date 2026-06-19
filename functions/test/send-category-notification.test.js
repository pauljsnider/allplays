import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadNotificationInternals } = require('./send-category-notification-test-helpers');

test('getTargetsForCategory uses indexed targets without legacy per-user device scans when index coverage is complete', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            parentUserIds: ['parent-1'],
            indexedTargets: [
                {
                    uid: 'coach-1',
                    deviceId: 'coach-device',
                    token: 'coach-token',
                    categories: { schedule: true }
                },
                {
                    uid: 'parent-1',
                    deviceId: 'parent-device',
                    token: 'parent-token',
                    categories: { schedule: true }
                }
            ]
        });

        try {
            const targets = await internals.getTargetsForCategory('team-1', 'schedule');

            assert.equal(targets.length, 2);
            assert.equal(env.counts.recipientQueries, 1);
            assert.equal(env.counts.parentQueries, 1);
            assert.equal(env.counts.recipientCollectionGets, 0);
            assert.equal(env.counts.preferenceGets, 0);
            assert.equal(env.counts.deviceGets, 0);
            assert.deepEqual(targets.map((target) => target.token).sort(), [
                'coach-token', 'parent-token'
            ]);
        } finally {
            cleanup();
        }
});

test('getTargetsForCategory does not backfill repeatedly when the recipient collection already contains disabled-category docs', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            parentUserIds: ['parent-1'],
            indexedRecipients: [
                {
                    uid: 'coach-1',
                    deviceId: 'coach-device',
                    token: 'coach-token',
                    categories: { media: false }
                }
            ],
            preferenceDocs: {
                'users/coach-1/notificationPreferences/team-1': { media: false },
                'users/parent-1/notificationPreferences/team-1': { media: false }
            },
            deviceDocs: {
                'coach-1': [
                    { id: 'coach-device', token: 'coach-token', platform: 'ios' }
                ],
                'parent-1': [
                    { id: 'parent-device', token: 'parent-token', platform: 'android' }
                ]
            }
        });

        try {
            const targets = await internals.getTargetsForCategory('team-1', 'media');

            assert.deepEqual(targets, []);
            assert.equal(env.counts.recipientQueries, 1);
            assert.equal(env.counts.recipientCollectionGets, 1);
            assert.equal(env.counts.preferenceGets, 2);
            assert.equal(env.counts.deviceGets, 2);
            assert.equal(
                env.dedupWrites.filter((write) => write.path.includes('/notificationRecipients/'))
                    .length,
                0
            );
        } finally {
            cleanup();
        }
});

test('getTargetsForCategory falls back only for users missing from the notification target index', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            parentUserIds: ['parent-1'],
            indexedTargets: [
                {
                    uid: 'coach-1',
                    deviceId: 'coach-device',
                    token: 'coach-token',
                    categories: { schedule: true }
                }
            ],
            preferenceDocs: {
                'users/parent-1/notificationPreferences/team-1': { schedule: true }
            },
            deviceDocs: {
                'parent-1': [
                    { id: 'parent-device', token: 'parent-token' }
                ]
            }
        });

        try {
            const targets = await internals.getTargetsForCategory('team-1', 'schedule');

            assert.equal(targets.length, 2);
            assert.equal(env.counts.recipientQueries, 1);
            assert.equal(env.counts.parentQueries, 1);
            assert.equal(env.counts.recipientCollectionGets, 0);
            assert.equal(env.counts.preferenceGets, 1);
            assert.equal(env.counts.deviceGets, 1);
            assert.deepEqual(targets.map((target) => target.token).sort(), [
                'coach-token', 'parent-token'
            ]);
        } finally {
            cleanup();
        }
});

test('getTargetsForCategory falls back to legacy resolution and backfills recipients when the team index is empty', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            parentUserIds: ['parent-1'],
            preferenceDocs: {
                'users/coach-1/notificationPreferences/team-1': { schedule: true },
                'users/parent-1/notificationPreferences/team-1': { schedule: true }
            },
            deviceDocs: {
                'coach-1': [
                    { id: 'coach-device', token: 'coach-token', platform: 'ios' }
                ],
                'parent-1': [
                    { id: 'parent-device', token: 'parent-token', platform: 'android' }
                ]
            }
        });

        try {
            const targets = await internals.getTargetsForCategory('team-1', 'schedule');

            assert.equal(targets.length, 2);
            assert.equal(env.counts.recipientQueries, 1);
            assert.equal(env.counts.recipientCollectionGets, 1);
            assert.equal(env.counts.preferenceGets, 4);
            assert.equal(env.counts.deviceGets, 4);
            assert.deepEqual(targets.map((target) => `${target.uid}:${target.deviceId}:${target.token}`).sort(), [
                'coach-1:coach-device:coach-token',
                'parent-1:parent-device:parent-token'
            ]);
            assert.deepEqual(
                env.dedupWrites
                    .filter((write) => write.path.includes('/notificationRecipients/'))
                    .map((write) => write.path)
                    .sort(),
                [
                'teams/team-1/notificationRecipients/coach-1__coach-device',
                'teams/team-1/notificationRecipients/parent-1__parent-device'
            ]);
        } finally {
            cleanup();
        }
});

for (const [category, categories] of [
    ['liveChat', { liveChat: true }],
    ['mentions', { mentions: true }]
]) {
    test(`sendCategoryNotification includes conversation deep links for ${category} notifications`, async () => {
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
                    categories
                }
            ]
        });

        try {
            const result = await internals.sendCategoryNotification({
                teamId: 'team-1',
                category,
                title: 'New message',
                body: 'Check chat',
                conversationId: 'staff room'
            });

            assert.equal(result?.successCount, 1);
            assert.equal(env.messagingCalls.length, 1);
            assert.deepEqual(env.messagingCalls[0].data, {
                category,
                teamId: 'team-1',
                gameId: '',
                eventId: '',
                conversationId: 'staff room',
                appRoute: '/messages/team-1?conversationId=staff%20room',
                link: 'https://allplays.ai/team-chat.html?teamId=team-1&conversationId=staff%20room'
            });
            assert.equal(env.messagingCalls[0].webLink, 'https://allplays.ai/team-chat.html?teamId=team-1&conversationId=staff%20room');
            assert.equal(env.inboxWrites.length, 1);
            assert.equal(env.inboxWrites[0].value.appRoute, '/messages/team-1?conversationId=staff%20room');
            assert.equal(env.auditWrites.length, 1);
            assert.equal(env.auditWrites[0].value.category, category);
        } finally {
            cleanup();
        }
    });
}

test('sendCategoryNotification prunes invalid tokens from both notification index collections', async () => {
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
                    categories: { schedule: true }
                }
            ],
            invalidTokenResponses: [
                {
                    success: false,
                    error: { code: 'messaging/registration-token-not-registered' }
                }
            ]
        });

        try {
            const result = await internals.sendCategoryNotification({
                teamId: 'team-1',
                category: 'schedule',
                title: 'Schedule changed',
                body: 'Updated'
            });

            assert.equal(result?.failureCount, 1);
            assert.deepEqual(env.deletedPaths.sort(), [
                'teams/team-1/notificationRecipients/coach-1__coach-device',
                'teams/team-1/notificationTargets/coach-1__coach-device',
                'users/coach-1/notificationDevices/coach-device'
            ]);
        } finally {
            cleanup();
        }
});
