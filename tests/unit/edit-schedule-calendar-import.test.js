import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    mergeCalendarImportEvents,
    validateCalendarImportUrl
} from '../../js/edit-schedule-calendar-import.js';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

describe('edit schedule calendar import helpers', () => {
    it('accepts valid .ics urls and rejects missing or non-ics values', () => {
        expect(validateCalendarImportUrl('')).toEqual({
            isValid: false,
            message: 'Please enter a calendar URL'
        });

        expect(validateCalendarImportUrl('https://example.com/calendar')).toEqual({
            isValid: false,
            message: 'Please enter a valid .ics calendar URL (must include .ics)'
        });

        expect(validateCalendarImportUrl('  https://example.com/team.ics?token=abc  ')).toEqual({
            isValid: true,
            normalizedUrl: 'https://example.com/team.ics?token=abc'
        });
    });

    it('merges imported game and practice events while suppressing tracked and conflicting duplicates', () => {
        const trackedEvent = {
            uid: 'tracked-uid',
            dtstart: new Date('2026-03-25T18:00:00.000Z'),
            summary: 'Wildcats vs Tigers',
            location: 'Field 1'
        };
        const conflictingEvent = {
            uid: 'conflict-uid',
            dtstart: new Date('2026-03-26T18:00:00.000Z'),
            summary: 'Wildcats vs Bears',
            location: 'Field 2'
        };
        const importedGame = {
            uid: 'new-game-uid',
            dtstart: new Date('2026-03-27T18:00:00.000Z'),
            summary: 'Wildcats vs Falcons',
            location: 'Field 3'
        };
        const importedPractice = {
            uid: 'new-practice-uid',
            dtstart: new Date('2026-03-28T17:30:00.000Z'),
            summary: 'Team Practice',
            location: 'Gym'
        };

        const merged = mergeCalendarImportEvents({
            calendarEvents: [trackedEvent, conflictingEvent, importedGame, importedPractice],
            dbEvents: [
                {
                    id: 'db-game-1',
                    date: { toDate: () => new Date('2026-03-26T18:00:00.000Z') }
                }
            ],
            trackedUids: ['tracked-uid'],
            currentTeamName: 'Wildcats',
            isTrackedCalendarEvent: (event, trackedIds) => trackedIds.includes(event.uid),
            getCalendarEventStatus: () => 'confirmed',
            isPracticeEvent: (summary) => /practice/i.test(summary),
            extractOpponent: (summary, teamName) => summary.replace(`${teamName} vs `, '')
        });

        expect(merged).toHaveLength(2);
        expect(merged).toEqual([
            expect.objectContaining({
                source: 'calendar',
                eventType: 'game',
                isPractice: false,
                opponent: 'Falcons',
                location: 'Field 3',
                calendarEvent: importedGame
            }),
            expect.objectContaining({
                source: 'calendar',
                eventType: 'practice',
                isPractice: true,
                opponent: 'Team Practice',
                location: 'Gym',
                calendarEvent: importedPractice
            })
        ]);
    });

    it('preserves parser-provided practice classification for cancelled imported rows', () => {
        const importedCancelledPractice = {
            uid: 'cancelled-practice-uid',
            dtstart: new Date('2026-03-29T17:30:00.000Z'),
            summary: '[CANCELED] Team Session',
            location: 'Gym',
            isPractice: true
        };

        const merged = mergeCalendarImportEvents({
            calendarEvents: [importedCancelledPractice],
            dbEvents: [],
            trackedUids: [],
            currentTeamName: 'Wildcats',
            isTrackedCalendarEvent: () => false,
            getCalendarEventStatus: () => 'cancelled',
            isPracticeEvent: () => false,
            extractOpponent: (summary) => summary
        });

        expect(merged).toEqual([
            expect.objectContaining({
                eventType: 'practice',
                isPractice: true,
                isCancelled: true,
                opponent: 'Team Session'
            })
        ]);
    });
});

describe('edit schedule calendar import wiring', () => {
    it('routes add-calendar validation and schedule merge through the shared helper', () => {
        const source = readEditSchedule();

        expect(source).toContain("import { mergeCalendarImportEvents, validateCalendarImportUrl } from './js/edit-schedule-calendar-import.js?v=1';");
        expect(source).toContain("const validation = validateCalendarImportUrl(document.getElementById('calendar-url-input').value);");
        expect(source).toContain('allEvents.push(...mergeCalendarImportEvents({');
    });

    it('keeps calendar game and practice actions visible in the schedule renderer', () => {
        const source = readEditSchedule();

        expect(source).toContain('Plan Practice');
        expect(source).toContain('window.trackCalendarEvent');
    });
});
