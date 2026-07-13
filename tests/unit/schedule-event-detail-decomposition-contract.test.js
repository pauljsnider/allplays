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
            "import { CompactMeta } from '../components/schedule/CompactMeta';",
            "import { EventDetailsPanel } from '../components/schedule/EventDetailsPanel';",
            "import { ScheduleEventHeader } from '../components/schedule/ScheduleEventHeader';",
            "import { EventSectionNav } from '../components/schedule/EventSectionNav';",
            "import { PlayerSwitcher } from '../components/schedule/PlayerSwitcher';",
            "import { PracticeAttendancePanel } from '../components/schedule/PracticeAttendancePanel';",
            "import { ReportMarkdownText } from '../components/schedule/ReportMarkdownText';",
            "import { RideshareSection } from '../components/schedule/RideshareSection';",
            "import { ScoreStepper } from '../components/schedule/ScoreStepper';",
            "import { Status } from '../components/schedule/ScheduleStatus';",
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
            /^function CompactMeta\b/m,
            /^function EventDetailsPanel\b/m,
            /^function EventSectionNav\b/m,
            /^function GameReportSections\b/m,
            /^function PlayerSwitcher\b/m,
            /^function PracticeAttendancePanel\b/m,
            /^function ReportMarkdownText\b/m,
            /^function RideOfferCard\b/m,
            /^function RideshareSection\b/m,
            /^function ScoreStepper\b/m,
            /^function StaffRsvpBreakdownPanel\b/m,
            /^function StaffRsvpReminderPanel\b/m,
            /^function StaffRsvpPlayerRow\b/m,
            /^function Status\b/m,
            /^function QuickAvailabilityPanel\b/m,
            /^function AttentionPanel\b/m
        ].forEach((inlineDefinition) => {
            expect(page).not.toMatch(inlineDefinition);
        });
    });

    it('keeps schedule detail utility controls in extracted presentational components', () => {
        const compactMeta = readRepoFile('apps/app/src/components/schedule/CompactMeta.tsx');
        const practiceAttendancePanel = readRepoFile('apps/app/src/components/schedule/PracticeAttendancePanel.tsx');
        const scheduleEventHeader = readRepoFile('apps/app/src/components/schedule/ScheduleEventHeader.tsx');
        const scoreStepper = readRepoFile('apps/app/src/components/schedule/ScoreStepper.tsx');
        const scheduleStatus = readRepoFile('apps/app/src/components/schedule/ScheduleStatus.tsx');
        const focusedTests = readRepoFile('apps/app/src/components/schedule/ScheduleEventDetailPresentational.test.tsx');

        expect(compactMeta).toContain('export function CompactMeta');
        expect(practiceAttendancePanel).toContain('export function PracticeAttendancePanel');
        expect(practiceAttendancePanel).toContain('onSelectStatus(player, status)');
        expect(scheduleEventHeader).toContain("import { DateTile } from './DateTile';");
        expect(scheduleEventHeader).toContain("import { EventBrief } from './EventBrief';");
        expect(scheduleEventHeader).toContain('export function ScheduleEventHeader');
        expect(scoreStepper).toContain('export function ScoreStepper');
        expect(scoreStepper).toContain('controlLabel?: string;');
        expect(scoreStepper).toContain('const accessibleLabel = controlLabel || label;');
        expect(scoreStepper).toContain('aria-label={`${accessibleLabel} score up`}');
        expect(scheduleStatus).toContain('export function Status');
        expect(focusedTests).toContain("describe('ScheduleEventDetail presentational components'");
    });

    it('keeps RSVP and rideshare workflows behind extracted hooks and page context', () => {
        const page = readRepoFile('apps/app/src/pages/ScheduleEventDetail.tsx');
        const rideshareSection = readRepoFile('apps/app/src/components/schedule/RideshareSection.tsx');
        const rideOfferCard = readRepoFile('apps/app/src/components/schedule/RideOfferCard.tsx');
        const rsvpHook = readRepoFile('apps/app/src/hooks/schedule/useScheduleEventRsvp.ts');
        const ridesHook = readRepoFile('apps/app/src/hooks/schedule/useScheduleRideOffers.ts');
        const context = readRepoFile('apps/app/src/pages/schedule/ScheduleEventDetailContext.tsx');

        expect(page).toContain("ScheduleEventDetailProvider");
        expect(page).toContain("from './schedule/ScheduleEventDetailContext';");
        expect(page).toContain("import { useScheduleEventRsvp } from '../hooks/schedule/useScheduleEventRsvp';");
        expect(page).toContain("import { useStaffRsvpBreakdown } from '../hooks/schedule/useStaffRsvpBreakdown';");
        expect(page).toContain("import { RideshareSection } from '../components/schedule/RideshareSection';");
        expect(page).toContain('<ScheduleEventDetailProvider value={{');
        expect(page).toContain('const rsvpWorkflow = useScheduleEventRsvp({ availabilityNote, applyToAllChildren: useFamilyRsvp });');
        expect(page).toContain("const staffRsvpEventScopeKey = `${event.teamId}:${event.id}`;");
        expect(page).toContain('const staffRsvpLoader = useMemo(() => createStaffRsvpAvailabilityLoader(staffRsvpEventScopeKey), [staffRsvpEventScopeKey]);');
        expect(page).toContain('const staffRsvp = useStaffRsvpBreakdown(staffRsvpLoader);');
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
        expect(page).toContain('<StaffRsvpReminderPanel refreshToken={staffRsvp.refreshToken} staffRsvpLoader={staffRsvpLoader} />');
        expect(page).not.toMatch(/^function StaffRsvpBreakdownPanel\b/m);
        expect(page).not.toMatch(/^function StaffRsvpReminderPanel\b/m);
        expect(page).not.toMatch(/const\s+\[staffRsvpBreakdown\b/);
        expect(page).not.toMatch(/loadStaffScheduleRsvpBreakdown\(/);
        expect(page).not.toMatch(/sendStaffRsvpReminder\(/);

        expect(breakdownHook).toContain('export function useStaffRsvpBreakdown');
        expect(breakdownHook).toContain('staffRsvpLoader.loadBreakdown');
        expect(breakdownHook).toContain('staffRsvpLoader.invalidateEvent(event)');
        expect(breakdownHook).toContain('submitStaffScheduleRsvpOverride');
        expect(breakdownHook).toContain('setRefreshToken((current) => current + 1)');
        expect(breakdownPanel).toContain('export function StaffRsvpBreakdownPanel');
        expect(breakdownPanel).toContain('StaffRsvpPlayerRow');
        expect(reminderPanel).toContain('export function StaffRsvpReminderPanel');
        expect(reminderPanel).toContain('staffRsvpLoader.loadReminderPreview');
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

    it('keeps child switcher behavior in the extracted schedule component', () => {
        const page = readRepoFile('apps/app/src/pages/ScheduleEventDetail.tsx');
        const component = readRepoFile('apps/app/src/components/schedule/PlayerSwitcher.tsx');

        expect(page).toContain("import { PlayerSwitcher } from '../components/schedule/PlayerSwitcher';");
        expect(page).toContain('<PlayerSwitcher events={events} selectedChildId={selectedEvent.childId} onSelect={selectChild} compact />');
        expect(page).not.toMatch(/^function PlayerSwitcher\b/m);

        expect(component).toContain('export function PlayerSwitcher');
        expect(component).toContain('data-testid="event-player-switcher"');
        expect(component).toContain('selected ?');
        expect(component).toContain('onClick={() => onSelect(event.childId)}');
        expect(component).toContain('aria-pressed={selected}');
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
        expect(section).toContain('const targetEvent = eventRef.current;');
        expect(section).toContain('loadParentScheduleAssignments(targetEvent)');
        expect(section).toContain('claimParentScheduleAssignmentSlot(event, auth.user!, role)');
        expect(section).toContain('releaseParentScheduleAssignmentClaim(event, role)');
        expect(section).toContain('<AssignmentCard');
    });

    it('keeps game report rendering behind extracted schedule components', () => {
        const page = readRepoFile('apps/app/src/pages/ScheduleEventDetail.tsx');
        const sections = readRepoFile('apps/app/src/components/schedule/GameReportSections.tsx');
        const content = readRepoFile('apps/app/src/components/schedule/GameReportSectionContent.tsx');
        const markdown = readRepoFile('apps/app/src/components/schedule/ReportMarkdownText.tsx');

        expect(page).not.toContain("import { GameReportSections } from '../components/schedule/GameReportSections';");
        expect(page).toContain("type GameReportSectionsModule = typeof import('../components/schedule/GameReportSections');");
        expect(page).toContain('export function loadGameReportSectionsModule()');
        expect(page).toContain("gameReportSectionsModulePromise = import('../components/schedule/GameReportSections');");
        expect(page).toContain('loadGameReportSectionsModule().then((module) => ({ default: module.GameReportSections }))');
        expect(page).toContain('<DeferredGameReportSections event={event} />');
        expect(page).not.toMatch(/^function GameReportSections\b/m);
        expect(page).not.toMatch(/^function GameReportSectionContent\b/m);
        expect(page).not.toMatch(/loadGameReportSections\(/);

        expect(sections).toContain('export function GameReportSections');
        expect(sections).toContain('const loaded = await loadGameReportSections(event.teamId, event.id);');
        expect(sections).toContain('<GameReportSectionContent report={report} activeSection={activeReportSection} />');
        expect(sections).toContain('function getVisibleGameReportSections(report: GameReportData | null)');
        expect(content).toContain('export function GameReportSectionContent');
        expect(content).toContain('function MatchSummarySection({ report }: { report: GameReportData })');
        expect(content).toContain('function PlayerPerformanceSection({ report }: { report: GameReportData })');
        expect(content).toContain('function ReportInsightsSection({ report }: { report: GameReportData })');
        expect(markdown).toContain('export function ReportMarkdownText');
    });
});
