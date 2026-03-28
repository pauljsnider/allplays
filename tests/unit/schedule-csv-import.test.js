import { describe, expect, it } from 'vitest';
import {
    buildScheduleImportPreview,
    inferScheduleCsvMapping,
    parseCsvText,
    validateScheduleCsvMapping
} from '../../js/schedule-csv-import.js';

describe('schedule CSV import helpers', () => {
    it('parses quoted CSV rows and infers common schedule headers', () => {
        const parsed = parseCsvText([
            'Event Type,Date,Start Time,End Time,Opponent,Location,Notes',
            'Game,4/2/2026,6:30 PM,8:00 PM,"Tigers, Blue","Field 1","Bring white kit"'
        ].join('\n'));

        expect(parsed.headers).toEqual([
            'Event Type',
            'Date',
            'Start Time',
            'End Time',
            'Opponent',
            'Location',
            'Notes'
        ]);
        expect(parsed.rows[0].Opponent).toBe('Tigers, Blue');

        expect(inferScheduleCsvMapping(parsed.headers)).toMatchObject({
            eventType: 'Event Type',
            date: 'Date',
            startTime: 'Start Time',
            endTime: 'End Time',
            opponent: 'Opponent',
            location: 'Location',
            notes: 'Notes'
        });
    });

    it('builds deterministic preview rows for both games and practices', () => {
        const parsed = parseCsvText([
            'Type,Date,Start,End,Opponent,Title,Location,Arrival,Home/Away,Notes',
            'Game,4/2/2026,6:30 PM,8:00 PM,Tigers,,Field 1,5:45 PM,Away,Bring white kit',
            'Practice,4/4/2026,7:00 AM,8:30 AM,,Speed Session,Field 2,6:45 AM,,Bring water'
        ].join('\n'));

        const preview = buildScheduleImportPreview({
            rows: parsed.rows,
            mapping: {
                eventType: 'Type',
                date: 'Date',
                startTime: 'Start',
                endTime: 'End',
                opponent: 'Opponent',
                title: 'Title',
                location: 'Location',
                arrivalTime: 'Arrival',
                isHome: 'Home/Away',
                notes: 'Notes'
            }
        });

        expect(preview.errors).toEqual([]);
        expect(preview.rows).toHaveLength(2);
        expect(preview.rows[0].normalized).toMatchObject({
            eventType: 'game',
            startsAt: '2026-04-02T18:30',
            endsAt: '2026-04-02T20:00',
            opponent: 'Tigers',
            location: 'Field 1',
            arrivalTime: '2026-04-02T17:45',
            isHome: false,
            notes: 'Bring white kit'
        });
        expect(preview.rows[1].normalized).toMatchObject({
            eventType: 'practice',
            startsAt: '2026-04-04T07:00',
            endsAt: '2026-04-04T08:30',
            title: 'Speed Session',
            location: 'Field 2',
            arrivalTime: '2026-04-04T06:45',
            notes: 'Bring water'
        });
    });

    it('flags missing mapping requirements and invalid game rows before import', () => {
        expect(validateScheduleCsvMapping({
            eventType: 'Type',
            opponent: 'Opponent'
        })).toEqual([
            'Map either Start Date & Time or both Date and Start Time before previewing.'
        ]);

        const parsed = parseCsvText([
            'Type,Date,Start,Opponent',
            'Game,4/2/2026,not-a-time,',
            'Practice,4/4/2026,7:00 AM,'
        ].join('\n'));

        const preview = buildScheduleImportPreview({
            rows: parsed.rows,
            mapping: {
                eventType: 'Type',
                date: 'Date',
                startTime: 'Start',
                opponent: 'Opponent'
            }
        });

        expect(preview.rows[0].errors).toContain('Start time is invalid.');
        expect(preview.rows[0].errors).toContain('Game rows require an opponent.');
        expect(preview.rows[1].errors).toEqual([]);
    });
});
