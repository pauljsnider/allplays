import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    getOfficiatingCoverageState,
    normalizeOfficialsDirectory,
    normalizeOfficiatingSlots
} from '../../js/officiating-slots.js';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

describe('officiating slots', () => {
    it('normalizes officials and fills slot display names from the directory', () => {
        const officials = normalizeOfficialsDirectory([
            { id: 'b', displayName: 'Beth' },
            { id: 'a', name: 'Alex', email: 'alex@example.com' },
            { id: '', name: 'Missing id' }
        ]);

        expect(officials.map((official) => official.name)).toEqual(['Alex', 'Beth']);
        expect(normalizeOfficiatingSlots([
            { position: ' Head Referee ', officialId: 'a' },
            { position: '', officialId: 'b' }
        ], officials)).toEqual([
            { position: 'Head Referee', officialId: 'a', officialName: 'Alex' }
        ]);
    });

    it('reports unstaffed, partially staffed, and fully staffed states', () => {
        expect(getOfficiatingCoverageState([])).toBe('unstaffed');
        expect(getOfficiatingCoverageState([{ position: 'Umpire' }])).toBe('unstaffed');
        expect(getOfficiatingCoverageState([
            { position: 'Head Referee', officialId: 'a' },
            { position: 'Assistant Referee' }
        ])).toBe('partially staffed');
        expect(getOfficiatingCoverageState([
            { position: 'Head Referee', officialId: 'a' },
            { position: 'Assistant Referee', officialId: 'b' }
        ])).toBe('fully staffed');
    });

    it('wires schedule editing to load, render, and persist officiating slots separately from generic assignments', () => {
        const source = readEditSchedule();

        expect(source).toContain('getOfficials');
        expect(source).toContain('Officiating Slots');
        expect(source).toContain('populateOfficiatingSlots(game.officiatingSlots || [])');
        expect(source).toContain('officiatingSlots: getOfficiatingSlotsFromForm()');
        expect(source).toContain('${renderOfficiatingSummary(game.officiatingSlots)}');
        expect(source).toContain('assignments: getAssignmentsFromForm()');
    });
});
