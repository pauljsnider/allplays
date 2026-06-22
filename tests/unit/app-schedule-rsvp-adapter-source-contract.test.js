import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readSource(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

const directLegacyImportPattern = /from\s+['"](?:\.\.\/){4,}js\//;

describe('app schedule RSVP adapter boundary', () => {
    it('keeps schedule RSVP page and hook code off direct legacy js imports', () => {
        [
            'apps/app/src/pages/ScheduleEventDetail.tsx',
            'apps/app/src/hooks/schedule/useScheduleEventRsvp.ts',
            'apps/app/src/lib/scheduleService.ts'
        ].forEach((path) => {
            expect(directLegacyImportPattern.test(readSource(path))).toBe(false);
        });
    });

    it('routes legacy RSVP helpers through the typed schedule helper adapter', () => {
        const scheduleServiceSource = readSource('apps/app/src/lib/scheduleService.ts');
        const rsvpHookSource = readSource('apps/app/src/hooks/schedule/useScheduleEventRsvp.ts');
        const helperAdapterSource = readSource('apps/app/src/lib/adapters/legacyScheduleHelpers.ts');

        expect(scheduleServiceSource).toContain("from './adapters/legacyScheduleHelpers';");
        expect(rsvpHookSource).toContain("import { submitParentScheduleRsvp } from '../../lib/scheduleService';");
        expect(helperAdapterSource).toContain("from '../../../../../js/parent-dashboard-rsvp.js'");
        expect(helperAdapterSource).toContain('resolveMyRsvpByChildForGame');
        expect(helperAdapterSource).toContain('normalizeArray(events)');
        expect(helperAdapterSource).toContain('normalizeArray(rsvps)');
    });

    it('keeps schedule notification and RSVP breakdown helpers behind the same adapter surface', () => {
        const helperAdapterSource = readSource('apps/app/src/lib/adapters/legacyScheduleHelpers.ts');

        expect(helperAdapterSource).toContain("from '../../../../../js/schedule-notifications.js'");
        expect(helperAdapterSource).toContain("from '../../../../../js/game-day-rsvp-breakdown.js'");
        expect(helperAdapterSource).toContain('export async function sendPublicRsvpReminderEmails');
        expect(helperAdapterSource).toContain('export function buildGameDayRsvpBreakdown');
    });
});
