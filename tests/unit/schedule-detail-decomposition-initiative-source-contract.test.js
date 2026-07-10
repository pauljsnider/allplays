import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readSource(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

const detailSource = readSource('apps/app/src/pages/ScheduleEventDetail.tsx');
const contextSource = readSource('apps/app/src/pages/schedule/ScheduleEventDetailContext.tsx');
const rsvpHookSource = readSource('apps/app/src/hooks/schedule/useScheduleEventRsvp.ts');
const ridesHookSource = readSource('apps/app/src/hooks/schedule/useScheduleRideOffers.ts');
const availabilityPanelsSource = readSource('apps/app/src/components/schedule/AvailabilityPanels.tsx');
const availabilityNotesListSource = readSource('apps/app/src/components/schedule/AvailabilityNotesList.tsx');
const attentionPanelSource = readSource('apps/app/src/components/schedule/AttentionPanel.tsx');
const compactMetaSource = readSource('apps/app/src/components/schedule/CompactMeta.tsx');
const scheduleEventHeaderSource = readSource('apps/app/src/components/schedule/ScheduleEventHeader.tsx');
const assignmentsSectionSource = readSource('apps/app/src/components/schedule/AssignmentsSection.tsx');
const gameReportSectionsSource = readSource('apps/app/src/components/schedule/GameReportSections.tsx');
const gameReportContentSource = readSource('apps/app/src/components/schedule/GameReportSectionContent.tsx');
const playerSwitcherSource = readSource('apps/app/src/components/schedule/PlayerSwitcher.tsx');
const practiceAttendancePanelSource = readSource('apps/app/src/components/schedule/PracticeAttendancePanel.tsx');
const reportMarkdownSource = readSource('apps/app/src/components/schedule/ReportMarkdownText.tsx');
const rideOfferCardSource = readSource('apps/app/src/components/schedule/RideOfferCard.tsx');
const rideshareSectionSource = readSource('apps/app/src/components/schedule/RideshareSection.tsx');
const scoreStepperSource = readSource('apps/app/src/components/schedule/ScoreStepper.tsx');
const scheduleStatusSource = readSource('apps/app/src/components/schedule/ScheduleStatus.tsx');
const staffRsvpRowSource = readSource('apps/app/src/components/schedule/StaffRsvpPlayerRow.tsx');
const staffRsvpBreakdownPanelSource = readSource('apps/app/src/components/schedule/StaffRsvpBreakdownPanel.tsx');
const staffRsvpReminderPanelSource = readSource('apps/app/src/components/schedule/StaffRsvpReminderPanel.tsx');
const staffRsvpBreakdownHookSource = readSource('apps/app/src/hooks/schedule/useStaffRsvpBreakdown.ts');
const presentationalComponentTestSource = readSource('apps/app/src/components/schedule/ScheduleEventDetailPresentational.test.tsx');
const summaryComponentTestSource = readSource('apps/app/src/components/schedule/ScheduleEventSummaryComponents.test.tsx');
const rsvpHookTestSource = readSource('apps/app/src/hooks/schedule/useScheduleEventRsvp.test.tsx');
const staffRsvpHookTestSource = readSource('apps/app/src/hooks/schedule/useStaffRsvpBreakdown.test.tsx');
const ridesHookTestSource = readSource('apps/app/src/hooks/schedule/useScheduleRideOffers.test.tsx');

describe('ScheduleEventDetail decomposition initiative source contract', () => {
    it('keeps shared event detail state in the extracted provider context', () => {
        expect(detailSource).toContain("ScheduleEventDetailProvider");
        expect(detailSource).toContain("from './schedule/ScheduleEventDetailContext';");
        expect(detailSource).toContain('<ScheduleEventDetailProvider value={{');
        [
            'auth',
            'event: selectedEvent',
            'childEvents',
            'selectedChildId',
            'selectChild',
            'updateEvents'
        ].forEach((providerValue) => {
            expect(detailSource).toContain(providerValue);
        });

        expect(contextSource).toContain('const ScheduleEventDetailContext = createContext<ScheduleEventDetailContextValue | null>(null);');
        expect(contextSource).toContain('export function ScheduleEventDetailProvider');
        expect(contextSource).toContain('export function useScheduleEventDetailContext()');
        expect(contextSource).toContain('throw new Error(\'useScheduleEventDetailContext must be used within a ScheduleEventDetailProvider.\');');
    });

    it('keeps parent RSVP mutation, optimistic update, and rollback logic in useScheduleEventRsvp', () => {
        expect(detailSource).toContain("import { useScheduleEventRsvp } from '../hooks/schedule/useScheduleEventRsvp';");
        expect(detailSource).toContain('const rsvpWorkflow = useScheduleEventRsvp({ availabilityNote, applyToAllChildren: useFamilyRsvp });');
        expect(detailSource).not.toMatch(/const\s+\[rsvpSubmitting\b/);
        expect(detailSource).not.toMatch(/submitParentScheduleRsvp\(/);

        expect(rsvpHookSource).toContain('const { auth, event, childEvents, updateEvents } = useScheduleEventDetailContext();');
        expect(rsvpHookSource).toContain('const [submitting, setSubmitting] = useState<RsvpResponse | null>(null);');
        expect(rsvpHookSource).toContain('const matchingChildEvents = childEvents.filter((childEvent) => (');
        expect(rsvpHookSource).toContain('const targetEvents = applyToAllChildren ? matchingChildEvents : [event];');
        expect(rsvpHookSource).toContain('const optimisticSummary = targetEvents.reduce(');
        expect(rsvpHookSource).toContain('await submitParentScheduleRsvp(event, currentUser, response, note);');
        expect(rsvpHookSource).toContain('await submitParentScheduleRsvpForChildren(targetEvents, currentUser, response, note)');
        expect(rsvpHookSource).toContain('myRsvp: previousState.rsvp,');
        expect(rsvpHookTestSource).toContain("describe('useScheduleEventRsvp'");
    });

    it('keeps rideshare loading and mutations in useScheduleRideOffers', () => {
        expect(detailSource).toContain("import { RideshareSection } from '../components/schedule/RideshareSection';");
        expect(detailSource).toContain("<RideshareSection />");
        expect(detailSource).not.toMatch(/^function RideshareSection\b/m);
        expect(detailSource).not.toMatch(/^function RideOfferCard\b/m);
        expect(detailSource).not.toMatch(/const\s+\[rideOffers\b/);
        expect(detailSource).not.toMatch(/loadParentScheduleRideOffers\(/);

        expect(rideshareSectionSource).toContain("import { useScheduleRideOffers } from '../../hooks/schedule/useScheduleRideOffers';");
        expect(rideshareSectionSource).toContain('const rideOffers = useScheduleRideOffers();');
        expect(rideshareSectionSource).toContain('<RideOfferCard');
        expect(rideOfferCardSource).toContain('export function RideOfferCard');
        expect(rideOfferCardSource).toContain('canRequestScheduleRide(offer, userId, selectedChild.childId)');
        expect(rideOfferCardSource).toContain('onDecision(request.id, status)');

        expect(ridesHookSource).toContain('const { auth, event, childEvents, updateEvents } = useScheduleEventDetailContext();');
        expect(ridesHookSource).toContain('const [offers, setOffers] = useState<ScheduleRideOffer[]>([]);');
        expect(ridesHookSource).toContain('const summary = loading && !offers.length ? event.rideshareSummary : summarizeParentScheduleRideOffers(offers);');
        expect(ridesHookSource).toContain('() => loadParentScheduleRideOffers(currentEvent)');
        expect(ridesHookSource).toContain('const runRideAction = useCallback(async (actionKey: string, action: () => Promise<void>, successMessage: string) => {');
        expect(ridesHookSource).toContain('await createParentScheduleRideOffer(event, auth.user!, input);');
        expect(ridesHookTestSource).toContain("describe('useScheduleRideOffers'");
    });

    it('keeps assignment workflow loading and mutations in the extracted section', () => {
        expect(detailSource).toContain("import { AssignmentsSection } from '../components/schedule/AssignmentsSection';");
        expect(detailSource).toContain("<AssignmentsSection />");
        expect(detailSource).not.toMatch(/^function AssignmentsSection\b/m);
        expect(detailSource).not.toMatch(/claimParentScheduleAssignmentSlot\(/);
        expect(detailSource).not.toMatch(/releaseParentScheduleAssignmentClaim\(/);
        expect(detailSource).not.toMatch(/loadParentScheduleAssignments\(/);

        expect(assignmentsSectionSource).toContain('export function AssignmentsSection');
        expect(assignmentsSectionSource).toContain('const { auth, event, updateEvents } = useScheduleEventDetailContext();');
        expect(assignmentsSectionSource).toContain('loadParentScheduleAssignments(event)');
        expect(assignmentsSectionSource).toContain('claimParentScheduleAssignmentSlot(event, auth.user!, role)');
        expect(assignmentsSectionSource).toContain('releaseParentScheduleAssignmentClaim(event, role)');
        expect(assignmentsSectionSource).toContain('<AssignmentCard');
    });

    it('keeps reusable schedule UI out of the detail page body', () => {
        [
            "import { CompactMeta } from '../components/schedule/CompactMeta';",
            "import { ScheduleEventHeader } from '../components/schedule/ScheduleEventHeader';",
            "import { PlayerSwitcher } from '../components/schedule/PlayerSwitcher';",
            "import { PracticeAttendancePanel } from '../components/schedule/PracticeAttendancePanel';",
            "import { ReportMarkdownText } from '../components/schedule/ReportMarkdownText';",
            "import { EventSectionNav } from '../components/schedule/EventSectionNav';",
            "import { ScoreStepper } from '../components/schedule/ScoreStepper';",
            "import { Status } from '../components/schedule/ScheduleStatus';",
            "import { StaffRsvpBreakdownPanel } from '../components/schedule/StaffRsvpBreakdownPanel';",
            "import { StaffRsvpReminderPanel } from '../components/schedule/StaffRsvpReminderPanel';",
            'QuickAvailabilityPanel',
            'AvailabilityNotesList',
            'AttentionPanel'
        ].forEach((snippet) => {
            expect(detailSource).toContain(snippet);
        });

        [
            /^function CompactMeta\b/m,
            /^function EventSectionNav\b/m,
            /^function GameReportSections\b/m,
            /^function PlayerSwitcher\b/m,
            /^function PracticeAttendancePanel\b/m,
            /^function ReportMarkdownText\b/m,
            /^function ScoreStepper\b/m,
            /^function Status\b/m,
            /^function StaffRsvpBreakdownPanel\b/m,
            /^function StaffRsvpReminderPanel\b/m,
            /^function QuickAvailabilityPanel\b/m,
            /^function AvailabilityNotesList\b/m,
            /^function AttentionPanel\b/m,
            /^function StaffRsvpPlayerRow\b/m
        ].forEach((inlineDefinition) => {
            expect(detailSource).not.toMatch(inlineDefinition);
        });

        expect(compactMetaSource).toContain('export function CompactMeta');
        expect(scheduleEventHeaderSource).toContain("import { DateTile } from './DateTile';");
        expect(scheduleEventHeaderSource).toContain("import { EventBrief } from './EventBrief';");
        expect(scheduleEventHeaderSource).toContain('export function ScheduleEventHeader');
        expect(practiceAttendancePanelSource).toContain('export function PracticeAttendancePanel');
        expect(practiceAttendancePanelSource).toContain('data-testid={`practice-attendance-row-${player.playerId}`}');
        expect(scoreStepperSource).toContain('export function ScoreStepper');
        expect(scoreStepperSource).toContain('controlLabel?: string;');
        expect(scoreStepperSource).toContain('const accessibleLabel = controlLabel || label;');
        expect(scoreStepperSource).toContain('aria-label={`${accessibleLabel} score down`}');
        expect(scheduleStatusSource).toContain('export function Status');
        expect(availabilityPanelsSource).toContain('export function QuickAvailabilityPanel');
        expect(availabilityPanelsSource).toContain("export { AvailabilityNotesList");
        expect(availabilityPanelsSource).toContain("export { AttentionPanel");
        expect(availabilityPanelsSource).not.toContain('export function AvailabilityNotesList');
        expect(availabilityPanelsSource).not.toContain('export function AttentionPanel');
        expect(availabilityNotesListSource).toContain('export function AvailabilityNotesList');
        expect(attentionPanelSource).toContain('export function AttentionPanel');
        expect(staffRsvpRowSource).toContain('export function StaffRsvpPlayerRow');
        expect(staffRsvpBreakdownPanelSource).toContain('export function StaffRsvpBreakdownPanel');
        expect(staffRsvpReminderPanelSource).toContain('export function StaffRsvpReminderPanel');
        expect(presentationalComponentTestSource).toContain("describe('ScheduleEventDetail presentational components'");
        expect(summaryComponentTestSource).toContain("describe('Schedule event summary components'");
    });

    it('keeps child switching and game report rendering in extracted schedule components', () => {
        expect(detailSource).toContain("import { PlayerSwitcher } from '../components/schedule/PlayerSwitcher';");
        expect(detailSource).toContain("type GameReportSectionsModule = typeof import('../components/schedule/GameReportSections');");
        expect(detailSource).toContain("gameReportSectionsModulePromise = import('../components/schedule/GameReportSections');");
        expect(detailSource).toContain('const DeferredGameReportSections = lazy(() => (');
        expect(detailSource).toContain('<PlayerSwitcher events={events} selectedChildId={selectedEvent.childId} onSelect={selectChild} compact />');
        expect(detailSource).toContain('<DeferredGameReportSections event={event} />');
        expect(detailSource).not.toMatch(/^function PlayerSwitcher\b/m);
        expect(detailSource).not.toMatch(/^function GameReportSections\b/m);
        expect(detailSource).not.toMatch(/^function GameReportSectionContent\b/m);
        expect(detailSource).not.toMatch(/loadGameReportSections\(/);

        expect(playerSwitcherSource).toContain('export function PlayerSwitcher');
        expect(playerSwitcherSource).toContain('data-testid="event-player-switcher"');
        expect(playerSwitcherSource).toContain('onClick={() => onSelect(event.childId)}');
        expect(gameReportSectionsSource).toContain('export function GameReportSections');
        expect(gameReportSectionsSource).toContain('loadGameReportSections(event.teamId, event.id)');
        expect(gameReportSectionsSource).toContain('function getVisibleGameReportSections(report: GameReportData | null)');
        expect(gameReportContentSource).toContain('export function GameReportSectionContent');
        expect(gameReportContentSource).toContain('function MatchSummarySection({ report }: { report: GameReportData })');
        expect(gameReportContentSource).toContain('function PlayerPerformanceSection({ report }: { report: GameReportData })');
        expect(gameReportContentSource).toContain('function ReportMediaSection({ report }: { report: GameReportData })');
        expect(reportMarkdownSource).toContain('export function ReportMarkdownText');
    });

    it('keeps staff RSVP admin workflow behind extracted panel and hook modules', () => {
        expect(detailSource).toContain("import { useStaffRsvpBreakdown } from '../hooks/schedule/useStaffRsvpBreakdown';");
        expect(detailSource).toContain('const staffRsvpLoader = useMemo(() => createStaffRsvpAvailabilityLoader(), [event.teamId, event.id]);');
        expect(detailSource).toContain('const staffRsvp = useStaffRsvpBreakdown(staffRsvpLoader);');
        expect(detailSource).toContain('<StaffRsvpBreakdownPanel');
        expect(detailSource).toContain('<StaffRsvpReminderPanel refreshToken={staffRsvp.refreshToken} staffRsvpLoader={staffRsvpLoader} />');
        expect(detailSource).not.toMatch(/const\s+\[staffRsvpBreakdown\b/);
        expect(detailSource).not.toMatch(/^function StaffRsvpBreakdownPanel\b/m);
        expect(detailSource).not.toMatch(/^function StaffRsvpReminderPanel\b/m);

        expect(staffRsvpBreakdownHookSource).toContain('export function useStaffRsvpBreakdown');
        expect(staffRsvpBreakdownHookSource).toContain('useScheduleEventDetailContext()');
        expect(staffRsvpBreakdownHookSource).toContain('staffRsvpLoader.loadBreakdown');
        expect(staffRsvpBreakdownHookSource).toContain('staffRsvpLoader.invalidateEvent(event)');
        expect(staffRsvpBreakdownHookSource).toContain('submitStaffScheduleRsvpOverride');
        expect(staffRsvpHookTestSource).toContain("describe('useStaffRsvpBreakdown'");
        expect(staffRsvpBreakdownPanelSource).toContain('StaffRsvpPlayerRow');
        expect(staffRsvpReminderPanelSource).toContain('staffRsvpLoader.loadReminderPreview');
        expect(staffRsvpReminderPanelSource).toContain('sendStaffRsvpReminder');
    });
});
