import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyPracticeRecurrenceFields } from '../../js/edit-schedule-practice-payload.js';

describe('edit schedule practice recurrence payload', () => {
    it('clears recurrence-only fields when editing a series into a one-time practice', () => {
        const deleteSentinel = Symbol('deleteField');
        const practiceData = {
            title: 'Practice'
        };

        const result = applyPracticeRecurrenceFields({
            practiceData,
            isRecurring: false,
            editingPracticeId: 'practice-1',
            startDate: new Date('2026-03-16T17:00:00.000Z'),
            endDate: new Date('2026-03-16T18:30:00.000Z'),
            Timestamp: { fromDate: (value) => value },
            deleteField: () => deleteSentinel,
            generateSeriesId: () => 'series-new'
        });

        expect(result).toMatchObject({
            title: 'Practice'
        });
        expect(result.isSeriesMaster).toBe(deleteSentinel);
        expect(result.recurrence).toBe(deleteSentinel);
        expect(result.seriesId).toBe(deleteSentinel);
        expect(result.startTime).toBe(deleteSentinel);
        expect(result.endTime).toBe(deleteSentinel);
        expect(result.exDates).toBe(deleteSentinel);
        expect(result.overrides).toBe(deleteSentinel);
    });

    it('preserves recurring series metadata when recurrence remains enabled', () => {
        const practiceData = {
            title: 'Practice'
        };

        const result = applyPracticeRecurrenceFields({
            practiceData,
            isRecurring: true,
            editingPracticeId: 'practice-1',
            editingSeriesId: 'series-existing',
            recurrenceConfig: {
                freq: 'weekly',
                interval: 2,
                byDays: ['MO', 'WE'],
                endType: 'count',
                countValue: '8'
            },
            startDate: new Date('2026-03-16T17:00:00.000Z'),
            endDate: new Date('2026-03-16T18:30:00.000Z'),
            Timestamp: { fromDate: (value) => value },
            deleteField: () => {
                throw new Error('deleteField should not be used for recurring series updates');
            },
            generateSeriesId: () => 'series-new'
        });

        expect(result.isSeriesMaster).toBe(true);
        expect(result.seriesId).toBe('series-existing');
        expect(result.startTime).toBe('17:00');
        expect(result.endTime).toBe('18:30');
        expect(result.recurrence).toEqual({
            freq: 'weekly',
            interval: 2,
            byDays: ['MO', 'WE'],
            count: 8
        });
    });

    it('wires the practice submit flow through the shared recurrence payload helper', () => {
        const source = readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
        const helperSource = readFileSync(new URL('../../js/edit-schedule-practice-submit.js', import.meta.url), 'utf8');

        expect(source).toContain("import { savePracticeForm } from './js/edit-schedule-practice-submit.js?v=1';");
        expect(helperSource).toContain("import { applyPracticeRecurrenceFields } from './edit-schedule-practice-payload.js';");
        expect(helperSource).toContain('applyPracticeRecurrenceFields({');
        expect(helperSource).toContain('deleteField,');
    });
});
