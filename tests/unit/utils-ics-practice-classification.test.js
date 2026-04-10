import { describe, it, expect } from 'vitest';
import { parseICS } from '../../js/utils.js';

describe('parseICS practice classification', () => {
    it('sets isPractice for practice and training summaries', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:practice-1',
            'DTSTART:20260227T180000Z',
            'SUMMARY:Evening Practice',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'UID:training-1',
            'DTSTART:20260228T180000Z',
            'SUMMARY:Speed Training Session',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'UID:game-1',
            'DTSTART:20260301T180000Z',
            'SUMMARY:Tigers vs Lions',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);
        expect(events).toHaveLength(3);
        expect(events[0].isPractice).toBe(true);
        expect(events[1].isPractice).toBe(true);
        expect(events[2].isPractice).toBe(false);
    });

    it('preserves cancelled event fields needed by the calendar import UI', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:cancelled-game-1',
            'DTSTART:20260305T180000Z',
            'SUMMARY:Wildcats vs Tigers',
            'STATUS:CANCELLED',
            'LOCATION:Field 1',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'UID:cancelled-practice-1',
            'DTSTART:20260306T173000Z',
            'SUMMARY:[CANCELED] Team Practice',
            'LOCATION:Main Gym',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);

        expect(events).toHaveLength(2);
        expect(events[0]).toEqual(expect.objectContaining({
            uid: 'cancelled-game-1',
            summary: 'Wildcats vs Tigers',
            status: 'CANCELLED',
            location: 'Field 1',
            isPractice: false
        }));
        expect(events[0].dtstart).toBeInstanceOf(Date);
        expect(events[1]).toEqual(expect.objectContaining({
            uid: 'cancelled-practice-1',
            summary: '[CANCELED] Team Practice',
            location: 'Main Gym',
            isPractice: true
        }));
        expect(events[1].dtstart).toBeInstanceOf(Date);
    });
});
