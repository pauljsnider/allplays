import { describe, it, expect } from 'vitest';
import { getCalendarEventType } from '../../js/utils.js';

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
