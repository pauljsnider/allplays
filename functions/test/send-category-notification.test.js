import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadNotificationInternals } = require('./send-category-notification-test-helpers.cjs');

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
            assert.equal(env.counts.teamDocGets, 1);
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

test('getTargetsForCategory returns the same recipient set from indexed resolution as the legacy scan', async () => {
        const fixture = {
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: ['assistant@example.com']
            },
            authUsersByEmail: {
                'assistant@example.com': 'assistant-1'
            },
            parentUserIds: ['parent-1'],
            userDocs: {
                'coach-1': { email: 'coach@example.com', parentTeamIds: [] },
                'assistant-1': { email: 'assistant@example.com', parentTeamIds: [] },
                'parent-1': { email: 'parent1@example.com', parentTeamIds: ['team-1'] }
            },
            preferenceDocs: {
                'users/coach-1/notificationPreferences/team-1': { schedule: true },
                'users/assistant-1/notificationPreferences/team-1': { schedule: true },
                'users/parent-1/notificationPreferences/team-1': { schedule: true }
            },
            deviceDocs: {
                'coach-1': [
                    { id: 'coach-phone', token: 'coach-phone-token', platform: 'ios' }
                ],
                'assistant-1': [
                    { id: 'assistant-phone', token: 'assistant-phone-token', platform: 'android' }
                ],
                'parent-1': [
                    { id: 'parent-phone', token: 'parent-phone-token', platform: 'ios' }
                ]
            },
            indexedRecipients: [
                {
                    uid: 'coach-1',
                    teamId: 'team-1',
                    roles: ['staff'],
                    categories: { schedule: true },
                    tokens: [
                        {
                            deviceId: 'coach-phone',
                            token: 'coach-phone-token',
                            platform: 'ios',
                            userAgent: ''
                        }
                    ]
                },
                {
                    uid: 'assistant-1',
                    teamId: 'team-1',
                    roles: ['staff'],
                    categories: { schedule: true },
                    tokens: [
                        {
                            deviceId: 'assistant-phone',
                            token: 'assistant-phone-token',
                            platform: 'android',
                            userAgent: ''
                        }
                    ]
                },
                {
                    uid: 'parent-1',
                    teamId: 'team-1',
                    roles: ['parent'],
                    categories: { schedule: true },
                    tokens: [
                        {
                            deviceId: 'parent-phone',
                            token: 'parent-phone-token',
                            platform: 'ios',
                            userAgent: ''
                        }
                    ]
                }
            ]
        };

        const indexed = loadNotificationInternals(fixture);
        const legacy = loadNotificationInternals({
            ...fixture,
            indexedRecipients: []
        });

        try {
            const [indexedTargets, legacyTargets] = await Promise.all([
                indexed.internals.getTargetsForCategory('team-1', 'schedule'),
                legacy.internals.getTargetsForCategory('team-1', 'schedule')
            ]);

            const normalizeTargets = (targets) => targets
                .map((target) => `${target.uid}:${target.deviceId}:${target.token}`)
                .sort();

            assert.deepEqual(normalizeTargets(indexedTargets), normalizeTargets(legacyTargets));
            assert.equal(indexed.env.counts.recipientQueries, 1);
            assert.equal(indexed.env.counts.parentQueries, 1);
            assert.equal(indexed.env.counts.preferenceGets, 0);
            assert.equal(indexed.env.counts.deviceGets, 0);
            assert.equal(legacy.env.counts.recipientQueries, 1);
            assert.ok(legacy.env.counts.preferenceGets > 0);
            assert.ok(legacy.env.counts.deviceGets > 0);
            assert.deepEqual(normalizeTargets(indexedTargets), [
                'assistant-1:assistant-phone:assistant-phone-token',
                'coach-1:coach-phone:coach-phone-token',
                'parent-1:parent-phone:parent-phone-token'
            ]);
        } finally {
            indexed.cleanup();
            legacy.cleanup();
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
            assert.equal(env.counts.parentQueries, 0);
            assert.equal(env.counts.preferenceGets, 0);
            assert.equal(env.counts.deviceGets, 0);
            assert.equal(
                env.dedupWrites.filter((write) => write.path.includes('/notificationRecipients/'))
                    .length,
                0
            );
        } finally {
            cleanup();
        }
});

