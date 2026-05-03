import { describe, expect, it } from 'vitest';
import {
    buildAvailabilityNoteRows,
    canViewAvailabilityNotes,
    formatAvailabilityCutoff,
    isAvailabilityLocked,
    normalizeAvailabilityPreferences
} from '../../js/availability-preferences.js';

describe('availability preferences', () => {
    it('normalizes cutoff and note visibility defaults', () => {
        expect(normalizeAvailabilityPreferences({})).toEqual({
            cutoffMinutesBeforeStart: 0,
            noteVisibility: 'admins'
        });
        expect(normalizeAvailabilityPreferences({ cutoffMinutesBeforeStart: 89.6, noteVisibility: 'team' })).toEqual({
            cutoffMinutesBeforeStart: 90,
            noteVisibility: 'team'
        });
    });

    it('locks availability once the configured cutoff window has started', () => {
        const preferences = { cutoffMinutesBeforeStart: 120 };
        const eventDate = new Date('2026-05-01T18:00:00Z');

        expect(isAvailabilityLocked(eventDate, preferences, new Date('2026-05-01T15:59:00Z'))).toBe(false);
        expect(isAvailabilityLocked(eventDate, preferences, new Date('2026-05-01T16:00:00Z'))).toBe(true);
    });

    it('respects note visibility for admins and team members', () => {
        const rows = [
            { displayName: 'Alex Parent', response: 'going', note: 'Arriving late' },
            { displayName: 'Blake Parent', response: 'maybe', note: '' }
        ];

        expect(canViewAvailabilityNotes({ noteVisibility: 'admins' }, false)).toBe(false);
        expect(buildAvailabilityNoteRows(rows, { noteVisibility: 'admins' }, false)).toEqual([]);
        expect(buildAvailabilityNoteRows(rows, { noteVisibility: 'admins' }, true)).toEqual([
            { displayName: 'Alex Parent', response: 'going', note: 'Arriving late' }
        ]);
        expect(buildAvailabilityNoteRows(rows, { noteVisibility: 'team' }, false)).toHaveLength(1);
    });

    it('formats cutoff windows for UI copy', () => {
        expect(formatAvailabilityCutoff({ cutoffMinutesBeforeStart: 0 })).toBe('No cutoff');
        expect(formatAvailabilityCutoff({ cutoffMinutesBeforeStart: 60 })).toBe('1 hour before start');
        expect(formatAvailabilityCutoff({ cutoffMinutesBeforeStart: 2880 })).toBe('2 days before start');
    });
});
