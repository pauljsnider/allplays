import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadNotificationInternals } = require('./send-category-notification-test-helpers');

describe('getTargetsForCategory', () => {
    it('uses indexed targets without legacy per-user device scans when index coverage is complete', async () => {
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

            expect(targets).toHaveLength(2);
            expect(env.counts.recipientQueries).toBe(1);
            expect(env.counts.parentQueries).toBe(1);
            expect(env.counts.recipientCollectionGets).toBe(0);
            expect(env.counts.preferenceGets).toBe(0);
            expect(env.counts.deviceGets).toBe(0);
            expect(targets.map((target) => target.token).sort()).toEqual([
                'coach-token', 'parent-token'
            ]);
        } finally {
            cleanup();
        }
    });


    it('does not backfill repeatedly when the recipient collection already contains disabled-category docs', async () => {
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

            expect(targets).toEqual([]);
            expect(env.counts.recipientQueries).toBe(1);
            expect(env.counts.recipientCollectionGets).toBe(1);
            expect(env.counts.preferenceGets).toBe(2);
            expect(env.counts.deviceGets).toBe(2);
            expect(
                env.dedupWrites.filter((write) => write.path.includes('/notificationRecipients/'))
            ).toHaveLength(0);
        } finally {
            cleanup();
        }
    });

    it('falls back only for users missing from the notification target index', async () => {
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

            expect(targets).toHaveLength(2);
            expect(env.counts.recipientQueries).toBe(1);
            expect(env.counts.parentQueries).toBe(1);
            expect(env.counts.recipientCollectionGets).toBe(0);
            expect(env.counts.preferenceGets).toBe(1);
            expect(env.counts.deviceGets).toBe(1);
            expect(targets.map((target) => target.token).sort()).toEqual([
                'coach-token', 'parent-token'
            ]);
        } finally {
            cleanup();
        }
    });

    it('falls back to legacy resolution and backfills recipients when the team index is empty', async () => {
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

            expect(targets).toHaveLength(2);
            expect(env.counts.recipientQueries).toBe(1);
            expect(env.counts.recipientCollectionGets).toBe(1);
            expect(env.counts.preferenceGets).toBe(4);
            expect(env.counts.deviceGets).toBe(4);
            expect(targets.map((target) => `${target.uid}:${target.deviceId}:${target.token}`).sort()).toEqual([
                'coach-1:coach-device:coach-token',
                'parent-1:parent-device:parent-token'
            ]);
            expect(
                env.dedupWrites
                    .filter((write) => write.path.includes('/notificationRecipients/'))
                    .map((write) => write.path)
                    .sort()
            ).toEqual([
                'teams/team-1/notificationRecipients/coach-1__coach-device',
                'teams/team-1/notificationRecipients/parent-1__parent-device'
            ]);
        } finally {
            cleanup();
        }
    });
});


describe('sendCategoryNotification', () => {
    it.each([
        ['liveChat', { liveChat: true }],
        ['mentions', { mentions: true }]
    ])('includes conversation deep links for %s notifications', async (category, categories) => {
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

            expect(result?.successCount).toBe(1);
            expect(env.messagingCalls).toHaveLength(1);
            expect(env.messagingCalls[0].data).toMatchObject({
                category,
                conversationId: 'staff room',
                appRoute: '/messages/team-1?conversationId=staff%20room',
                link: 'https://allplays.ai/team-chat.html?teamId=team-1&conversationId=staff%20room'
            });
            expect(env.messagingCalls[0].webLink).toBe('https://allplays.ai/team-chat.html?teamId=team-1&conversationId=staff%20room');
            expect(env.inboxWrites).toHaveLength(1);
            expect(env.inboxWrites[0].value.appRoute).toBe('/messages/team-1?conversationId=staff%20room');
        } finally {
            cleanup();
        }
    });

    it('prunes invalid tokens from both notification index collections', async () => {
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

            expect(result?.failureCount).toBe(1);
            expect(env.deletedPaths.sort()).toEqual([
                'teams/team-1/notificationRecipients/coach-1__coach-device',
                'teams/team-1/notificationTargets/coach-1__coach-device',
                'users/coach-1/notificationDevices/coach-device'
            ]);
        } finally {
            cleanup();
        }
    });
});