test('getTargetsForCategory falls back to users missing from a partial recipient index', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            parentUserIds: ['parent-1'],
            userDocs: {
                'parent-1': { parentTeamIds: ['team-1'] }
            },
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
            assert.equal(env.counts.preferenceGets, 2);
            assert.equal(env.counts.deviceGets, 2);
            assert.deepEqual(targets.map((target) => target.token).sort(), [
                'coach-token', 'parent-token'
            ]);
            assert.equal(env.dedupWrites.some((write) => write.path === 'teams/team-1/notificationRecipients/parent-1'), true);
        } finally {
            cleanup();
        }
});

test('getTargetsForCategory resolves legacy per-device recipient docs with candidate-user roles', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            parentUserIds: ['parent-1'],
            notificationRecipientDocs: [
                {
                    id: 'coach-1__coach-device',
                    data: {
                        uid: 'coach-1',
                        deviceId: 'coach-device',
                        token: 'coach-token',
                        categories: { schedule: true }
                    }
                },
                {
                    id: 'parent-1__parent-device',
                    data: {
                        uid: 'parent-1',
                        deviceId: 'parent-device',
                        token: 'parent-token',
                        categories: { schedule: true }
                    }
                }
            ]
        });

        try {
            const targets = await internals.getTargetsForCategory('team-1', 'schedule');

            assert.equal(targets.length, 2);
            assert.equal(env.counts.recipientQueries, 1);
            assert.equal(env.counts.teamDocGets, 1);
            assert.equal(env.counts.parentQueries, 1);
            assert.equal(env.counts.recipientCollectionGets, 0);
            assert.equal(env.counts.preferenceGets, 0);
            assert.equal(env.counts.deviceGets, 0);
            assert.deepEqual(targets.map((target) => `${target.uid}:${target.deviceId}:${target.token}`).sort(), [
                'coach-1:coach-device:coach-token',
                'parent-1:parent-device:parent-token'
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

test('getTargetsForCategory falls back when category matches only legacy per-device recipient docs', async () => {
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
            notificationRecipientDocs: [
                {
                    id: 'coach-1__coach-device',
                    data: {
                        uid: 'coach-1',
                        teamId: 'team-1',
                        deviceId: 'coach-device',
                        token: 'stale-coach-token',
                        categories: { schedule: true }
                    }
                },
                {
                    id: 'parent-1__parent-device',
                    data: {
                        uid: 'parent-1',
                        teamId: 'team-1',
                        deviceId: 'parent-device',
                        token: 'stale-parent-token',
                        categories: { schedule: true }
                    }
                }
            ],
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
                    roles: ['staff'],
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

test('getTargetsForCategory preserves eligible recipients for visible media albums while honoring restrictions', async () => {
        const { internals, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            parentUserIds: ['parent-1', 'parent-2'],
            indexedTargets: [
                {
                    uid: 'coach-1',
                    roles: ['staff'],
                    deviceId: 'coach-device',
                    token: 'coach-token',
                    categories: { media: true }
                },
                {
                    uid: 'parent-1',
                    deviceId: 'parent-1-device',
                    token: 'parent-1-token',
                    categories: { media: true }
                },
                {
                    uid: 'parent-2',
                    deviceId: 'parent-2-device',
                    token: 'parent-2-token',
                    categories: { media: true }
                }
            ]
        });

        try {
            const visibleTargets = await internals.getTargetsForCategory('team-1', 'media', null, {
                albumVisibility: 'team'
            });
            const restrictedTargets = await internals.getTargetsForCategory('team-1', 'media', null, {
                albumVisibility: 'team',
                allowedUserIds: ['parent-2'],
                allowedRoles: ['staff']
            });
            const staffOnlyTargets = await internals.getTargetsForCategory('team-1', 'media', null, {
                albumVisibility: 'staff-only'
            });

            assert.deepEqual(visibleTargets.map((target) => target.token).sort(), [
                'coach-token',
                'parent-1-token',
                'parent-2-token'
            ]);
            assert.deepEqual(restrictedTargets.map((target) => target.token).sort(), [
                'coach-token',
                'parent-2-token'
            ]);
            assert.deepEqual(staffOnlyTargets.map((target) => target.token), ['coach-token']);
        } finally {
            cleanup();
        }
});

test('sendCategoryNotification suppresses parent pushes for staff-only media albums while keeping staff recipients', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            parentUserIds: ['parent-1'],
            indexedTargets: [
                {
                    uid: 'coach-1',
                    roles: ['staff'],
                    deviceId: 'coach-device',
                    token: 'coach-token',
                    categories: { media: true }
                },
                {
                    uid: 'parent-1',
                    roles: ['parent'],
                    deviceId: 'parent-device',
                    token: 'parent-token',
                    categories: { media: true }
                }
            ]
        });

        try {
            const result = await internals.sendCategoryNotification({
                teamId: 'team-1',
                category: 'media',
                title: 'New team media',
                body: 'Private film has 1 new media item.',
                dedupKey: 'team-media:private-film',
                audienceContext: { albumVisibility: 'staff-only' }
            });

            assert.equal(result?.successCount, 1);
            assert.deepEqual(env.messagingCalls[0]?.tokens, ['coach-token']);
            assert.deepEqual(env.inboxWrites.map((write) => write.uid), ['coach-1']);
            assert.equal(env.auditWrites[0]?.value.targetCount, 1);
        } finally {
            cleanup();
        }
});

test('sendCategoryNotification preserves visible media album behavior for parents and staff', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            parentUserIds: ['parent-1'],
            indexedTargets: [
                {
                    uid: 'coach-1',
                    roles: ['staff'],
                    deviceId: 'coach-device',
                    token: 'coach-token',
                    categories: { media: true }
                },
                {
                    uid: 'parent-1',
                    roles: ['parent'],
                    deviceId: 'parent-device',
                    token: 'parent-token',
                    categories: { media: true }
                }
            ]
        });

        try {
            const result = await internals.sendCategoryNotification({
                teamId: 'team-1',
                category: 'media',
                title: 'New team media',
                body: 'Game highlights has 1 new media item.',
                dedupKey: 'team-media:game-highlights',
                audienceContext: { albumVisibility: 'team' }
            });

            assert.equal(result?.successCount, 2);
            assert.deepEqual(env.messagingCalls[0]?.tokens.sort(), ['coach-token', 'parent-token']);
            assert.deepEqual(env.inboxWrites.map((write) => write.uid).sort(), ['coach-1', 'parent-1']);
            assert.equal(env.auditWrites[0]?.value.targetCount, 2);
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

test('sendRsvpReminderPushNotifications sends per-recipient child routes when player ids are available', async () => {
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
                recipientTargets: [
                    { userId: 'parent-1', childId: 'player-1' },
                    { userId: 'parent-2', childId: 'player-2' }
                ]
            });

            assert.deepEqual(result, { successCount: 2, failureCount: 0, targetCount: 2 });
            assert.equal(env.messagingCalls.length, 2);
            assert.deepEqual(env.messagingCalls.map((call) => call.tokens), [['parent-1-token'], ['parent-2-token']]);
            assert.deepEqual(env.messagingCalls.map((call) => call.data.appRoute), [
                '/schedule/team-1/game-9?childId=player-1&section=availability',
                '/schedule/team-1/game-9?childId=player-2&section=availability'
            ]);
            assert.deepEqual(env.messagingCalls.map((call) => call.webLink), [
                'https://allplays.ai/app/#/schedule/team-1/game-9?childId=player-1&section=availability',
                'https://allplays.ai/app/#/schedule/team-1/game-9?childId=player-2&section=availability'
            ]);
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

for (const [category, categories, expectedAppRoute] of [
    ['liveChat', { liveChat: true }, '/messages/team-1?conversationId=staff%20room'],
    ['mentions', { mentions: true }, '/messages/team-1?conversation=staff%20room']
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
                appRoute: expectedAppRoute,
                link: 'https://allplays.ai/team-chat.html?teamId=team-1&conversationId=staff%20room'
            });
            assert.equal(env.messagingCalls[0].webLink, 'https://allplays.ai/team-chat.html?teamId=team-1&conversationId=staff%20room');
            assert.equal(env.inboxWrites.length, 1);
            assert.equal(env.inboxWrites[0].value.appRoute, expectedAppRoute);
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
                'teams/team-1/notificationRecipients/coach-1',
                'teams/team-1/notificationTargets/coach-1__coach-device',
                'users/coach-1/notificationDevices/coach-device'
            ]);
        } finally {
            cleanup();
        }
});

