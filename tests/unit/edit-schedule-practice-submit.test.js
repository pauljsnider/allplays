import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { savePracticeForm } from '../../js/edit-schedule-practice-submit.js';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

describe('edit schedule practice save flow', () => {
    it('persists recurring practice creation through addPractice with a series payload', async () => {
        const addPractice = vi.fn().mockResolvedValue('practice-new');
        const updateEvent = vi.fn();
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
                startDate: new Date('2026-03-16T17:00:00.000Z'),
                endDate: new Date('2026-03-16T18:30:00.000Z'),
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
            date: { iso: '2026-03-16T17:00:00.000Z' },
            end: { iso: '2026-03-16T18:30:00.000Z' },
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
                startDate: new Date('2026-03-18T17:15:00.000Z'),
                endDate: new Date('2026-03-18T18:45:00.000Z'),
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
            date: { iso: '2026-03-18T17:15:00.000Z' },
            end: { iso: '2026-03-18T18:45:00.000Z' },
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
});
