import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    expandRecurrence: vi.fn(),
    getSubstitutionOptions: vi.fn()
}));

vi.mock('../../../../../js/schedule-notifications.js', () => ({
    sendPublicRsvpReminderEmails: vi.fn()
}));
vi.mock('../../../../../js/admin-user-official-links.js', () => ({
    normalizeOfficialLinkEmail: vi.fn((value: unknown) => value),
    normalizeOfficialLinkPhone: vi.fn((value: unknown) => value)
}));
vi.mock('../../../../../js/officiating-utils.js', () => ({
    getAssignedOfficiatingSlots: vi.fn(() => []),
    getOpenOfficiatingSlots: vi.fn(() => [])
}));
vi.mock('../../../../../js/utils.js', () => ({
    expandRecurrence: mocks.expandRecurrence,
    extractOpponent: vi.fn(() => ''),
    fetchAndParseCalendar: vi.fn(async () => []),
    generateSeriesId: vi.fn(() => 'series-1'),
    getCalendarEventTrackingId: vi.fn(() => ''),
    isPracticeEvent: vi.fn(() => false),
    isTrackedCalendarEvent: vi.fn(() => false)
}));
vi.mock('../../../../../js/parent-dashboard-practice-sessions.js', () => ({
    filterVisiblePracticeSessions: vi.fn(() => [])
}));
vi.mock('../../../../../js/parent-dashboard-packets.js', () => ({
    buildPracticePacketCompletionPayload: vi.fn(() => ({}))
}));
vi.mock('../../../../../js/parent-dashboard-rsvp.js', () => ({
    resolveMyRsvpByChildForGame: vi.fn(() => ({}))
}));
vi.mock('../../../../../js/game-day-rsvp-breakdown.js', () => ({
    buildGameDayRsvpBreakdown: vi.fn(() => ({ grouped: {}, counts: {} }))
}));
vi.mock('../../../../../js/game-day-periods.js', () => ({
    getPeriodsForFormation: vi.fn(() => [])
}));
vi.mock('../../../../../js/rideshare-helpers.js', () => ({
    getEventRideshareSummary: vi.fn(() => ({}))
}));
vi.mock('../../../../../js/snack-helpers.js', () => ({
    mergeAssignmentsWithClaims: vi.fn(() => [])
}));
vi.mock('../../../../../js/team-access.js', () => ({
    hasScorekeepingTeamAccess: vi.fn(() => false)
}));
vi.mock('../../../../../js/team-visibility.js', () => ({
    isTeamActive: vi.fn(() => true)
}));
vi.mock('../../../../../js/game-day-live-substitutions.js', () => ({
    applyLiveSubstitution: vi.fn(() => null),
    getSubstitutionOptions: mocks.getSubstitutionOptions
}));
vi.mock('../../../../../js/game-plan-interop.js', () => ({
    buildRotationPlanFromGamePlan: vi.fn(() => ({}))
}));
vi.mock('../../../../../js/edit-schedule-practice-payload.js', () => ({
    applyPracticeRecurrenceFields: vi.fn((payload: Record<string, unknown>) => payload.practiceData)
}));

import { expandRecurrence, getSubstitutionOptions } from './legacyScheduleHelpers';

describe('legacyScheduleHelpers', () => {
    it('keeps normalizeArray accepting unknown values for legacy payload normalization', () => {
        const source = readFileSync('src/lib/adapters/legacyScheduleHelpers.ts', 'utf8');
        expect(source).toContain('function normalizeArray<T = unknown>(value: unknown): T[]');
    });

    it('normalizes recurring practice occurrences to the fields consumed by scheduleService', () => {
        mocks.expandRecurrence.mockReturnValueOnce([
            {
                masterId: 'practice-master',
                instanceDate: '2026-06-24',
                date: '2026-06-24T18:00:00.000Z',
                end: '2026-06-24T19:30:00.000Z',
                notes: 'Bring water',
                location: 'North Field',
                title: 'Weekly Practice'
            },
            {
                masterId: 'missing-date'
            }
        ]);

        expect(expandRecurrence({ id: 'practice-master' })).toEqual([
            {
                masterId: 'practice-master',
                instanceDate: '2026-06-24',
                date: '2026-06-24T18:00:00.000Z',
                end: '2026-06-24T19:30:00.000Z',
                notes: 'Bring water',
                location: 'North Field',
                title: 'Weekly Practice'
            }
        ]);
    });

    it('accepts unknown substitution player collections before normalizing arrays', () => {
        mocks.getSubstitutionOptions.mockReturnValueOnce({
            onField: {
                GK: 'player-1'
            },
            onFieldPlayers: { id: 'bad-shape' },
            offFieldPlayers: 'not-an-array'
        });

        expect(getSubstitutionOptions({})).toEqual({
            onField: {
                GK: 'player-1'
            },
            onFieldPlayers: [],
            offFieldPlayers: []
        });
    });
});