test('sendCategoryNotification suppresses duplicate sends with the same dedup key', async () => {
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
            ]
        });

        try {
            const firstResult = await internals.sendCategoryNotification({
                teamId: 'team-1',
                category: 'schedule',
                title: 'Schedule changed',
                body: 'Updated',
                dedupKey: 'event:event-1:created'
            });
            const secondResult = await internals.sendCategoryNotification({
                teamId: 'team-1',
                category: 'schedule',
                title: 'Schedule changed',
                body: 'Updated again',
                dedupKey: 'event:event-1:created'
            });

            assert.equal(firstResult?.successCount, 1);
            assert.equal(secondResult, null);
            assert.equal(env.counts.dedupTransactions, 2);
            assert.equal(env.messagingCalls.length, 1);
            assert.equal(env.auditWrites.length, 1);
            assert.equal(env.dedupWrites.filter((write) => write.path.includes('/notificationSendLog/')).length, 1);
        } finally {
            cleanup();
        }
});

test('sendCategoryNotification keeps one allowed logical send fanned out to each device', async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            indexedTargets: [
                {
                    uid: 'coach-1',
                    deviceId: 'coach-phone',
                    token: 'coach-phone-token',
                    categories: { schedule: true }
                },
                {
                    uid: 'coach-1',
                    deviceId: 'coach-tablet',
                    token: 'coach-tablet-token',
                    categories: { schedule: true }
                }
            ]
        });

        try {
            const result = await internals.sendCategoryNotification({
                teamId: 'team-1',
                category: 'schedule',
                gameId: 'event-1',
                title: 'Schedule changed',
                body: 'Updated',
                dedupKey: 'event:event-1:created'
            });

            assert.equal(result?.successCount, 2);
            assert.equal(env.counts.dedupTransactions, 1);
            assert.equal(env.messagingCalls.length, 1);
            assert.deepEqual(env.messagingCalls[0].tokens, ['coach-phone-token', 'coach-tablet-token']);
            assert.equal(env.auditWrites.length, 1);
            assert.equal(env.auditWrites[0].value.targetCount, 2);
        } finally {
            cleanup();
        }
});

