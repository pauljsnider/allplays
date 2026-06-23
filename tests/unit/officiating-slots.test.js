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

function readFunctionsSource() {
    return readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
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
        expect(source).toContain('submittedResult: parseStoredOfficiatingResult(row.dataset.submittedResult || \'\')');
        expect(source).toContain("row.dataset.submittedResult = slot.submittedResult ? JSON.stringify(slot.submittedResult) : '';");
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

    it('loads assigned official games even when private team details are unavailable', () => {
        const officialsSource = readOfficialsPage();

        expect(officialsSource).toContain('My Assignments');
        expect(officialsSource).not.toContain('[currentTeam, currentUserProfile] = await Promise.all');
        expect(officialsSource).toContain("console.warn('[officials] Team details are unavailable; continuing with assignment-only access.', error);");
        expect(officialsSource).toContain('canClaimOpenSlots = false;');
        expect(officialsSource).toContain('await refresh();');
    });

    it('adds quick final score submission and submitted-result state to accepted official assignments', () => {
        const officialsSource = readOfficialsPage();
        const dbSource = readDbSource();

        expect(officialsSource).toContain('submitOfficiatingAssignmentResult');
        expect(officialsSource).toContain('hasSubmittedOfficiatingResult');
        expect(officialsSource).toContain('validateOfficiatingResultSubmission');
        expect(officialsSource).toContain('official-result-form');
        expect(officialsSource).toContain('Quick final score');
        expect(officialsSource).toContain('Result submitted');
        expect(officialsSource).toContain("slot.status !== 'accepted' || !hasGameStarted(game) || isCancelled(game)");
        expect(officialsSource).toContain("document.getElementById('officials-status').textContent = 'Result saved.';");
        expect(officialsSource).toContain("'./js/db.js?v=66'");
        expect(officialsSource).not.toContain("'./js/db.js?v=42'");
        expect(officialsSource).not.toContain("'./js/db.js?v=64'");
        expect(dbSource).toContain('export async function submitOfficiatingAssignmentResult(teamId, gameId, slotId, result, official = auth.currentUser)');
        expect(dbSource).toContain("throw new Error('Cancelled games cannot accept final results.');");
        expect(dbSource).toContain('homeScore: submittedResult.homeScore');
        expect(dbSource).toContain('awayScore: submittedResult.awayScore');
        expect(dbSource).toContain("status: 'completed'");
        expect(dbSource).toContain("liveStatus: 'completed'");
        expect(dbSource).toContain("scoreUpdatedBy: submittedResult.submittedByUserId || String(official?.uid || '').trim() || null");
        const rules = readFirestoreRules();
        expect(rules).toContain("'homeScore'");
        expect(rules).toContain("'awayScore'");
        expect(rules).toContain("'status'");
        expect(rules).toContain("'liveStatus'");
        expect(rules).toContain("'scoreUpdatedBy'");
        expect(rules).toMatch(/function isOfficialGameUpdate\(\) \{[\s\S]*'homeScore',[\s\S]*'awayScore',[\s\S]*'status',[\s\S]*'liveStatus',[\s\S]*'officiatingSlots',[\s\S]*'officiatingCoverageStatus',[\s\S]*'officiatingUpdatedAt',[\s\S]*'scoreUpdatedAt',[\s\S]*'scoreUpdatedBy'[\s\S]*\}/);
    });

    it('limits open self-assignment slot claims to eligible team participants', () => {
        const officialsSource = readOfficialsPage();
        const dbSource = readDbSource();
        const rules = readFirestoreRules();
        const functionsSource = readFunctionsSource();

        expect(officialsSource).toContain('canClaimOpenSlots = isEligibleOpenSlotParticipant(currentUser, currentUserProfile, currentTeam);');
        expect(officialsSource).toContain("section.classList.add('hidden');");
        expect(officialsSource).toContain("section.classList.remove('hidden');");
        expect(officialsSource).toContain("container.innerHTML = '';");
        expect(officialsSource).toContain('find open officiating slots');
        expect(officialsSource).not.toContain('Open self-assignment slots are only available to team owners, admins, or parents.');
        expect(dbSource).toContain('function isEligibleOpenOfficiatingSlotParticipant(team = {}, userProfile = {}, user = {})');
        expect(dbSource).toContain("throw new Error('Only team owners, admins, or parents can claim open officiating slots.');");
        expect(dbSource).toContain("const callable = httpsCallable(functions, 'claimOpenOfficiatingSlot');");
        expect(dbSource).toContain("displayName: official?.displayName || official?.email || 'Official'");
        expect(dbSource).not.toContain('const officiatingSlots = claimOfficiatingSlot(game.officiatingSlots || [], slotId, {');
        expect(functionsSource).toContain('exports.claimOpenOfficiatingSlot = functions.https.onCall');
        expect(functionsSource).toContain('isEligibleOpenOfficiatingSlotParticipant({ team, user, uid, email: callerEmail, teamId: input.teamId })');
        expect(functionsSource).toContain('const gameRef = firestore.doc(resolveOfficiatingGamePath(input.teamId, input.gameId));');
        expect(functionsSource).toContain('!gameRef.path.startsWith(`teams/${input.teamId}/games/`) && !isTeamLinkedToSharedGame(game, input.teamId)');
        expect(functionsSource).toContain('buildOpenOfficiatingSlotClaimUpdate({');
        expect(functionsSource).toContain('buildOfficiatingSelfAssignmentNotificationRecord({');
        expect(functionsSource).toContain('transaction.set(notificationRef, {');
        expect(rules).not.toContain('playerTeamIds');
        expect(rules).not.toContain('function isOpenOfficiatingSelfAssignmentUpdate(teamId)');
        expect(rules).not.toContain('allow update: if isOpenOfficiatingSelfAssignmentUpdate(teamId);');
    });
});
