import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getBulkOperationEventType, normalizeBulkPracticeForAdd } from '../../js/edit-schedule-ai-import.js';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

describe('getBulkOperationEventType', () => {
    it('defaults to game when eventType is missing or unknown', () => {
        expect(getBulkOperationEventType({})).toBe('game');
        expect(getBulkOperationEventType({ eventType: 'scrimmage' })).toBe('game');
        expect(getBulkOperationEventType(null)).toBe('game');
    });

    it('recognizes practice case-insensitively', () => {
        expect(getBulkOperationEventType({ eventType: 'practice' })).toBe('practice');
        expect(getBulkOperationEventType({ eventType: '  Practice ' })).toBe('practice');
    });
});

describe('normalizeBulkPracticeForAdd', () => {
    it('maps the Overland Trail practice regression case to a practice payload', () => {
        const practice = normalizeBulkPracticeForAdd({
            date: '2026-07-13T18:00:00',
            location: 'Overland Trail Elementary'
        });

        expect(practice.type).toBe('practice');
        expect(practice.title).toBe('Practice');
        expect(practice.location).toBe('Overland Trail Elementary');
        expect(new Date(practice.date).toISOString()).toBe(new Date('2026-07-13T18:00:00').toISOString());
        // Falls back to a default end after the start when none supplied.
        expect(new Date(practice.end).getTime()).toBeGreaterThan(new Date(practice.date).getTime());
    });

    it('honors an explicit endTime when it is after the start', () => {
        const practice = normalizeBulkPracticeForAdd({
            date: '2026-07-13T18:00:00',
            endTime: '2026-07-13T19:30:00',
            location: 'Gym'
        });
        expect(new Date(practice.end).toISOString()).toBe(new Date('2026-07-13T19:30:00').toISOString());
    });

    it('throws on an invalid date', () => {
        expect(() => normalizeBulkPracticeForAdd({ location: 'Gym' })).toThrow();
    });
});

describe('edit-schedule bulk AI practice wiring', () => {
    it('imports the AI import helpers and describes practices in the prompt and schema', () => {
        const source = readEditSchedule();
        expect(source).toContain("import { getBulkOperationEventType, normalizeBulkPracticeForAdd } from './js/edit-schedule-ai-import.js");
        expect(source).toContain('eventType: Schema.string()');
        expect(source).toContain('extract both GAMES and PRACTICES');
        expect(source).toContain('normalizeBulkPracticeForAdd(op.game)');
        expect(source).toContain('addPractice(currentTeamId');
    });
});