test('sendCategoryNotification allows the same logical send after the dedup window expires', async () => {
        const originalDateNow = Date.now;
        let now = new Date('2026-06-21T15:00:00.000Z').getTime();
        Date.now = () => now;

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
            ]
        });

        try {
            const firstResult = await internals.sendCategoryNotification({
                teamId: 'team-1',
                category: 'schedule',
                gameId: 'event-1',
                title: 'Schedule changed',
                body: 'Updated',
                dedupKey: 'event:event-1:created'
            });

            now += (6 * 60 * 1000);

            const secondResult = await internals.sendCategoryNotification({
                teamId: 'team-1',
                category: 'schedule',
                gameId: 'event-1',
                title: 'Schedule changed',
                body: 'Updated after expiry',
                dedupKey: 'event:event-1:created'
            });

            assert.equal(firstResult?.successCount, 1);
            assert.equal(secondResult?.successCount, 1);
            assert.equal(env.counts.dedupTransactions, 2);
            assert.equal(env.messagingCalls.length, 2);
            assert.deepEqual(env.messagingCalls.map((call) => call.body), ['Updated', 'Updated after expiry']);
            assert.equal(env.auditWrites.length, 2);
            assert.equal(env.dedupWrites.filter((write) => write.path.includes('/notificationSendLog/')).length, 2);
        } finally {
            Date.now = originalDateNow;
            cleanup();
        }
});
