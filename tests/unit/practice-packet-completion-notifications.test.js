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

function extractNotifyPracticePacketCompleted() {
    return [
        extractChunk('function buildPracticePacketNotificationDestination(', 'function buildNotificationLink'),
        extractChunk('exports.notifyPracticePacketCompleted = functions.firestore', 'const PUBLIC_RSVP_TOKEN_TTL_DAYS')
    ].join('\n');
}

function buildTriggerHarness({
    categories = ['practice', 'schedule'],
    targets = [],
    users = [],
    session = { eventId: 'practice-1', title: 'Practice' }
} = {}) {
    const sendDirectTargetsNotification = vi.fn(async () => ({ successCount: 1, failureCount: 0 }));
    const getTargetsForCategory = vi.fn(async () => targets);
    const getCandidateUsersForTeam = vi.fn(async () => users);
    const firestore = {
        doc: vi.fn((path) => ({
            get: vi.fn(async () => ({
                exists: path === 'teams/team-1/practiceSessions/session-1',
                data: () => session
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
        'getCandidateUsersForTeam',
        'sendDirectTargetsNotification',
        `${extractNotifyPracticePacketCompleted()}\nreturn exports.notifyPracticePacketCompleted;`
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
        firestore,
        functions,
        getTargetsForCategory,
        getCandidateUsersForTeam,
        sendDirectTargetsNotification
    };
}

describe('notifyPracticePacketCompleted trigger', () => {
    it('sends practice notifications only to staff targets and excludes parent devices', async () => {
        const harness = buildTriggerHarness({
            targets: [
                { uid: 'parent-1', token: 'parent-token', teamId: 'team-1' },
                { uid: 'staff-1', token: 'staff-token', teamId: 'team-1' },
                { uid: 'staff-2', token: 'staff-2-token', teamId: 'team-1' }
            ],
            users: [
                { uid: 'parent-1', roles: ['parent'] },
                { uid: 'staff-1', roles: ['staff'] },
                { uid: 'staff-2', roles: ['staff', 'parent'] }
            ]
        });

        await harness.trigger({
            data: () => ({
                parentUserId: 'parent-1',
                childId: 'player-1',
                childName: 'Pat'
            })
        }, {
            params: { teamId: 'team-1', sessionId: 'session-1', completionId: 'parent-1__player-1' }
        });

        expect(harness.getTargetsForCategory).toHaveBeenCalledWith('team-1', 'practice', null);
        expect(harness.getCandidateUsersForTeam).toHaveBeenCalledWith('team-1');
        expect(harness.firestore.doc).toHaveBeenCalledWith('teams/team-1/practiceSessions/session-1');
        expect(harness.sendDirectTargetsNotification).toHaveBeenCalledWith(expect.objectContaining({
            targets: [
                { uid: 'staff-1', token: 'staff-token', teamId: 'team-1' },
                { uid: 'staff-2', token: 'staff-2-token', teamId: 'team-1' }
            ],
            category: 'practice',
            title: 'Home packet completed: Pat',
            body: 'Pat completed the home packet for Practice.',
            eventId: 'session-1',
            linkOverride: 'https://allplays.ai/app/#/schedule/team-1/practice-1',
            appRouteOverride: '/schedule/team-1/practice-1'
        }));
    });

    it('reuses the same collapse-scoped event id for repeated completions on one packet', async () => {
        const harness = buildTriggerHarness({
            targets: [{ uid: 'staff-1', token: 'staff-token', teamId: 'team-1' }],
            users: [{ uid: 'staff-1', roles: ['staff'] }]
        });

        await harness.trigger({
            data: () => ({ parentUserId: 'parent-1', childName: 'Pat' })
        }, {
            params: { teamId: 'team-1', sessionId: 'session-1', completionId: 'parent-1__player-1' }
        });
        await harness.trigger({
            data: () => ({ parentUserId: 'parent-2', childName: 'Sam' })
        }, {
            params: { teamId: 'team-1', sessionId: 'session-1', completionId: 'parent-2__player-2' }
        });

        expect(harness.sendDirectTargetsNotification).toHaveBeenCalledTimes(2);
        expect(harness.sendDirectTargetsNotification).toHaveBeenNthCalledWith(1, expect.objectContaining({ eventId: 'session-1' }));
        expect(harness.sendDirectTargetsNotification).toHaveBeenNthCalledWith(2, expect.objectContaining({ eventId: 'session-1' }));
    });

    it('logs and exits when the practice notification category is unavailable', async () => {
        const harness = buildTriggerHarness({ categories: ['schedule'] });

        await harness.trigger({
            data: () => ({ parentUserId: 'parent-1', childName: 'Pat' })
        }, {
            params: { teamId: 'team-1', sessionId: 'session-1', completionId: 'parent-1__player-1' }
        });

        expect(harness.functions.logger.error).toHaveBeenCalledWith(
            'notifyPracticePacketCompleted requires the practice notification category.',
            expect.objectContaining({ teamId: 'team-1' })
        );
        expect(harness.getTargetsForCategory).not.toHaveBeenCalled();
        expect(harness.sendDirectTargetsNotification).not.toHaveBeenCalled();
    });
});
