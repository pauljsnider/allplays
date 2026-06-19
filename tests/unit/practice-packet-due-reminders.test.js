import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

function extractChunk(startMarker, endMarker) {
    const start = functionsSource.indexOf(startMarker);
    const end = functionsSource.indexOf(endMarker, start);
    if (start === -1 || end === -1) {
        throw new Error(`Unable to extract source chunk for ${startMarker}.`);
    }
    return functionsSource.slice(start, end);
}

function extractReminderSource() {
    return [
        extractChunk('function buildPracticePacketNotificationDestination(', 'function buildNotificationLink'),
        extractChunk('function getPracticePacketReminderDueDate(', 'function getFeeReminderPlayerKey')
    ].join('\n');
}

function makeDocSnapshot(ref, data, exists = true) {
    return {
        id: ref.id,
        ref,
        exists,
        data: () => data
    };
}

function makeQuerySnapshot(docs) {
    return {
        docs,
        empty: docs.length === 0,
        size: docs.length,
        forEach(callback) {
            docs.forEach(callback);
        }
    };
}

function buildHarness({
    categories = ['practice', 'schedule'],
    now = new Date('2026-06-20T12:00:00.000Z'),
    sessions = [],
    playersByTeam = {},
    completionsBySessionPath = {},
    privateProfiles = {},
    practiceTargetsByTeam = {},
    existingReminderDocs = {}
} = {}) {
    const reminderDocStore = new Map(Object.entries(existingReminderDocs));
    const sendDirectTargetsNotification = vi.fn(async () => ({ successCount: 1, failureCount: 0 }));
    const getTargetsForCategory = vi.fn(async (teamId) => practiceTargetsByTeam[teamId] || []);
    const getTeamFeeRecipientTargetUserIds = vi.fn((recipient = {}, player = {}, privateProfile = {}) => {
        const ids = [
            recipient.parentUserId,
            recipient.accountUserId,
            recipient.userId,
            player.parentUserId,
            player.guardianUserId,
            privateProfile.parentUserId,
            privateProfile.guardianUserId,
            ...(Array.isArray(player.parents) ? player.parents.map((parent) => parent?.userId || parent?.uid) : []),
            ...(Array.isArray(player.privateProfileParents) ? player.privateProfileParents.map((parent) => parent?.userId || parent?.uid) : []),
            ...(Array.isArray(privateProfile.parents) ? privateProfile.parents.map((parent) => parent?.userId || parent?.uid) : [])
        ];
        return [...new Set(ids.map((value) => String(value || '').trim()).filter(Boolean))];
    });

    const firestore = {
        collectionGroup: vi.fn((name) => {
            if (name !== 'practiceSessions') {
                throw new Error(`Unexpected collectionGroup ${name}`);
            }
            return {
                where: vi.fn(() => ({
                    get: vi.fn(async () => makeQuerySnapshot(sessions.map((session) => {
                        const ref = { path: session.path, id: session.path.split('/').pop() };
                        return makeDocSnapshot(ref, session.data, true);
                    })))
                }))
            };
        }),
        collection: vi.fn((path) => ({
            get: vi.fn(async () => {
                if (path.endsWith('/players')) {
                    const teamId = path.split('/')[1];
                    const players = playersByTeam[teamId] || [];
                    return makeQuerySnapshot(players.map((player) => {
                        const ref = { path: `${path}/${player.id}`, id: player.id };
                        return makeDocSnapshot(ref, player.data, true);
                    }));
                }
                if (path.endsWith('/packetCompletions')) {
                    const completions = completionsBySessionPath[path.replace('/packetCompletions', '')] || [];
                    return makeQuerySnapshot(completions.map((completion) => {
                        const ref = { path: `${path}/${completion.id}`, id: completion.id };
                        return makeDocSnapshot(ref, completion.data, true);
                    }));
                }
                return makeQuerySnapshot([]);
            })
        })),
        doc: vi.fn((path) => ({
            path,
            id: path.split('/').pop(),
            async get() {
                if (path.includes('/private/profile')) {
                    const data = privateProfiles[path];
                    return makeDocSnapshot(this, data, data !== undefined);
                }
                const data = reminderDocStore.get(path);
                return makeDocSnapshot(this, data, data !== undefined);
            },
            async set(value) {
                reminderDocStore.set(path, { ...(reminderDocStore.get(path) || {}), ...(value || {}) });
            }
        })),
        async runTransaction(handler) {
            return handler({
                get: (ref) => ref.get(),
                set: (ref, value) => {
                    reminderDocStore.set(ref.path, { ...(reminderDocStore.get(ref.path) || {}), ...(value || {}) });
                }
            });
        }
    };

    const functions = {
        pubsub: {
            schedule: vi.fn(() => ({
                onRun: vi.fn((handler) => handler)
            }))
        },
        logger: {
            error: vi.fn()
        }
    };
    const admin = {
        firestore: {
            FieldValue: {
                serverTimestamp: () => ({ __serverTimestamp: true })
            }
        }
    };
    const crypto = {
        randomUUID: () => 'claim-1234'
    };
    const exportsObject = {};
    const factory = new Function(
        'exports',
        'functions',
        'admin',
        'firestore',
        'NOTIFICATION_CATEGORIES',
        'getTargetsForCategory',
        'getTeamFeeRecipientTargetUserIds',
        'sendDirectTargetsNotification',
        'crypto',
        `${extractReminderSource()}\nreturn { trigger: exports.sendPracticePacketDueTomorrowReminders, sendPracticePacketDueTomorrowReminders };`
    );

    const built = factory(
        exportsObject,
        functions,
        admin,
        firestore,
        categories,
        getTargetsForCategory,
        getTeamFeeRecipientTargetUserIds,
        sendDirectTargetsNotification,
        crypto
    );

    return {
        now,
        trigger: built.trigger,
        sendPracticePacketDueTomorrowReminders: built.sendPracticePacketDueTomorrowReminders,
        functions,
        firestore,
        getTargetsForCategory,
        getTeamFeeRecipientTargetUserIds,
        sendDirectTargetsNotification,
        reminderDocStore
    };
}

