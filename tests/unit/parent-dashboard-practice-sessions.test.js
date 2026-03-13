import { describe, expect, it } from 'vitest';
import {
    isCancelledPracticeSession,
    filterVisiblePracticeSessions
} from '../../js/parent-dashboard-practice-sessions.js';

describe('parent dashboard practice session visibility', () => {
    it('hides recurring sessions linked to cancelled recurrence dates', () => {
        const sessions = [
            {
                id: 'session-cancelled',
                eventId: 'practice-master__2026-03-10'
            },
            {
                id: 'session-active',
                eventId: 'practice-master__2026-03-17'
            }
        ];
        const dbGames = [
            {
                id: 'practice-master',
                type: 'practice',
                isSeriesMaster: true,
                recurrence: { freq: 'weekly' },
                exDates: ['2026-03-10']
            }
        ];

        expect(isCancelledPracticeSession(sessions[0], dbGames)).toBe(true);
        expect(filterVisiblePracticeSessions(sessions, dbGames).map((session) => session.id)).toEqual(['session-active']);
    });

    it('hides directly linked cancelled one-off practices', () => {
        const session = {
            id: 'session-1',
            eventId: 'practice-1'
        };
        const dbGames = [
            {
                id: 'practice-1',
                type: 'practice',
                status: 'cancelled'
            }
        ];

        expect(isCancelledPracticeSession(session, dbGames)).toBe(true);
        expect(filterVisiblePracticeSessions([session], dbGames)).toEqual([]);
    });

    it('keeps unmatched draft sessions visible when no cancelled schedule link exists', () => {
        const session = {
            id: 'draft-session',
            eventId: 'draft-event'
        };

        expect(isCancelledPracticeSession(session, [])).toBe(false);
        expect(filterVisiblePracticeSessions([session], []).map((candidate) => candidate.id)).toEqual(['draft-session']);
    });
});
