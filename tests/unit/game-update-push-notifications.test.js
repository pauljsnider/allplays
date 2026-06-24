import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const scheduleNotificationUtils = require('../../functions/schedule-notification-utils.cjs');

function getScheduleNotificationHelpers() {
    const start = functionsSource.indexOf('function toNumericScore');
    const end = functionsSource.indexOf('function buildNotificationLink');
    const firstSlice = functionsSource.slice(start, end);
    const secondStart = functionsSource.indexOf('function normalizeScheduleStatus');
    const secondEnd = functionsSource.indexOf('function getReminderDueAt');
    const secondSlice = functionsSource.slice(secondStart, secondEnd);
    return new Function(
        'deps',
        `${firstSlice}\nconst { getEventTitle, formatScheduleUpdateDate } = deps;\n${secondSlice}; return { buildScheduleUpdateNotificationPayload, detectGameNotificationCategory };`
    )(scheduleNotificationUtils);
}

const {
    buildScheduleUpdateNotificationPayload,
    detectGameNotificationCategory
} = getScheduleNotificationHelpers();

describe('game schedule update push notifications', () => {
    it('builds a cancellation payload that names the event', () => {
        const payload = buildScheduleUpdateNotificationPayload(
            { status: 'scheduled', opponent: 'Wildcats' },
            { status: 'cancelled', opponent: 'Wildcats' }
        );

        expect(payload.title).toBe('Event canceled');
        expect(payload.body).toContain('vs. Wildcats');
        expect(payload.body).toContain('was canceled');
        expect(payload.body.length).toBeLessThanOrEqual(120);
    });

    it('builds a date/time payload with the new event time', () => {
        const payload = buildScheduleUpdateNotificationPayload(
            { title: 'Practice', date: '2026-01-10T22:00:00.000Z' },
            { title: 'Practice', date: '2026-01-11T01:30:00.000Z', timeZone: 'America/Chicago' }
        );

        expect(payload.title).toBe('Schedule update');
        expect(payload.body).toContain('Practice moved to');
        expect(payload.body).toContain('Sat, Jan 10');
        expect(payload.body).toContain('7:30 PM');
        expect(payload.body.length).toBeLessThanOrEqual(120);
    });

    it('omits date/time details when no timezone is available', () => {
        const payload = buildScheduleUpdateNotificationPayload(
            { title: 'Practice', date: '2026-03-10T22:00:00.000Z' },
            { title: 'Practice', date: '2026-03-11T00:30:00.000Z' }
        );

        expect(payload.title).toBe('Schedule update');
        expect(payload.body).toBe('Practice date/time changed. Tap to review.');
        expect(payload.body).not.toContain('UTC');
        expect(payload.body).not.toContain('PM');
        expect(payload.body.length).toBeLessThanOrEqual(120);
    });

    it('builds a location payload with the new location', () => {
        const payload = buildScheduleUpdateNotificationPayload(
            { opponent: 'Falcons', location: 'Field 1' },
            { opponent: 'Falcons', location: 'North Complex Field 3' }
        );

        expect(payload.body).toBe('vs. Falcons moved to North Complex Field 3.');
        expect(payload.body.length).toBeLessThanOrEqual(120);
    });

    it('prioritizes cancellation over other schedule changes and truncates long bodies', () => {
        const payload = buildScheduleUpdateNotificationPayload(
            { status: 'scheduled', opponent: 'Falcons', location: 'Field 1', date: '2026-03-10T22:00:00.000Z' },
            {
                status: 'canceled',
                title: 'Regional championship final against the undefeated northside thunderbirds',
                opponent: 'Thunderbirds',
                location: 'A very long tournament complex name with extra directions and parking notes',
                date: '2026-03-11T00:30:00.000Z'
            }
        );

        expect(payload.title).toBe('Event canceled');
        expect(payload.body).toContain('was canceled');
        expect(payload.body.length).toBeLessThanOrEqual(120);
    });

    it('ignores unchanged non-schedule fields', () => {
        expect(detectGameNotificationCategory(
            { title: 'Practice', notes: 'Bring water' },
            { title: 'Practice', notes: 'Bring both jerseys' }
        )).toBeNull();
    });

    it('keeps live score routing unchanged and wires schedule pushes through the detailed payload helper', () => {
        const notifyBody = functionsSource.slice(functionsSource.indexOf('exports.notifyGameUpdated'));
        const liveScoreIndex = notifyBody.indexOf("category === 'liveScore'");
        const scoreBodyIndex = notifyBody.indexOf('Score is now ${toNumericScore(after.homeScore)}-${toNumericScore(after.awayScore)}');
        const schedulePayloadIndex = notifyBody.indexOf('buildScheduleUpdateNotificationPayload(before, after)');
        const indexedLookupIndex = functionsSource.indexOf("firestore.collection(`teams/${teamId}/notificationTargets`)");

        expect(liveScoreIndex).toBeGreaterThan(-1);
        expect(scoreBodyIndex).toBeGreaterThan(liveScoreIndex);
        expect(schedulePayloadIndex).toBeGreaterThan(scoreBodyIndex);
        expect(indexedLookupIndex).toBeGreaterThan(-1);
        expect(notifyBody).toContain('title: payload.title');
        expect(notifyBody).toContain('body: payload.body');
    });

    it('deduplicates live score sends by the before/after score transition before delivering notifications', async () => {
        const sendCategoryNotification = vi.fn(async () => ({ successCount: 1, failureCount: 0 }));
        const checkAndSetNotificationDedup = vi.fn(async () => true);
        const handler = new Function(
            'functions',
            'detectGameNotificationCategory',
            'sendCategoryNotification',
            'checkAndSetNotificationDedup',
            'toNumericScore',
            'buildScheduleUpdateNotificationPayload',
            `const exports = {};
${functionsSource.slice(functionsSource.indexOf('exports.notifyGameUpdated = functions.firestore'), functionsSource.indexOf('const notifyGameCreated ='))}
return exports.notifyGameUpdated;`
        )(
            {
                firestore: {
                    document: () => ({ onUpdate: (onUpdateHandler) => onUpdateHandler })
                },
                logger: {
                    info: vi.fn()
                }
            },
            () => 'liveScore',
            sendCategoryNotification,
            checkAndSetNotificationDedup,
            (value) => Number(value || 0),
            () => ({ title: 'unused', body: 'unused' })
        );

        await handler({
            before: { data: () => ({ homeScore: 1, awayScore: 0 }) },
            after: { data: () => ({ homeScore: 2, awayScore: 0, updatedBy: 'staff-1' }) }
        }, {
            params: { teamId: 'team-1', gameId: 'game-7' }
        });

        expect(checkAndSetNotificationDedup).toHaveBeenCalledWith(
            'team-1',
            'liveScore',
            'game-7',
            'score:1:0->2:0'
        );
        expect(sendCategoryNotification).toHaveBeenCalledWith(expect.objectContaining({
            teamId: 'team-1',
            gameId: 'game-7',
            category: 'liveScore',
            dedupKey: 'score:1:0->2:0'
        }));
    });
});
