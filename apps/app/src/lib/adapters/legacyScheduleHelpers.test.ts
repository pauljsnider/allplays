import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    buildGameDayRsvpBreakdown: vi.fn(() => ({ grouped: {}, counts: {} })),
    expandRecurrence: vi.fn(),
    getSubstitutionOptions: vi.fn()
}));

vi.mock('@legacy/schedule-notifications.js', () => ({
    sendPublicRsvpReminderEmails: vi.fn()
}));
vi.mock('@legacy/admin-user-official-links.js', () => ({
    normalizeOfficialLinkEmail: vi.fn((value: unknown) => value),
    normalizeOfficialLinkPhone: vi.fn((value: unknown) => value)
}));
vi.mock('@legacy/officiating-utils.js', () => ({
    getAssignedOfficiatingSlots: vi.fn(() => []),
    getOpenOfficiatingSlots: vi.fn(() => [])
}));
vi.mock('@legacy/utils.js', () => ({
    expandRecurrence: mocks.expandRecurrence,
    extractOpponent: vi.fn(() => ''),
    fetchAndParseCalendar: vi.fn(async () => []),
    generateSeriesId: vi.fn(() => 'series-1'),
    getCalendarEventTrackingId: vi.fn(() => ''),
    isPracticeEvent: vi.fn(() => false),
    isTrackedCalendarEvent: vi.fn(() => false)
}));
vi.mock('@legacy/parent-dashboard-practice-sessions.js', () => ({
    filterVisiblePracticeSessions: vi.fn(() => [])
}));
vi.mock('@legacy/parent-dashboard-packets.js', () => ({
    buildPracticePacketCompletionPayload: vi.fn(() => ({}))
}));
vi.mock('@legacy/parent-dashboard-rsvp.js', () => ({
    resolveMyRsvpByChildForGame: vi.fn(() => ({}))
}));
vi.mock('@legacy/game-day-rsvp-breakdown.js', () => ({
    buildGameDayRsvpBreakdown: mocks.buildGameDayRsvpBreakdown
}));
vi.mock('@legacy/game-day-periods.js', () => ({
    getPeriodsForFormation: vi.fn(() => [])
}));
vi.mock('@legacy/rideshare-helpers.js', () => ({
    getEventRideshareSummary: vi.fn(() => ({}))
}));
vi.mock('@legacy/snack-helpers.js', () => ({
    mergeAssignmentsWithClaims: vi.fn(() => [])
}));
vi.mock('@legacy/team-access.js', () => ({
    hasScorekeepingTeamAccess: vi.fn(() => false)
}));
vi.mock('@legacy/team-visibility.js', () => ({
    isTeamActive: vi.fn(() => true)
}));
vi.mock('@legacy/game-day-live-substitutions.js', () => ({
    applyLiveSubstitution: vi.fn(() => null),
    getSubstitutionOptions: mocks.getSubstitutionOptions
}));
vi.mock('@legacy/game-plan-interop.js', () => ({
    buildRotationPlanFromGamePlan: vi.fn(() => ({}))
}));
vi.mock('@legacy/edit-schedule-practice-payload.js', () => ({
    applyPracticeRecurrenceFields: vi.fn((payload: Record<string, unknown>) => payload.practiceData)
}));

import { buildGameDayRsvpBreakdown, expandRecurrence, getSubstitutionOptions } from './legacyScheduleHelpers';

describe('legacyScheduleHelpers', () => {
    it('keeps normalizeArray accepting unknown values for legacy payload normalization', () => {
        const source = readFileSync('src/lib/adapters/legacyScheduleHelpers.ts', 'utf8');
        expect(source).toContain('function normalizeArray<T = unknown>(value: unknown): T[]');
        expect(source).toContain("from '@legacy/");
        expect(source).not.toContain('../../../../../js/');
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

    it('forwards parent-to-player fallback scope to legacy RSVP precedence resolution', () => {
        const fallbackByUser = new Map([['parent-1', ['player-1']]]);

        buildGameDayRsvpBreakdown({ players: [], rsvps: [], fallbackByUser });

        expect(mocks.buildGameDayRsvpBreakdown).toHaveBeenCalledWith({
            players: [],
            rsvps: [],
            fallbackByUser
        });
    });
});
