import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { savePracticeForm } from '../../js/edit-schedule-practice-submit.js';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

function createLocalDate(year, monthIndex, day, hours, minutes) {
    return new Date(year, monthIndex, day, hours, minutes, 0, 0);
}

describe('edit schedule practice save flow', () => {
    it('persists recurring practice creation through addPractice with a series payload', async () => {
        const addPractice = vi.fn().mockResolvedValue('practice-new');
        const updateEvent = vi.fn();
        const startDate = createLocalDate(2026, 2, 16, 17, 0);
        const endDate = createLocalDate(2026, 2, 16, 18, 30);
        const Timestamp = {
            fromDate: (value) => ({
                iso: value.toISOString()
            })
        };

        const result = await savePracticeForm({
            teamId: 'team-1',
            editingPracticeId: null,
            editingSeriesId: null,
            formState: {
                title: 'Recurring Practice',
                startDate,
                endDate,
                location: 'Main Gym',
                notes: 'Ball movement',
                scheduleNotifications: {
                    enabled: true,
                    lastAction: 'created'
                }
            },
            recurrenceState: {
                isRecurring: true,
                freq: 'weekly',
                interval: 2,
                byDays: ['MO', 'WE'],
                endType: 'until',
                untilValue: '2026-04-01',
                countValue: ''
            },
            Timestamp,
            deleteField: () => Symbol('deleteField'),
            generateSeriesId: () => 'series-generated',
            addPractice,
            updateEvent
        });

        expect(updateEvent).not.toHaveBeenCalled();
        expect(addPractice).toHaveBeenCalledWith('team-1', {
            title: 'Recurring Practice',
            date: { iso: startDate.toISOString() },
            end: { iso: endDate.toISOString() },
            location: 'Main Gym',
            notes: 'Ball movement',
            scheduleNotifications: {
                enabled: true,
                lastAction: 'created'
            },
            isSeriesMaster: true,
            seriesId: 'series-generated',
            startTime: '17:00',
            endTime: '18:30',
            endDayOffset: 0,
            recurrence: {
                freq: 'weekly',
                interval: 2,
                byDays: ['MO', 'WE'],
                until: { iso: '2026-04-01T00:00:00.000Z' }
            },
            exDates: [],
            overrides: {}
        });
        expect(result).toEqual({
            practiceData: addPractice.mock.calls[0][1],
            savedPracticeId: 'practice-new'
        });
    });

    it('persists recurring practice edits through updateEvent and preserves the existing series id', async () => {
        const addPractice = vi.fn();
        const updateEvent = vi.fn().mockResolvedValue(undefined);
        const startDate = createLocalDate(2026, 2, 18, 17, 15);
        const endDate = createLocalDate(2026, 2, 18, 18, 45);
        const Timestamp = {
            fromDate: (value) => ({
                iso: value.toISOString()
            })
        };

        const result = await savePracticeForm({
            teamId: 'team-1',
            editingPracticeId: 'practice-123',
            editingSeriesId: 'series-existing',
            formState: {
                title: 'Recurring Practice',
                startDate,
                endDate,
                location: 'Aux Gym',
                notes: 'Update cadence',
                scheduleNotifications: {
                    enabled: true,
                    lastAction: 'updated'
                }
            },
            recurrenceState: {
                isRecurring: true,
                freq: 'weekly',
                interval: 1,
                byDays: ['TU', 'TH'],
                endType: 'count',
                untilValue: '',
                countValue: '6'
            },
            Timestamp,
            deleteField: () => Symbol('deleteField'),
            generateSeriesId: () => 'series-new',
            addPractice,
            updateEvent
        });

        expect(addPractice).not.toHaveBeenCalled();
        expect(updateEvent).toHaveBeenCalledWith('team-1', 'practice-123', {
            title: 'Recurring Practice',
            date: { iso: startDate.toISOString() },
            end: { iso: endDate.toISOString() },
            location: 'Aux Gym',
            notes: 'Update cadence',
            scheduleNotifications: {
                enabled: true,
                lastAction: 'updated'
            },
            isSeriesMaster: true,
            seriesId: 'series-existing',
            startTime: '17:15',
            endTime: '18:45',
            endDayOffset: 0,
            recurrence: {
                freq: 'weekly',
                interval: 1,
                byDays: ['TU', 'TH'],
                count: 6
            }
        });
        expect(result).toEqual({
            practiceData: updateEvent.mock.calls[0][2],
            savedPracticeId: 'practice-123'
        });
    });

    it('wires the practice submit flow through the shared save helper', () => {
        const source = readEditSchedule();

        expect(source).toContain("import { savePracticeForm } from './js/edit-schedule-practice-submit.js?v=1';");
        expect(source).toContain('const { savedPracticeId } = await savePracticeForm({');
        expect(source).toContain('applyPracticeRecurrenceFields');
    });

    it('does not save isSeriesMaster or recurrence when editing a non-recurring practice', async () => {
        // Regression test for issue #2201: editing a non-recurring practice after a recurring one
        // would carry over the stale recurring checkbox state and accidentally persist recurrence fields.
        const addPractice = vi.fn();
        const updateEvent = vi.fn().mockResolvedValue(undefined);
        const deletedFields = [];
        const deleteField = () => {
            const sentinel = Symbol('deleteField');
            deletedFields.push(sentinel);
            return sentinel;
        };
        const startDate = createLocalDate(2026, 3, 10, 9, 0);
        const endDate = createLocalDate(2026, 3, 10, 10, 0);
        const Timestamp = {
            fromDate: (value) => ({ iso: value.toISOString() })
        };

        // Simulate the form state as it would be after a user previously edited a recurring
        // practice and left the recurring checkbox checked, then opens a non-recurring practice.
        // The form code should supply isRecurring: false derived from the practice's own data.
        const result = await savePracticeForm({
            teamId: 'team-1',
            editingPracticeId: 'practice-nonrecurring',
            editingSeriesId: null,
            formState: {
                title: 'One-Off Practice',
                startDate,
                endDate,
                location: 'Field A',
                notes: '',
                scheduleNotifications: { enabled: false }
            },
            recurrenceState: {
                isRecurring: false,
                freq: 'weekly',
                interval: 1,
                byDays: ['MO'],
                endType: 'never',
                untilValue: '',
                countValue: '10'
            },
            Timestamp,
            deleteField,
            generateSeriesId: () => 'should-not-be-called',
            addPractice,
            updateEvent
        });

        expect(addPractice).not.toHaveBeenCalled();
        const savedPayload = updateEvent.mock.calls[0][2];

        // Recurrence fields must be wiped (set to deleteField()) — not persisted as true
        expect(savedPayload.isSeriesMaster).not.toBe(true);
        expect(savedPayload.recurrence).not.toMatchObject({ freq: expect.any(String) });

        // The deleteField sentinel must have been applied (recurrence fields cleared)
        expect(deletedFields.length).toBeGreaterThan(0);

        expect(result.savedPracticeId).toBe('practice-nonrecurring');
    });

    it('resets recurring checkbox and builder when startEditPractice loads a non-recurring practice', () => {
        const source = readEditSchedule();

        // The else branch that resets recurring state must exist in startEditPractice
        expect(source).toContain("practiceRecurring').checked = false");
        expect(source).toContain("recurrence-builder').classList.add('hidden')");
    });
});
