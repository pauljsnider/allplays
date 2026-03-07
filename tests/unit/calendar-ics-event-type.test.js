import { describe, it, expect } from 'vitest';
import { getCalendarEventType, getCalendarEventStatus } from '../../js/utils.js';

describe('getCalendarEventType', () => {
    it('classifies ICS practice events from summary when isPractice is missing', () => {
        const type = getCalendarEventType({ summary: 'U12 Practice' });
        expect(type).toBe('practice');
    });

    it('keeps explicit isPractice false as game', () => {
        const type = getCalendarEventType({ summary: 'U12 Practice', isPractice: false });
        expect(type).toBe('game');
    });

    it('classifies non-practice summaries as game', () => {
        const type = getCalendarEventType({ summary: 'U12 vs Lions' });
        expect(type).toBe('game');
    });
});

describe('getCalendarEventStatus', () => {
    it('maps ICS STATUS:CANCELLED to cancelled', () => {
        const status = getCalendarEventStatus({ status: 'CANCELLED', summary: 'U12 vs Lions' });
        expect(status).toBe('cancelled');
    });

    it('maps ICS STATUS:CANCELED to cancelled', () => {
        const status = getCalendarEventStatus({ status: 'CANCELED', summary: 'U12 vs Lions' });
        expect(status).toBe('cancelled');
    });

    it('maps TeamSnap [CANCELED] summary to cancelled', () => {
        const status = getCalendarEventStatus({ summary: '[CANCELED] U12 Practice' });
        expect(status).toBe('cancelled');
    });

    it('maps [cancelled] summary variants case-insensitively to cancelled', () => {
        const status = getCalendarEventStatus({ summary: '[cancelled] U12 Practice' });
        expect(status).toBe('cancelled');
    });

    it('keeps non-cancelled ICS events scheduled', () => {
        const status = getCalendarEventStatus({ status: 'CONFIRMED', summary: 'U12 vs Lions' });
        expect(status).toBe('scheduled');
    });
});
