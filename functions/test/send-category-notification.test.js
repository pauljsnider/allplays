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
            userDocs: {
                'coach-1': { email: 'coach@example.com', parentTeamIds: [] },
                'parent-1': { email: 'parent@example.com', parentTeamIds: ['team-1'] }
            },
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
                    'teams/team-1/notificationRecipients/coach-1',
                    'teams/team-1/notificationRecipients/parent-1'
                ]);
            assert.deepEqual(env.dedupWrites
                .filter((write) => write.path === 'teams/team-1/notificationRecipients/coach-1' || write.path === 'teams/team-1/notificationRecipients/parent-1')
                .map((write) => ({ path: write.path, tokens: write.value.tokens?.length || 0 }))
                .sort((a, b) => a.path.localeCompare(b.path)), [
                { path: 'teams/team-1/notificationRecipients/coach-1', tokens: 1 },
                { path: 'teams/team-1/notificationRecipients/parent-1', tokens: 1 }
            ]);
        } finally {
            cleanup();
        }
});

test('getTargetsForCategory limits staff-only media notifications to staff recipients', async () => {
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
                    categories: { media: true }
                },
                {
                    uid: 'parent-1',
                    deviceId: 'parent-device',
                    token: 'parent-token',
                    categories: { media: true }
                }
            ]
        });

        try {
            const targets = await internals.getTargetsForCategory('team-1', 'media', null, { albumVisibility: 'staff' });

            assert.deepEqual(targets.map((target) => target.token), ['coach-token']);
            assert.equal(env.counts.recipientQueries, 1);
            assert.equal(env.counts.parentQueries, 1);
            assert.equal(env.counts.preferenceGets, 0);
            assert.equal(env.counts.deviceGets, 0);
        } finally {
            cleanup();
        }
});

test('getTargetsForCategoryUserIds restricts RSVP targets to requested recipients with enabled preferences', async () => {
        const { internals, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            parentUserIds: ['parent-1', 'parent-2', 'parent-3'],
            indexedTargets: [
                {
                    uid: 'parent-1',
                    deviceId: 'parent-1-device',
                    token: 'parent-1-token',
                    categories: { rsvp: true }
                },
                {
                    uid: 'parent-2',
                    deviceId: 'parent-2-device',
                    token: 'parent-2-token',
                    categories: { rsvp: false }
                },
                {
                    uid: 'parent-3',
                    deviceId: 'parent-3-device',
                    token: 'parent-3-token',
                    categories: { rsvp: true }
                }
            ],
            preferenceDocs: {
                'users/parent-2/notificationPreferences/team-1': { rsvp: false }
            },
            deviceDocs: {
                'parent-2': [
                    { id: 'parent-2-device', token: 'parent-2-token' }
                ]
            }
        });

        try {
            const targets = await internals.getTargetsForCategoryUserIds('team-1', 'rsvp', ['parent-1', 'parent-2']);

            assert.deepEqual(targets.map((target) => target.token), ['parent-1-token']);
        } finally {
            cleanup();
        }
});

test('getTargetsForCategoryUserIds limits legacy RSVP fallback to requested recipients', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            parentUserIds: ['parent-1', 'parent-2', 'parent-3'],
            indexedTargets: [
                {
                    uid: 'parent-1',
                    deviceId: 'parent-1-device',
                    token: 'parent-1-token',
                    categories: { rsvp: true }
                }
            ],
            preferenceDocs: {
                'users/parent-2/notificationPreferences/team-1': { rsvp: true },
                'users/parent-3/notificationPreferences/team-1': { rsvp: true }
            },
            deviceDocs: {
                'parent-2': [
                    { id: 'parent-2-device', token: 'parent-2-token' }
                ],
                'parent-3': [
                    { id: 'parent-3-device', token: 'parent-3-token' }
                ]
            }
        });

        try {
            const targets = await internals.getTargetsForCategoryUserIds('team-1', 'rsvp', ['parent-1', 'parent-2']);

            assert.deepEqual(targets.map((target) => target.token).sort(), ['parent-1-token', 'parent-2-token']);
            assert.equal(env.counts.recipientQueries, 0);
            assert.equal(env.counts.recipientDocGets, 2);
            assert.equal(env.counts.parentQueries, 0);
            assert.equal(env.counts.preferenceGets, 1);
            assert.equal(env.counts.deviceGets, 1);
        } finally {
            cleanup();
        }
});

test('getTargetsForCategoryUserIds accepts legacy recipient docs without category maps', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            parentUserIds: ['parent-1'],
            notificationRecipientDocs: [
                {
                    id: 'parent-1',
                    data: {
                        uid: 'parent-1',
                        teamId: 'team-1',
                        roles: ['parent'],
                        tokens: [
                            {
                                deviceId: 'parent-1-device',
                                token: 'parent-1-token',
                                platform: 'ios',
                                userAgent: ''
                            }
                        ]
                    }
                }
            ]
        });

        try {
            const targets = await internals.getTargetsForCategoryUserIds('team-1', 'rsvp', ['parent-1']);

            assert.deepEqual(targets.map((target) => target.token), ['parent-1-token']);
            assert.equal(env.counts.recipientDocGets, 1);
            assert.equal(env.counts.preferenceGets, 0);
            assert.equal(env.counts.deviceGets, 0);
        } finally {
            cleanup();
        }
});

