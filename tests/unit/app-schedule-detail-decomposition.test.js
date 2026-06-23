import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();

function readRepoFile(path) {
    return readFileSync(join(repoRoot, path), 'utf8');
}

describe('ScheduleEventDetail decomposition', () => {
    it('keeps extracted navigation, availability, RSVP, and rideshare pieces wired in', () => {
        const source = readRepoFile('apps/app/src/pages/ScheduleEventDetail.tsx');
        const rideshareSource = readRepoFile('apps/app/src/components/schedule/RideshareSection.tsx');

        expect(source).toContain("from '../components/schedule/AssignmentsSection'");
        expect(source).toContain("from '../components/schedule/CompactMeta'");
        expect(source).toContain("from '../components/schedule/EventSectionNav'");
        expect(source).toContain("from '../components/schedule/GameReportSections'");
        expect(source).toContain("from '../components/schedule/PlayerSwitcher'");
        expect(source).toContain("from '../components/schedule/PracticeAttendancePanel'");
        expect(source).toContain("from '../components/schedule/ReportMarkdownText'");
        expect(source).toContain("from '../components/schedule/RideshareSection'");
        expect(source).toContain("from '../components/schedule/ScoreStepper'");
        expect(source).toContain("from '../components/schedule/ScheduleStatus'");
        expect(source).toContain("from '../components/schedule/AvailabilityPanels'");
        expect(source).toContain("from '../components/schedule/StaffRsvpBreakdownPanel'");
        expect(source).toContain("from '../components/schedule/StaffRsvpReminderPanel'");
        expect(source).toContain("from './schedule/ScheduleEventDetailContext'");
        expect(source).toContain("from '../hooks/schedule/useScheduleEventRsvp'");
        expect(source).toContain("from '../hooks/schedule/useStaffRsvpBreakdown'");
        expect(source).toContain('<ScheduleEventDetailProvider value={{');
        expect(source).toContain('useScheduleEventRsvp({ availabilityNote })');
        expect(source).toContain('useStaffRsvpBreakdown(staffRsvpLoader)');
        expect(source).toContain('<GameReportSections event={event} />');
        expect(source).toContain('<PlayerSwitcher events={events} selectedChildId={selectedEvent.childId} onSelect={selectChild} compact />');
        expect(source).not.toMatch(/^function GameReportSections\b/m);
        expect(source).not.toMatch(/^function GameReportSectionContent\b/m);
        expect(source).not.toMatch(/^function PlayerSwitcher\b/m);
        expect(source).not.toMatch(/^function PracticeAttendancePanel\b/m);
        expect(source).not.toMatch(/^function RideshareSection\b/m);
        expect(source).not.toMatch(/^function ScoreStepper\b/m);
        expect(source).not.toMatch(/^function Status\b/m);
        expect(source).not.toMatch(/^function AssignmentsSection\b/m);

        expect(rideshareSource).toContain("import { useScheduleRideOffers } from '../../hooks/schedule/useScheduleRideOffers';");
        expect(rideshareSource).toContain('const rideOffers = useScheduleRideOffers();');
    });

    it('keeps extracted schedule detail modules and focused coverage files in the repo', () => {
        [
            'apps/app/src/components/schedule/AssignmentsSection.tsx',
            'apps/app/src/components/schedule/CompactMeta.tsx',
            'apps/app/src/components/schedule/GameReportSectionContent.tsx',
            'apps/app/src/components/schedule/GameReportSections.tsx',
            'apps/app/src/components/schedule/PlayerSwitcher.tsx',
            'apps/app/src/components/schedule/PracticeAttendancePanel.tsx',
            'apps/app/src/components/schedule/ReportMarkdownText.tsx',
            'apps/app/src/components/schedule/RideOfferCard.tsx',
            'apps/app/src/components/schedule/RideshareSection.tsx',
            'apps/app/src/components/schedule/ScoreStepper.tsx',
            'apps/app/src/components/schedule/ScheduleStatus.tsx',
            'apps/app/src/components/schedule/ScheduleEventDetailPresentational.test.tsx',
            'apps/app/src/components/schedule/ScheduleEventSummaryComponents.test.tsx',
            'apps/app/src/hooks/schedule/useScheduleEventRsvp.ts',
            'apps/app/src/hooks/schedule/useScheduleEventRsvp.test.tsx',
            'apps/app/src/hooks/schedule/useStaffRsvpBreakdown.ts',
            'apps/app/src/hooks/schedule/useStaffRsvpBreakdown.test.tsx',
            'apps/app/src/components/schedule/StaffRsvpBreakdownPanel.tsx',
            'apps/app/src/components/schedule/StaffRsvpReminderPanel.tsx',
            'apps/app/src/hooks/schedule/useScheduleRideOffers.ts',
            'apps/app/src/hooks/schedule/useScheduleRideOffers.test.tsx'
        ].forEach((path) => {
            expect(readRepoFile(path).length).toBeGreaterThan(0);
        });
    });
});
