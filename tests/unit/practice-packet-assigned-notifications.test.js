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
        extractChunk('exports.notifyPracticePacketAssigned = functions.firestore', 'const PUBLIC_RSVP_TOKEN_TTL_DAYS')
    ].join('\n');
}

function buildHarness({
    categories = ['practice', 'schedule'],
    targets = [],
    packetSession = { eventId: 'practice-1', title: 'Thursday Practice' },
    parentDocsByKey = {}
} = {}) {
    const sendDirectTargetsNotification = vi.fn(async () => ({ successCount: 1, failureCount: 0 }));
    const getTargetsForCategory = vi.fn(async () => targets);
    const queryCalls = [];
    const firestore = {
        collection: vi.fn((path) => ({
            where: vi.fn((field, operator, values) => ({
                get: vi.fn(async () => {
                    queryCalls.push({ path, field, operator, values });
                    const docs = (parentDocsByKey[values.join('|')] || []).map((doc) => ({
                        id: doc.id,
                        data: () => doc.data
                    }));
                    return {
                        forEach(callback) {
                            docs.forEach(callback);
                        }
                    };
                })
            }))
        })),
        doc: vi.fn((path) => ({
            get: vi.fn(async () => ({
                exists: path === 'teams/team-1/practiceSessions/session-1',
                data: () => packetSession
            }))
        }))
    };
    const functions = {
        firestore: {
            document: vi.fn(() => ({
                onCreate: vi.fn((handler) => handler)
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
        'sendDirectTargetsNotification',
        `${extractNotifyPracticePacketAssigned()}\nreturn exports.notifyPracticePacketAssigned;`
    );
    const trigger = factory(
        exportsObject,
        functions,
        firestore,
        categories,
        getTargetsForCategory,
        sendDirectTargetsNotification
    );

    return {
        trigger,
        firestore,
        functions,
        getTargetsForCategory,
        sendDirectTargetsNotification,
        queryCalls
    };
}

describe('notifyPracticePacketAssigned trigger', () => {
    it('targets only parents of assigned players and sends the packet deep link', async () => {
        const harness = buildHarness({
            targets: [
                { uid: 'parent-1', token: 'parent-1-token', teamId: 'team-1' },
                { uid: 'parent-2', token: 'parent-2-token', teamId: 'team-1' },
                { uid: 'parent-3', token: 'parent-3-token', teamId: 'team-1' }
            ],
            packetSession: { eventId: 'practice-44', title: 'Thursday Practice' },
            parentDocsByKey: {
                'team-1::player-1|team-1::player-2': [
                    { id: 'parent-1', data: { parentPlayerKeys: ['team-1::player-1'] } },
                    { id: 'parent-2', data: { parentPlayerKeys: ['team-1::player-2', 'team-1::player-9'] } }
                ]
            }
        });

        await harness.trigger({
            data: () => ({
                title: 'Ball handling packet',
                dueDate: '2026-06-21',
                assignedPlayerIds: ['player-1', 'player-2']
            })
        }, {
            params: { teamId: 'team-1', sessionId: 'session-1', packetId: 'packet-1' }
        });

        expect(harness.queryCalls).toEqual([
            {
                path: 'users',
                field: 'parentPlayerKeys',
                operator: 'array-contains-any',
                values: ['team-1::player-1', 'team-1::player-2']
            }
        ]);
        expect(harness.getTargetsForCategory).toHaveBeenCalledWith('team-1', 'practice', null);
        expect(harness.sendDirectTargetsNotification).toHaveBeenCalledWith(expect.objectContaining({
            targets: [
                { uid: 'parent-1', token: 'parent-1-token', teamId: 'team-1' },
                { uid: 'parent-2', token: 'parent-2-token', teamId: 'team-1' }
            ],
            category: 'practice',
            title: 'Practice packet ready',
            body: 'Ball handling packet is ready. Due Jun 21, 2026.',
            eventId: 'session-1',
            linkOverride: 'https://allplays.ai/app/#/schedule/team-1/practice-44?section=game',
            appRouteOverride: '/schedule/team-1/practice-44?section=game'
        }));
    });

    it('logs and exits when practice notifications are unavailable', async () => {
        const harness = buildHarness({ categories: ['schedule'] });

        await harness.trigger({
            data: () => ({
                title: 'Ball handling packet',
                assignedPlayerIds: ['player-1']
            })
        }, {
            params: { teamId: 'team-1', sessionId: 'session-1', packetId: 'packet-1' }
        });

        expect(harness.functions.logger.error).toHaveBeenCalledWith(
            'notifyPracticePacketAssigned requires the practice notification category.',
            expect.objectContaining({ teamId: 'team-1' })
        );
        expect(harness.getTargetsForCategory).not.toHaveBeenCalled();
        expect(harness.sendDirectTargetsNotification).not.toHaveBeenCalled();
    });

    it('does not notify unassigned parents even when they have practice devices', async () => {
        const harness = buildHarness({
            targets: [
                { uid: 'parent-1', token: 'parent-1-token', teamId: 'team-1' },
                { uid: 'parent-9', token: 'parent-9-token', teamId: 'team-1' }
            ],
            parentDocsByKey: {
                'team-1::player-1': [
                    { id: 'parent-1', data: { parentPlayerKeys: ['team-1::player-1'] } }
                ]
            }
        });

        await harness.trigger({
            data: () => ({
                packetTitle: 'Shooting packet',
                assignedPlayers: [{ playerId: 'player-1' }]
            })
        }, {
            params: { teamId: 'team-1', sessionId: 'session-1', packetId: 'packet-2' }
        });

        expect(harness.sendDirectTargetsNotification).toHaveBeenCalledWith(expect.objectContaining({
            targets: [{ uid: 'parent-1', token: 'parent-1-token', teamId: 'team-1' }]
        }));
    });
});