test('sendRsvpReminderPushNotifications sends availability pushes only to email recipient user ids', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            parentUserIds: ['parent-1', 'parent-2'],
            indexedTargets: [
                {
                    uid: 'parent-1',
                    deviceId: 'parent-1-device',
                    token: 'parent-1-token',
                    categories: { rsvp: true }
                },
                {
                    uid: 'parent-2',
                    deviceId: 'parent-2-device',
                    token: 'parent-2-token',
                    categories: { rsvp: true }
                }
            ]
        });

        try {
            const result = await internals.sendRsvpReminderPushNotifications({
                teamId: 'team-1',
                gameId: 'game-9',
                event: { opponent: 'Wildcats' },
                recipientUserIds: ['parent-1']
            });

            assert.deepEqual(result, { successCount: 1, failureCount: 0, targetCount: 1 });
            assert.equal(env.messagingCalls.length, 1);
            assert.deepEqual(env.messagingCalls[0].tokens, ['parent-1-token']);
            assert.equal(env.messagingCalls[0].data.category, 'rsvp');
            assert.equal(env.messagingCalls[0].data.appRoute, '/schedule/team-1/game-9?section=availability');
            assert.equal(env.messagingCalls[0].webLink, 'https://allplays.ai/app/#/schedule/team-1/game-9?section=availability');
        } finally {
            cleanup();
        }
});

test('sendCategoryNotification deep links rideshare notifications to the rideshare event section', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            parentUserIds: ['parent-1'],
            indexedTargets: [
                {
                    uid: 'parent-1',
                    deviceId: 'parent-device',
                    token: 'parent-token',
                    categories: { rideshare: true }
                }
            ]
        });

        try {
            const result = await internals.sendCategoryNotification({
                teamId: 'team-1',
                gameId: 'game-9',
                category: 'rideshare',
                title: 'Ride request claimed',
                body: 'Avery has a confirmed ride.'
            });

            assert.equal(result?.successCount, 1);
            assert.equal(env.messagingCalls.length, 1);
            assert.deepEqual(env.messagingCalls[0].data, {
                category: 'rideshare',
                teamId: 'team-1',
                gameId: 'game-9',
                eventId: 'game-9',
                conversationId: '',
                childId: '',
                rsvpId: '',
                appRoute: '/schedule/team-1/game-9?section=rideshare',
                link: 'https://allplays.ai/app/#/schedule/team-1/game-9?section=rideshare'
            });
            assert.equal(env.messagingCalls[0].webLink, 'https://allplays.ai/app/#/schedule/team-1/game-9?section=rideshare');
            assert.equal(env.inboxWrites[0].value.appRoute, '/schedule/team-1/game-9?section=rideshare');
            assert.equal(env.auditWrites[0].value.category, 'rideshare');
        } finally {
            cleanup();
        }
});

test('sendCategoryNotification uses eventId for rideshare deep links when no gameId is provided', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            parentUserIds: ['parent-1'],
            indexedTargets: [
                {
                    uid: 'parent-1',
                    deviceId: 'parent-device',
                    token: 'parent-token',
                    categories: { rideshare: true }
                }
            ]
        });

        try {
            const result = await internals.sendCategoryNotification({
                teamId: 'team-1',
                eventId: 'event-9',
                category: 'rideshare',
                title: 'Ride request claimed',
                body: 'Avery has a confirmed ride.'
            });

            assert.equal(result?.successCount, 1);
            assert.equal(env.messagingCalls.length, 1);
            assert.deepEqual(env.messagingCalls[0].data, {
                category: 'rideshare',
                teamId: 'team-1',
                gameId: '',
                eventId: 'event-9',
                conversationId: '',
                childId: '',
                rsvpId: '',
                appRoute: '/schedule/team-1/event-9?section=rideshare',
                link: 'https://allplays.ai/app/#/schedule/team-1/event-9?section=rideshare'
            });
            assert.equal(env.messagingCalls[0].webLink, 'https://allplays.ai/app/#/schedule/team-1/event-9?section=rideshare');
            assert.equal(env.inboxWrites[0].value.appRoute, '/schedule/team-1/event-9?section=rideshare');
            assert.equal(env.auditWrites[0].value.link, 'https://allplays.ai/app/#/schedule/team-1/event-9?section=rideshare');
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
                childId: '',
                rsvpId: '',
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
                'teams/team-1/notificationTargets/coach-1__coach-device',
                'users/coach-1/notificationDevices/coach-device'
            ]);
        } finally {
            cleanup();
        }
});
