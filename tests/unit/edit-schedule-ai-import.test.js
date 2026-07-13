import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    buildBulkAiPracticePayload,
    normalizeBulkAiEventForAdd
} from '../../js/edit-schedule-ai-import.js';

describe('edit schedule bulk AI import', () => {
    const Timestamp = {
        fromDate: (value) => value
    };

    function defaultEndTime(startDate) {
        return new Date(startDate.getTime() + 90 * 60 * 1000);
    }

    it('normalizes practice add operations without requiring an opponent', () => {
        const normalized = normalizeBulkAiEventForAdd({
            eventType: 'practice',
            date: '2026-07-13T18:00:00',
            title: 'Practice',
            location: ' Overland Trail Elementary ',
            notes: ' Bring water '
        });

        expect(normalized).toMatchObject({
            eventType: 'practice',
            title: 'Practice',
            opponent: null,
            location: 'Overland Trail Elementary',
            notes: 'Bring water',
            status: 'scheduled'
        });
    });

    it('builds a practice payload for the issue 3860 fixture', () => {
        const payload = buildBulkAiPracticePayload({
            eventType: 'practice',
            date: '2026-07-13T18:00:00',
            title: 'Practice',
            location: 'Overland Trail Elementary',
            assignments: [
                { role: ' Snack ', value: ' Coach Taylor ' },
                { role: 'Carpool', value: 'Jordan family' }
            ]
        }, {
            Timestamp,
            getDefaultEndTime: defaultEndTime,
            userId: 'coach-1'
        });

        expect(payload.title).toBe('Practice');
        expect(payload.location).toBe('Overland Trail Elementary');
        expect(payload.date).toEqual(new Date('2026-07-13T18:00:00'));
        expect(payload.end).toEqual(new Date('2026-07-13T19:30:00'));
        expect(payload.assignments).toEqual([
            { role: 'Snack', value: 'Coach Taylor' },
            { role: 'Carpool', value: 'Jordan family' }
        ]);
        expect(payload.source).toBe('bulk_ai');
        expect(payload.sourceMetadata).toEqual({
            importedBy: 'coach-1',
            importedFrom: 'edit-schedule-bulk-ai'
        });
    });

    it('preserves game add behavior while adding eventType', () => {
        const normalized = normalizeBulkAiEventForAdd({
            eventType: 'game',
            date: '2026-04-02T18:30:00',
            opponent: ' Tigers ',
            location: ' Main Field ',
            isHome: 'away',
            assignments: [{ role: 'Snack', value: 'Sam' }]
        });

        expect(normalized).toMatchObject({
            eventType: 'game',
            opponent: 'Tigers',
            location: 'Main Field',
            isHome: false,
            kitColor: 'Away kit',
            assignments: [{ role: 'Snack', value: 'Sam' }],
            homeScore: 0,
            awayScore: 0
        });
    });

    it('rejects game add operations without an opponent', () => {
        expect(() => normalizeBulkAiEventForAdd({
            eventType: 'game',
            date: '2026-04-02T18:30:00',
            location: 'Main Field'
        })).toThrow('Game opponent is required.');

        expect(() => normalizeBulkAiEventForAdd({
            eventType: 'game',
            date: '2026-04-02T18:30:00',
            opponent: '   ',
            location: 'Main Field'
        })).toThrow('Game opponent is required.');
    });

    it('rejects practice end times that are invalid or not after the start', () => {
        const dependencies = {
            Timestamp,
            getDefaultEndTime: defaultEndTime
        };

        expect(() => buildBulkAiPracticePayload({
            eventType: 'practice',
            date: '2026-07-13T18:00:00',
            endTime: 'not-a-date'
        }, dependencies)).toThrow('Practice end time must be a valid date.');

        expect(() => buildBulkAiPracticePayload({
            eventType: 'practice',
            date: '2026-07-13T18:00:00',
            endTime: '2026-07-13T17:59:00'
        }, dependencies)).toThrow('Practice end time must be after the start time.');
    });

    it('rejects an invalid optional practice arrival time', () => {
        expect(() => buildBulkAiPracticePayload({
            eventType: 'practice',
            date: '2026-07-13T18:00:00',
            arrivalTime: 'not-a-date'
        }, {
            Timestamp,
            getDefaultEndTime: defaultEndTime
        })).toThrow('Practice arrival time must be a valid date.');
    });

    it('keeps practice rules in the inline AI prompt and response schema', () => {
        const source = readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');

        expect(source).toContain('eventType: Schema.string()');
        expect(source).toContain('Practice", "Training", or practice-style scrimmage have no opponent');
        expect(source).toContain('If a game opponent cannot be extracted, do not emit an add operation for that game.');
        expect(source).toContain('"eventType": "practice"');
        expect(source).toContain('buildBulkAiPracticePayload(normalizedGame');
        expect(source).toContain('await addPractice(currentTeamId, practiceData);');
        expect(source).toContain("from './js/edit-schedule-ai-import.js?v=2';");
    });
});
