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

function extractNotifyPracticePacketAssigned() {
    return [
        extractChunk('function buildPracticePacketNotificationDestination(', 'function buildNotificationLink'),
        extractChunk('exports.notifyPracticePacketAssigned = functions.firestore', 'function writePublicRsvpCors')
    ].join('\n');
}

function createDeferred() {
    let resolve;
    const promise = new Promise((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
}

function buildHarness({
    categories = ['practice', 'schedule'],
    targets = [],
    users = [],
    sendResult = null
} = {}) {
    const sendDirectTargetsNotification = vi.fn(() => sendResult || Promise.resolve({ successCount: 1, failureCount: 0 }));
    const getTargetsForCategory = vi.fn(async () => targets);
    const getCandidateUsersForTeam = vi.fn(async () => users);
    const firestore = {};
    const functions = {
        firestore: {
            document: vi.fn(() => ({
                onWrite: vi.fn((handler) => handler)
            }))
        },
        logger: {
            error: vi.fn(),
            warn: vi.fn()
        }
    };
    const exportsObject = {};
    const factory = new Function(
        'exports',
        'functions',
        'firestore',
        'NOTIFICATION_CATEGORIES',
        'getTargetsForCategory',
        'getCandidateUsersForTeam',
        'sendDirectTargetsNotification',
        `${extractNotifyPracticePacketAssigned()}\nreturn exports.notifyPracticePacketAssigned;`
    );
    const trigger = factory(
        exportsObject,
        functions,
        firestore,
        categories,
        getTargetsForCategory,
        getCandidateUsersForTeam,
        sendDirectTargetsNotification
    );

    return {
        trigger,
        functions,
        getTargetsForCategory,
        getCandidateUsersForTeam,
        sendDirectTargetsNotification
    };
}

describe('notifyPracticePacketAssigned trigger', () => {
    it('fires from the practice session write and targets only parent devices', async () => {
        const harness = buildHarness({
            targets: [
                { uid: 'parent-1', token: 'parent-1-token', teamId: 'team-1' },
                { uid: 'parent-2', token: 'parent-2-token', teamId: 'team-1' },
                { uid: 'staff-1', token: 'staff-token', teamId: 'team-1' }
            ],
            users: [
                { uid: 'parent-1', roles: ['parent'] },
                { uid: 'parent-2', roles: ['parent'] },
                { uid: 'staff-1', roles: ['staff'] }
            ]
        });

        await harness.trigger({
            before: {
                exists: true,
                data: () => ({ title: 'Thursday Practice', eventId: 'practice-44' })
            },
            after: {
                exists: true,
                data: () => ({
                    title: 'Thursday Practice',
                    eventId: 'practice-44',
                    date: '2026-06-21',
                    homePacketContent: {
                        blocks: [{ id: 'block-1', title: 'Ball handling' }],
                        totalMinutes: 20,
                        updatedAt: '2026-06-19T20:15:00.000Z'
                    }
                })
            }
        }, {
            params: { teamId: 'team-1', sessionId: 'session-1' }
        });

        expect(harness.getTargetsForCategory).toHaveBeenCalledWith('team-1', 'practice', null);
        expect(harness.getCandidateUsersForTeam).toHaveBeenCalledWith('team-1');
        expect(harness.sendDirectTargetsNotification).toHaveBeenCalledWith(expect.objectContaining({
            targets: [
                { uid: 'parent-1', token: 'parent-1-token', teamId: 'team-1' },
                { uid: 'parent-2', token: 'parent-2-token', teamId: 'team-1' }
            ],
            category: 'practice',
            title: 'Practice packet ready',
            body: 'Thursday Practice is ready. Due Jun 21, 2026.',
            eventId: 'session-1',
            linkOverride: 'https://allplays.ai/app/#/schedule/team-1/practice-44?section=game',
            appRouteOverride: '/schedule/team-1/practice-44?section=game'
        }));
    });

    it('awaits notification delivery before completing the write handler', async () => {
        const sendDeferred = createDeferred();
        const harness = buildHarness({
            targets: [{ uid: 'parent-1', token: 'parent-1-token', teamId: 'team-1' }],
            users: [{ uid: 'parent-1', roles: ['parent'] }],
            sendResult: sendDeferred.promise
        });

        let completed = false;
        const triggerPromise = harness.trigger({
            before: { exists: false, data: () => null },
            after: {
                exists: true,
                data: () => ({
                    title: 'Thursday Practice',
                    eventId: 'practice-44',
                    homePacketContent: {
                        blocks: [{ id: 'block-1' }],
                        updatedAt: '2026-06-19T20:15:00.000Z'
                    }
                })
            }
        }, {
            params: { teamId: 'team-1', sessionId: 'session-1' }
        }).then(() => {
            completed = true;
        });

        await Promise.resolve();
        expect(completed).toBe(false);

        sendDeferred.resolve({ successCount: 1, failureCount: 0 });
        await triggerPromise;
        expect(completed).toBe(true);
    });

    it('uses packet title and due date fallbacks when session fields are missing', async () => {
        const harness = buildHarness({
            targets: [{ uid: 'parent-1', token: 'parent-1-token', teamId: 'team-1' }],
            users: [{ uid: 'parent-1', roles: ['parent'] }]
        });

        await harness.trigger({
            before: { exists: false, data: () => null },
            after: {
                exists: true,
                data: () => ({
                    homePacketContent: {
                        packetTitle: 'Weekend shooting plan',
                        dueAt: { seconds: 1782259200 },
                        blocks: [{ id: 'block-1' }]
                    }
                })
            }
        }, {
            params: { teamId: 'team-1', sessionId: 'session-99' }
        });

        expect(harness.sendDirectTargetsNotification).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Practice packet ready',
            body: 'Weekend shooting plan is ready. Due Jun 24, 2026.',
            eventId: 'session-99',
            linkOverride: 'https://allplays.ai/app/#/schedule/team-1/session-99?section=game',
            appRouteOverride: '/schedule/team-1/session-99?section=game'
        }));
    });

    it('logs and exits when practice notifications are unavailable', async () => {
        const harness = buildHarness({ categories: ['schedule'] });

        await harness.trigger({
            before: { exists: false, data: () => null },
            after: {
                exists: true,
                data: () => ({
                    homePacketContent: {
                        blocks: [{ id: 'block-1' }]
                    }
                })
            }
        }, {
            params: { teamId: 'team-1', sessionId: 'session-1' }
        });

        expect(harness.functions.logger.error).toHaveBeenCalledWith(
            'notifyPracticePacketAssigned requires the practice notification category.',
            expect.objectContaining({ teamId: 'team-1' })
        );
        expect(harness.getTargetsForCategory).not.toHaveBeenCalled();
        expect(harness.sendDirectTargetsNotification).not.toHaveBeenCalled();
    });

    it('does not re-notify when the home packet payload is unchanged', async () => {
        const harness = buildHarness({
            targets: [{ uid: 'parent-1', token: 'parent-1-token', teamId: 'team-1' }],
            users: [{ uid: 'parent-1', roles: ['parent'] }]
        });
        const packet = {
            blocks: [{ id: 'block-1' }],
            updatedAt: '2026-06-19T20:15:00.000Z'
        };

        await harness.trigger({
            before: {
                exists: true,
                data: () => ({
                    title: 'Thursday Practice',
                    eventId: 'practice-44',
                    homePacketContent: packet
                })
            },
            after: {
                exists: true,
                data: () => ({
                    title: 'Thursday Practice',
                    eventId: 'practice-44',
                    attendancePlayers: 8,
                    homePacketContent: { ...packet }
                })
            }
        }, {
            params: { teamId: 'team-1', sessionId: 'session-1' }
        });

        expect(harness.sendDirectTargetsNotification).not.toHaveBeenCalled();
    });
});
