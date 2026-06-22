import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath) {
    return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

describe('ScheduleEventDetail decomposition contract', () => {
    it('keeps reusable event summary UI in schedule components', () => {
        const page = readRepoFile('apps/app/src/pages/ScheduleEventDetail.tsx');

        [
            "import { DateTile } from '../components/schedule/DateTile';",
            "import { EventBrief } from '../components/schedule/EventBrief';",
            "import { EventSectionNav } from '../components/schedule/EventSectionNav';",
            "import { StaffRsvpPlayerRow } from '../components/schedule/StaffRsvpPlayerRow';",
            'QuickAvailabilityPanel',
            'AvailabilityNotesList',
            'AttentionPanel'
        ].forEach((snippet) => {
            expect(page).toContain(snippet);
        });

        [
            /^function DateTile\b/m,
            /^function EventBrief\b/m,
            /^function EventSectionNav\b/m,
            /^function StaffRsvpPlayerRow\b/m,
            /^function QuickAvailabilityPanel\b/m,
            /^function AttentionPanel\b/m
        ].forEach((inlineDefinition) => {
            expect(page).not.toMatch(inlineDefinition);
        });
    });

    it('keeps RSVP and rideshare workflows behind extracted hooks and page context', () => {
        const page = readRepoFile('apps/app/src/pages/ScheduleEventDetail.tsx');
        const rsvpHook = readRepoFile('apps/app/src/hooks/schedule/useScheduleEventRsvp.ts');
        const ridesHook = readRepoFile('apps/app/src/hooks/schedule/useScheduleRideOffers.ts');
        const context = readRepoFile('apps/app/src/pages/schedule/ScheduleEventDetailContext.tsx');

        expect(page).toContain("import { ScheduleEventDetailProvider } from './schedule/ScheduleEventDetailContext';");
        expect(page).toContain("import { useScheduleEventRsvp } from '../hooks/schedule/useScheduleEventRsvp';");
        expect(page).toContain("import { useScheduleRideOffers } from '../hooks/schedule/useScheduleRideOffers';");
        expect(page).toContain('<ScheduleEventDetailProvider value={{');
        expect(page).toContain('const rsvpWorkflow = useScheduleEventRsvp({ availabilityNote });');
        expect(page).toContain('const rideOffers = useScheduleRideOffers();');

        expect(rsvpHook).toContain('export function useScheduleEventRsvp');
        expect(rsvpHook).toContain('useScheduleEventDetailContext()');
        expect(rsvpHook).toContain('submitParentScheduleRsvp');
        expect(ridesHook).toContain('export function useScheduleRideOffers');
        expect(ridesHook).toContain('useScheduleEventDetailContext()');
        expect(ridesHook).toContain('loadParentScheduleRideOffers');
        expect(context).toContain('export function ScheduleEventDetailProvider');
        expect(context).toContain('export function useScheduleEventDetailContext');
    });

    it('keeps staff RSVP player rows in the extracted schedule component', () => {
        const component = readRepoFile('apps/app/src/components/schedule/StaffRsvpPlayerRow.tsx');

        expect(component).toContain('export function StaffRsvpPlayerRow');
        expect(component).toContain('data-testid={`staff-rsvp-row-${player.playerId}`}');
        expect(component).toContain("(['going', 'maybe', 'not_going'] as const).map");
        expect(component).toContain("disabled={submitting || eventLocked}");
        expect(component).toContain("{submitting && player.response !== response ? 'Saving' : rsvpLabels[response]}");
    });
});
