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
            "import { AssignmentsSection } from '../components/schedule/AssignmentsSection';",
            "import { DateTile } from '../components/schedule/DateTile';",
            "import { EventBrief } from '../components/schedule/EventBrief';",
            "import { EventDetailsPanel } from '../components/schedule/EventDetailsPanel';",
            "import { EventSectionNav } from '../components/schedule/EventSectionNav';",
            "import { RideshareSection } from '../components/schedule/RideshareSection';",
            "import { StaffRsvpBreakdownPanel } from '../components/schedule/StaffRsvpBreakdownPanel';",
            "import { StaffRsvpReminderPanel } from '../components/schedule/StaffRsvpReminderPanel';",
            'QuickAvailabilityPanel',
            'AvailabilityNotesList',
            'AttentionPanel'
        ].forEach((snippet) => {
            expect(page).toContain(snippet);
        });

        [
            /^function AssignmentCard\b/m,
            /^function AssignmentsSection\b/m,
            /^function DateTile\b/m,
            /^function EventBrief\b/m,
            /^function EventDetailsPanel\b/m,
            /^function EventSectionNav\b/m,
            /^function RideOfferCard\b/m,
            /^function RideshareSection\b/m,
            /^function StaffRsvpBreakdownPanel\b/m,
            /^function StaffRsvpReminderPanel\b/m,
            /^function StaffRsvpPlayerRow\b/m,
            /^function QuickAvailabilityPanel\b/m,
            /^function AttentionPanel\b/m
        ].forEach((inlineDefinition) => {
            expect(page).not.toMatch(inlineDefinition);
        });
    });

    it('keeps RSVP and rideshare workflows behind extracted hooks and page context', () => {
        const page = readRepoFile('apps/app/src/pages/ScheduleEventDetail.tsx');
        const rideshareSection = readRepoFile('apps/app/src/components/schedule/RideshareSection.tsx');
        const rideOfferCard = readRepoFile('apps/app/src/components/schedule/RideOfferCard.tsx');
        const rsvpHook = readRepoFile('apps/app/src/hooks/schedule/useScheduleEventRsvp.ts');
        const ridesHook = readRepoFile('apps/app/src/hooks/schedule/useScheduleRideOffers.ts');
        const context = readRepoFile('apps/app/src/pages/schedule/ScheduleEventDetailContext.tsx');

        expect(page).toContain("import { ScheduleEventDetailProvider } from './schedule/ScheduleEventDetailContext';");
        expect(page).toContain("import { useScheduleEventRsvp } from '../hooks/schedule/useScheduleEventRsvp';");
        expect(page).toContain("import { useStaffRsvpBreakdown } from '../hooks/schedule/useStaffRsvpBreakdown';");
        expect(page).toContain("import { RideshareSection } from '../components/schedule/RideshareSection';");
        expect(page).toContain('<ScheduleEventDetailProvider value={{');
        expect(page).toContain('const rsvpWorkflow = useScheduleEventRsvp({ availabilityNote });');
        expect(page).toContain('const staffRsvp = useStaffRsvpBreakdown();');
        expect(page).toContain('<RideshareSection />');
        expect(page).not.toMatch(/^function RideshareSection\b/m);
        expect(page).not.toMatch(/^function RideOfferCard\b/m);

        expect(rsvpHook).toContain('export function useScheduleEventRsvp');
        expect(rsvpHook).toContain('useScheduleEventDetailContext()');
        expect(rsvpHook).toContain('submitParentScheduleRsvp');
        expect(rideshareSection).toContain("import { useScheduleRideOffers } from '../../hooks/schedule/useScheduleRideOffers';");
        expect(rideshareSection).toContain('const rideOffers = useScheduleRideOffers();');
        expect(rideshareSection).toContain('<RideOfferCard');
        expect(rideOfferCard).toContain('export function RideOfferCard');
        expect(rideOfferCard).toContain('canRequestScheduleRide');
        expect(ridesHook).toContain('export function useScheduleRideOffers');
        expect(ridesHook).toContain('useScheduleEventDetailContext()');
        expect(ridesHook).toContain('loadParentScheduleRideOffers');
        expect(context).toContain('export function ScheduleEventDetailProvider');
        expect(context).toContain('export function useScheduleEventDetailContext');
    });

    it('keeps staff RSVP breakdown and reminder workflow extracted from the detail page', () => {
        const page = readRepoFile('apps/app/src/pages/ScheduleEventDetail.tsx');
        const breakdownHook = readRepoFile('apps/app/src/hooks/schedule/useStaffRsvpBreakdown.ts');
        const breakdownPanel = readRepoFile('apps/app/src/components/schedule/StaffRsvpBreakdownPanel.tsx');
        const reminderPanel = readRepoFile('apps/app/src/components/schedule/StaffRsvpReminderPanel.tsx');

        expect(page).toContain("import { StaffRsvpBreakdownPanel } from '../components/schedule/StaffRsvpBreakdownPanel';");
        expect(page).toContain("import { StaffRsvpReminderPanel } from '../components/schedule/StaffRsvpReminderPanel';");
        expect(page).toContain("import { useStaffRsvpBreakdown } from '../hooks/schedule/useStaffRsvpBreakdown';");
        expect(page).toContain('<StaffRsvpBreakdownPanel');
        expect(page).toContain('<StaffRsvpReminderPanel refreshToken={staffRsvp.refreshToken} />');
        expect(page).not.toMatch(/^function StaffRsvpBreakdownPanel\b/m);
        expect(page).not.toMatch(/^function StaffRsvpReminderPanel\b/m);
        expect(page).not.toMatch(/const\s+\[staffRsvpBreakdown\b/);
        expect(page).not.toMatch(/loadStaffScheduleRsvpBreakdown\(/);
        expect(page).not.toMatch(/sendStaffRsvpReminder\(/);

        expect(breakdownHook).toContain('export function useStaffRsvpBreakdown');
        expect(breakdownHook).toContain('loadStaffScheduleRsvpBreakdown');
        expect(breakdownHook).toContain('submitStaffScheduleRsvpOverride');
        expect(breakdownHook).toContain('setRefreshToken((current) => current + 1)');
        expect(breakdownPanel).toContain('export function StaffRsvpBreakdownPanel');
        expect(breakdownPanel).toContain('StaffRsvpPlayerRow');
        expect(reminderPanel).toContain('export function StaffRsvpReminderPanel');
        expect(reminderPanel).toContain('loadStaffRsvpReminderPreview');
        expect(reminderPanel).toContain('sendStaffRsvpReminder');
    });

    it('keeps staff RSVP player rows in the extracted schedule component', () => {
        const component = readRepoFile('apps/app/src/components/schedule/StaffRsvpPlayerRow.tsx');

        expect(component).toContain('export function StaffRsvpPlayerRow');
        expect(component).toContain('data-testid={`staff-rsvp-row-${player.playerId}`}');
        expect(component).toContain("(['going', 'maybe', 'not_going'] as const).map");
        expect(component).toContain("disabled={submitting || eventLocked}");
        expect(component).toContain("{submitting && player.response !== response ? 'Saving' : rsvpLabels[response]}");
    });

    it('keeps event detail metadata rendering in the extracted schedule component', () => {
        const component = readRepoFile('apps/app/src/components/schedule/EventDetailsPanel.tsx');

        expect(component).toContain('export function EventDetailsPanel');
        expect(component).toContain('function getEventDetailRows(event: ParentScheduleEvent)');
        expect(component).toContain('const mapHref = getScheduleMapHref(event.location);');
        expect(component).toContain('const forecastHref = getScheduleForecastHref(event.location);');
        expect(component).toContain("{ label: 'Game info', value: formatGameInfo(event), icon: ClipboardCheck }");
        expect(component).toContain("{ label: 'Home packet', value: event.practiceHomePacketSummary, icon: FileText }");
    });

    it('keeps assignment row rendering in the extracted schedule component', () => {
        const component = readRepoFile('apps/app/src/components/schedule/AssignmentCard.tsx');

        expect(component).toContain('export function AssignmentCard');
        expect(component).toContain('isScheduleAssignmentClaimedByUser(assignment, userId)');
        expect(component).toContain('isScheduleAssignmentOpen(assignment)');
        expect(component).toContain('getScheduleAssignmentStatus(assignment, userId)');
        expect(component).toContain("{busy ? 'Signing up' : 'Sign up'}");
        expect(component).toContain("{busy ? 'Releasing' : 'Release'}");
    });

    it('keeps assignment workflow actions in the extracted schedule section', () => {
        const page = readRepoFile('apps/app/src/pages/ScheduleEventDetail.tsx');
        const section = readRepoFile('apps/app/src/components/schedule/AssignmentsSection.tsx');

        expect(page).toContain("import { AssignmentsSection } from '../components/schedule/AssignmentsSection';");
        expect(page).toContain('<AssignmentsSection />');
        expect(page).not.toMatch(/^function AssignmentsSection\b/m);
        expect(page).not.toMatch(/loadParentScheduleAssignments\(/);
        expect(page).not.toMatch(/claimParentScheduleAssignmentSlot\(/);
        expect(page).not.toMatch(/releaseParentScheduleAssignmentClaim\(/);

        expect(section).toContain('export function AssignmentsSection');
        expect(section).toContain('useScheduleEventDetailContext()');
        expect(section).toContain('loadParentScheduleAssignments(event)');
        expect(section).toContain('claimParentScheduleAssignmentSlot(event, auth.user!, role)');
        expect(section).toContain('releaseParentScheduleAssignmentClaim(event, role)');
        expect(section).toContain('<AssignmentCard');
    });

    it('keeps game report rendering behind named page boundaries', () => {
        const page = readRepoFile('apps/app/src/pages/ScheduleEventDetail.tsx');

        expect(page).toContain('function GameReportSections({ event }: { event: ParentScheduleEvent })');
        expect(page).toContain('const loaded = await loadGameReportSections(event.teamId, event.id);');
        expect(page).toContain('<GameReportSectionContent report={report} activeSection={activeReportSection} />');
        expect(page).toContain('function GameReportSectionContent({ report, activeSection }: { report: GameReportData; activeSection: GameReportSectionId })');
        expect(page).toContain('function MatchSummarySection({ report }: { report: GameReportData })');
        expect(page).toContain('function PlayerPerformanceSection({ report }: { report: GameReportData })');
        expect(page).toContain('function ReportInsightsSection({ report }: { report: GameReportData })');
    });
});
