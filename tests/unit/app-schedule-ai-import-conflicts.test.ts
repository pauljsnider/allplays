import { describe, expect, it } from 'vitest';

import {
    appendScheduleImportConflictErrors,
    normalizeScheduleAiImportResponse
} from '../../apps/app/src/lib/scheduleAiImport';
import { normalizeScheduleImportDraft } from '../../apps/app/src/lib/scheduleCsvImport';

describe('app schedule AI import conflicts', () => {
    const existingPractice = {
        id: 'practice-1',
        type: 'practice' as const,
        date: '2026-08-03T17:30:00',
        title: 'Team practice',
        location: 'Main Gym'
    };

    it('blocks a duplicate practice extracted by AI', () => {
        const result = normalizeScheduleAiImportResponse({
            operations: [{
                action: 'add',
                event: {
                    eventType: 'practice',
                    startsAt: '2026-08-03T17:30:00',
                    title: 'Team practice',
                    location: 'Main Gym'
                }
            }]
        }, {
            teamName: 'Bears',
            currentEvents: [existingPractice]
        });

        expect(result.rows[0].errors).toContain(
            'Possible duplicate/conflict with existing practice Team practice at the same time.'
        );
    });

    it('applies the same practice conflict validation to deterministic CSV rows', () => {
        const row = normalizeScheduleImportDraft({
            eventType: 'practice',
            startsAt: '2026-08-03T17:30:00',
            title: 'Team practice',
            location: 'Main Gym'
        }, { rowNumber: 1 });

        const [validated] = appendScheduleImportConflictErrors([row], [existingPractice]);

        expect(validated.errors).toContain(
            'Possible duplicate/conflict with existing practice Team practice at the same time.'
        );
    });

    it('does not flag a distinct practice at another time and place', () => {
        const row = normalizeScheduleImportDraft({
            eventType: 'practice',
            startsAt: '2026-08-04T19:30:00',
            title: 'Pitching practice',
            location: 'Field 2'
        }, { rowNumber: 1 });

        expect(appendScheduleImportConflictErrors([row], [existingPractice])[0].errors).toEqual([]);
    });
});
