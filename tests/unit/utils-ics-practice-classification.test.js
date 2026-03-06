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
});
