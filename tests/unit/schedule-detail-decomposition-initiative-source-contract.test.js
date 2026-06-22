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
const assignmentsSectionSource = readSource('apps/app/src/components/schedule/AssignmentsSection.tsx');
const rideOfferCardSource = readSource('apps/app/src/components/schedule/RideOfferCard.tsx');
const rideshareSectionSource = readSource('apps/app/src/components/schedule/RideshareSection.tsx');
const staffRsvpRowSource = readSource('apps/app/src/components/schedule/StaffRsvpPlayerRow.tsx');
const staffRsvpBreakdownPanelSource = readSource('apps/app/src/components/schedule/StaffRsvpBreakdownPanel.tsx');
const staffRsvpReminderPanelSource = readSource('apps/app/src/components/schedule/StaffRsvpReminderPanel.tsx');
const staffRsvpBreakdownHookSource = readSource('apps/app/src/hooks/schedule/useStaffRsvpBreakdown.ts');
const summaryComponentTestSource = readSource('apps/app/src/components/schedule/ScheduleEventSummaryComponents.test.tsx');
const rsvpHookTestSource = readSource('apps/app/src/hooks/schedule/useScheduleEventRsvp.test.tsx');
const staffRsvpHookTestSource = readSource('apps/app/src/hooks/schedule/useStaffRsvpBreakdown.test.tsx');
const ridesHookTestSource = readSource('apps/app/src/hooks/schedule/useScheduleRideOffers.test.tsx');

describe('ScheduleEventDetail decomposition initiative source contract', () => {
    it('keeps shared event detail state in the extracted provider context', () => {
        expect(detailSource).toContain("import { ScheduleEventDetailProvider } from './schedule/ScheduleEventDetailContext';");
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
        expect(detailSource).toContain('const rsvpWorkflow = useScheduleEventRsvp({ availabilityNote });');
        expect(detailSource).not.toMatch(/const\s+\[rsvpSubmitting\b/);
        expect(detailSource).not.toMatch(/submitParentScheduleRsvp\(/);

        expect(rsvpHookSource).toContain('const { auth, event, updateEvents } = useScheduleEventDetailContext();');
        expect(rsvpHookSource).toContain('const [submitting, setSubmitting] = useState<RsvpResponse | null>(null);');
        expect(rsvpHookSource).toContain('const optimisticSummary = buildOptimisticRsvpSummary(event.rsvpSummary, previousRsvp, response);');
        expect(rsvpHookSource).toContain('const summary = await submitParentScheduleRsvp(event, currentUser, response, note);');
        expect(rsvpHookSource).toContain('myRsvp: previousRsvp,');
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
            "import { DateTile } from '../components/schedule/DateTile';",
            "import { EventBrief } from '../components/schedule/EventBrief';",
            "import { EventSectionNav } from '../components/schedule/EventSectionNav';",
            "import { StaffRsvpBreakdownPanel } from '../components/schedule/StaffRsvpBreakdownPanel';",
            "import { StaffRsvpReminderPanel } from '../components/schedule/StaffRsvpReminderPanel';",
            'QuickAvailabilityPanel',
            'AvailabilityNotesList',
            'AttentionPanel'
        ].forEach((snippet) => {
            expect(detailSource).toContain(snippet);
        });

        [
            /^function DateTile\b/m,
            /^function EventBrief\b/m,
            /^function EventSectionNav\b/m,
            /^function StaffRsvpBreakdownPanel\b/m,
            /^function StaffRsvpReminderPanel\b/m,
            /^function QuickAvailabilityPanel\b/m,
            /^function AvailabilityNotesList\b/m,
            /^function AttentionPanel\b/m,
            /^function StaffRsvpPlayerRow\b/m
        ].forEach((inlineDefinition) => {
            expect(detailSource).not.toMatch(inlineDefinition);
        });

        expect(availabilityPanelsSource).toContain('export function QuickAvailabilityPanel');
        expect(availabilityPanelsSource).toContain('export function AvailabilityNotesList');
        expect(availabilityPanelsSource).toContain('export function AttentionPanel');
        expect(staffRsvpRowSource).toContain('export function StaffRsvpPlayerRow');
        expect(staffRsvpBreakdownPanelSource).toContain('export function StaffRsvpBreakdownPanel');
        expect(staffRsvpReminderPanelSource).toContain('export function StaffRsvpReminderPanel');
        expect(summaryComponentTestSource).toContain("describe('Schedule event summary components'");
    });

    it('keeps staff RSVP admin workflow behind extracted panel and hook modules', () => {
        expect(detailSource).toContain("import { useStaffRsvpBreakdown } from '../hooks/schedule/useStaffRsvpBreakdown';");
        expect(detailSource).toContain('const staffRsvp = useStaffRsvpBreakdown();');
        expect(detailSource).toContain('<StaffRsvpBreakdownPanel');
        expect(detailSource).toContain('<StaffRsvpReminderPanel refreshToken={staffRsvp.refreshToken} />');
        expect(detailSource).not.toMatch(/const\s+\[staffRsvpBreakdown\b/);
        expect(detailSource).not.toMatch(/^function StaffRsvpBreakdownPanel\b/m);
        expect(detailSource).not.toMatch(/^function StaffRsvpReminderPanel\b/m);

        expect(staffRsvpBreakdownHookSource).toContain('export function useStaffRsvpBreakdown');
        expect(staffRsvpBreakdownHookSource).toContain('useScheduleEventDetailContext()');
        expect(staffRsvpBreakdownHookSource).toContain('loadStaffScheduleRsvpBreakdown');
        expect(staffRsvpBreakdownHookSource).toContain('submitStaffScheduleRsvpOverride');
        expect(staffRsvpHookTestSource).toContain("describe('useStaffRsvpBreakdown'");
        expect(staffRsvpBreakdownPanelSource).toContain('StaffRsvpPlayerRow');
        expect(staffRsvpReminderPanelSource).toContain('loadStaffRsvpReminderPreview');
        expect(staffRsvpReminderPanelSource).toContain('sendStaffRsvpReminder');
    });
});
