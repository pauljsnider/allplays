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

function readOfficialsPage() {
    return readFileSync(new URL('../../officials.html', import.meta.url), 'utf8');
}

function readDbSource() {
    return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

function readFirestoreRules() {
    return readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
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
        expect(source).toContain('createOfficiatingAssignmentNotificationRecords');
        expect(source).toContain('buildOfficiatingAssignmentNotificationRecords');
        expect(source).toContain('await createScheduleOfficiatingNotificationRecords({');
        expect(source).toContain('confirmOfficiatingAssignmentConflicts(gameData)');
        expect(source).toContain('Officiating assignment conflict warning:');
        expect(source).toContain('${renderOfficiatingSummary(game.officiatingSlots)}');
        expect(source).toContain('assignments: getAssignmentsFromForm()');
    });

    it('surfaces rescheduled officiating assignments to assigners and officials', () => {
        const editSource = readEditSchedule();
        const officialsSource = readOfficialsPage();

        expect(editSource).toContain('flagRescheduledOfficiatingSlots(previousGame, gameData)');
        expect(editSource).toContain('Rescheduled, needs review');
        expect(editSource).toContain('Needs review');
        expect(officialsSource).toContain('Game rescheduled, please review');
        expect(officialsSource).toContain("['pending', 'needs_review'].includes(slot.status)");
    });

    it('allows signed-in officials to claim open self-assignment slots through Firestore rules', () => {
        const dbSource = readDbSource();
        const rules = readFirestoreRules();

        expect(dbSource).toContain('export async function claimOpenOfficiatingSlot(teamId, gameId, slotId, official = auth.currentUser)');
        expect(dbSource).toContain('officiatingAuthorizedUserIds: Array.from(officiatingAuthorizedUserIds)');
        expect(dbSource).toContain('officiatingAuthorizedEmails: Array.from(officiatingAuthorizedEmails)');
        expect(rules).toContain('function isOpenOfficiatingSelfAssignmentUpdate()');
        expect(rules).toContain("resource.data.get('officiatingSelfAssignmentEnabled', false) == true");
        expect(rules).toContain("'officiatingAuthorizedUserIds'");
        expect(rules).toContain('allow update: if isOpenOfficiatingSelfAssignmentUpdate();');
    });
});
