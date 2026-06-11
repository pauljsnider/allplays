// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { autoAssignRosterMatches, countRosterMatches, sanitizeTrackStatsheetRow } from './trackStatsheetService';

const roster = [
    { id: 'p1', name: 'Avery Smith', number: '12' },
    { id: 'p2', name: 'Jordan Lee', number: '4' }
];

describe('trackStatsheetService', () => {
    it('auto-assigns unique roster matches by number before falling back to names', () => {
        const rows = autoAssignRosterMatches([
            sanitizeTrackStatsheetRow({ number: '12', name: 'Wrong Name', totalPoints: 8, fouls: 2 }),
            sanitizeTrackStatsheetRow({ number: '', name: 'Jordan Lee', totalPoints: 6, fouls: 1 }),
            sanitizeTrackStatsheetRow({ number: '12', name: 'Avery Smith', totalPoints: 3, fouls: 0 })
        ], roster);

        expect(rows[0].mappedPlayerId).toBe('p1');
        expect(rows[1].mappedPlayerId).toBe('p2');
        expect(rows[2].mappedPlayerId).toBe('');
    });

    it('counts only confident unique roster matches for swap detection', () => {
        const matches = countRosterMatches([
            sanitizeTrackStatsheetRow({ number: '12', name: 'Avery Smith' }),
            sanitizeTrackStatsheetRow({ number: '4', name: 'Jordan Lee' }),
            sanitizeTrackStatsheetRow({ number: '12', name: 'Duplicate Avery' })
        ], roster);

        expect(matches).toBe(2);
    });

    it('sanitizes partial AI rows into bounded review rows', () => {
        expect(sanitizeTrackStatsheetRow({
            number: ' 12 ',
            name: ' Avery Smith ',
            fouls: 8,
            firstHalfPoints: '5',
            secondHalfPoints: '4',
            otPoints: '1'
        })).toEqual({
            number: '12',
            name: 'Avery Smith',
            fouls: 5,
            totalPoints: 10,
            include: true,
            mappedPlayerId: ''
        });
    });
});
