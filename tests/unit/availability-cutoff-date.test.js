import { describe, expect, it } from 'vitest';
import { resolveAvailabilityCutoffEventDate } from '../../js/availability-cutoff-date.js';

describe('resolveAvailabilityCutoffEventDate', () => {
    it('uses an overridden recurring occurrence start time for cutoff checks', () => {
        const eventDate = resolveAvailabilityCutoffEventDate({
            date: new Date('2026-06-10T10:00:00'),
            startTime: '10:00',
            overrides: {
                '2026-06-17': { startTime: '18:00' }
            }
        }, '2026-06-17');

        expect(eventDate).toBeInstanceOf(Date);
        expect(eventDate.getFullYear()).toBe(2026);
        expect(eventDate.getMonth()).toBe(5);
        expect(eventDate.getDate()).toBe(17);
        expect(eventDate.getHours()).toBe(18);
        expect(eventDate.getMinutes()).toBe(0);
    });

    it('falls back to the series start time when the occurrence is not overridden', () => {
        const eventDate = resolveAvailabilityCutoffEventDate({
            date: new Date('2026-06-10T10:00:00'),
            startTime: '10:00',
            overrides: {}
        }, '2026-06-17');

        expect(eventDate.getFullYear()).toBe(2026);
        expect(eventDate.getMonth()).toBe(5);
        expect(eventDate.getDate()).toBe(17);
        expect(eventDate.getHours()).toBe(10);
        expect(eventDate.getMinutes()).toBe(0);
    });
});