describe('sendPracticePacketDueTomorrowReminders', () => {
    it('sends one practice reminder only for incomplete players with enabled parent targets, including private-profile caregivers', async () => {
        const harness = buildHarness({
            sessions: [
                {
                    path: 'teams/team-1/practiceSessions/session-1',
                    data: {
                        title: 'Thursday Practice',
                        eventId: 'practice-44',
                        homePacketGenerated: true,
                        homePacketContent: {
                            blocks: [{ id: 'block-1' }],
                            dueDate: '2026-06-21T09:00:00.000Z'
                        }
                    }
                }
            ],
            playersByTeam: {
                'team-1': [
                    { id: 'player-1', data: { name: 'Pat', parents: [{ userId: 'parent-1' }] } },
                    { id: 'player-2', data: { name: 'Sam', parents: [{ userId: 'parent-2' }] } },
                    { id: 'player-3', data: { name: 'Alex', parents: [{ userId: 'parent-3' }] } }
                ]
            },
            completionsBySessionPath: {
                'teams/team-1/practiceSessions/session-1': [
                    { id: 'parent-1__player-1', data: { childId: 'player-1', status: 'completed' } }
                ]
            },
            privateProfiles: {
                'teams/team-1/players/player-2/private/profile': {
                    parents: [{ userId: 'caregiver-2' }]
                }
            },
            practiceTargetsByTeam: {
                'team-1': [
                    { uid: 'parent-2', token: 'parent-2-token', teamId: 'team-1' },
                    { uid: 'caregiver-2', token: 'caregiver-2-token', teamId: 'team-1' }
                ]
            }
        });

        const result = await harness.sendPracticePacketDueTomorrowReminders(harness.now);

        expect(result).toEqual([
            { teamId: 'team-1', sessionId: 'session-1', playerId: 'player-2', targetCount: 2 }
        ]);
        expect(harness.getTargetsForCategory).toHaveBeenCalledWith('team-1', 'practice', null);
        expect(harness.sendDirectTargetsNotification).toHaveBeenCalledTimes(1);
        expect(harness.sendDirectTargetsNotification).toHaveBeenCalledWith(expect.objectContaining({
            targets: [
                { uid: 'parent-2', token: 'parent-2-token', teamId: 'team-1' },
                { uid: 'caregiver-2', token: 'caregiver-2-token', teamId: 'team-1' }
            ],
            category: 'practice',
            title: 'Reminder: Thursday Practice is due tomorrow',
            body: 'Sam has not completed the home packet for Thursday Practice yet.',
            teamId: 'team-1',
            eventId: 'session-1',
            linkOverride: 'https://allplays.ai/app/#/schedule/team-1/practice-44?section=game',
            appRouteOverride: '/schedule/team-1/practice-44?section=game'
        }));
        expect(
            harness.reminderDocStore.get('teams/team-1/practiceSessions/session-1/packetReminderSends/player-2')
        ).toEqual(expect.objectContaining({
            playerId: 'player-2',
            deliveryClaimId: null,
            deliveryClaimedAt: null
        }));
        expect(
            harness.reminderDocStore.has('teams/team-1/practiceSessions/session-1/packetReminderSends/player-1')
        ).toBe(false);
    });

    it('clears failed reminder claims so later players still send and retries can deliver later', async () => {
        const harness = buildHarness({
            sessions: [
                {
                    path: 'teams/team-1/practiceSessions/session-1',
                    data: {
                        title: 'Thursday Practice',
                        homePacketGenerated: true,
                        homePacketContent: {
                            blocks: [{ id: 'block-1' }],
                            dueDate: '2026-06-21T09:00:00.000Z'
                        }
                    }
                }
            ],
            playersByTeam: {
                'team-1': [
                    { id: 'player-2', data: { name: 'Sam', parents: [{ userId: 'parent-2' }] } },
                    { id: 'player-3', data: { name: 'Alex', parents: [{ userId: 'parent-3' }] } }
                ]
            },
            practiceTargetsByTeam: {
                'team-1': [
                    { uid: 'parent-2', token: 'parent-2-token', teamId: 'team-1' },
                    { uid: 'parent-3', token: 'parent-3-token', teamId: 'team-1' }
                ]
            }
        });
        harness.sendDirectTargetsNotification
            .mockRejectedValueOnce(new Error('FCM unavailable'))
            .mockResolvedValue({ successCount: 1, failureCount: 0 });

        const firstResult = await harness.sendPracticePacketDueTomorrowReminders(harness.now);

        expect(firstResult).toEqual([
            { teamId: 'team-1', sessionId: 'session-1', playerId: 'player-3', targetCount: 1 }
        ]);
        expect(
            harness.reminderDocStore.get('teams/team-1/practiceSessions/session-1/packetReminderSends/player-2')
        ).toEqual(expect.objectContaining({
            playerId: 'player-2',
            reminderSentAt: null,
            deliveryClaimId: null,
            deliveryClaimedAt: null,
            lastError: 'FCM unavailable'
        }));
        expect(harness.functions.logger.error).toHaveBeenCalledWith(
            'Failed to send practice packet due tomorrow reminder.',
            expect.objectContaining({ teamId: 'team-1', sessionId: 'session-1', playerId: 'player-2', error: 'FCM unavailable' })
        );

        const secondResult = await harness.sendPracticePacketDueTomorrowReminders(harness.now);

        expect(secondResult).toEqual([
            { teamId: 'team-1', sessionId: 'session-1', playerId: 'player-2', targetCount: 1 }
        ]);
        expect(harness.sendDirectTargetsNotification).toHaveBeenCalledTimes(3);
        expect(
            harness.reminderDocStore.get('teams/team-1/practiceSessions/session-1/packetReminderSends/player-2')
        ).toEqual(expect.objectContaining({
            playerId: 'player-2',
            deliveryClaimId: null,
            deliveryClaimedAt: null,
            lastError: null
        }));
    });

    it('logs and exits when practice notifications are unavailable', async () => {
        const harness = buildHarness({
            categories: ['schedule']
        });

        const result = await harness.sendPracticePacketDueTomorrowReminders(harness.now);

        expect(result).toEqual([]);
        expect(harness.functions.logger.error).toHaveBeenCalledWith(
            'sendPracticePacketDueTomorrowReminders requires the practice notification category.',
            expect.objectContaining({ availableCategories: ['schedule'] })
        );
        expect(harness.getTargetsForCategory).not.toHaveBeenCalled();
        expect(harness.sendDirectTargetsNotification).not.toHaveBeenCalled();
    });
});
