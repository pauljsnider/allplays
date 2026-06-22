import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const teamDrillsServiceSource = readFileSync(new URL('../../apps/app/src/lib/teamDrillsService.ts', import.meta.url), 'utf8');
const teamDrillsServiceTestSource = readFileSync(new URL('../../apps/app/src/lib/teamDrillsService.test.ts', import.meta.url), 'utf8');
const scheduleEventDetailSource = readFileSync(new URL('../../apps/app/src/pages/ScheduleEventDetail.tsx', import.meta.url), 'utf8');
const practiceTimelineServiceTestSource = readFileSync(new URL('../../apps/app/src/lib/practiceTimelineService.test.ts', import.meta.url), 'utf8');
const livePracticeNotesTestSource = readFileSync(new URL('./drills-live-practice-notes.test.js', import.meta.url), 'utf8');
const starterDrillsTestSource = readFileSync(new URL('./practice-starter-drills.test.js', import.meta.url), 'utf8');

describe('issue 1986 drills AI coach source contract', () => {
    it('keeps the practice AI coach prompt grounded in team context and favorite drills', () => {
        expect(teamDrillsServiceSource).toContain('export type PracticeAiCoachPromptInput');
        expect(teamDrillsServiceSource).toContain('export function buildPracticeAiCoachPrompt');
        expect(teamDrillsServiceSource).toContain('You are an assistant coach helping plan');
        expect(teamDrillsServiceSource).toContain('Favorite drills to prefer when they fit:');
        expect(teamDrillsServiceSource).toContain('Create a minute-by-minute practice plan with drill names, setup notes, coaching cues, and an adjustment for fewer players.');
        expect(teamDrillsServiceSource).toContain('.slice(0, 5)');
    });

    it('keeps live practice notes saving into the practice timeline', () => {
        expect(scheduleEventDetailSource).toContain('const saveLiveNote = async () => {');
        expect(scheduleEventDetailSource).toContain('appendPracticeTimelineLiveNoteForApp({');
        expect(scheduleEventDetailSource).toContain('blockIndex: activeDrillIndex');
        expect(scheduleEventDetailSource).toContain("type: 'text'");
        expect(scheduleEventDetailSource).toContain("setStatus({ tone: 'success', message: 'Live practice note saved.' });");
        expect(scheduleEventDetailSource).toContain("setStatus({ tone: 'error', message: error?.message || 'Unable to save the live practice note.' });");
    });

    it('keeps prompt, starter-drill, and live-note regression tests in place', () => {
        expect(teamDrillsServiceTestSource).toContain('builds a practice AI coach prompt from team goals and favorite drills');
        expect(teamDrillsServiceTestSource).toContain('Press after turnovers');
        expect(practiceTimelineServiceTestSource).toContain('appends live notes onto the current block before persisting');
        expect(livePracticeNotesTestSource).toContain('appends live note to notesLog only and preserves authored notes');
        expect(starterDrillsTestSource).toContain('returns sport-filtered starter drills');
        expect(starterDrillsTestSource).toContain('supports starter drill lookup by id');
    });
});
