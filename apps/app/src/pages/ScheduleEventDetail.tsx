import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ClipboardCheck, Users } from 'lucide-react';
import {
  loadParentScheduleEventDetail,
  hydrateParentScheduleEventOptionalDetails,
  resolveCachedParentScheduleEvents,
  createStaffRsvpAvailabilityLoader,
  enableRsvpForImportedCalendarEvent,
  type ParentPracticePacket,
  type ParentScheduleLoadResult,
} from '../lib/scheduleService';
import { consumeScheduleEventDetailHandoff, peekScheduleEventDetailHandoff } from '../lib/scheduleEventDetailHandoff';
import { exportCalendarIcsFile } from '../lib/publicActions';
import { buildParentScheduleEventIcs } from '../lib/parentToolsService';
import { type AppServiceError, toAppServiceError } from '../lib/appErrors';
import { clearLazyChunkReloadAttempt, handleLazyPageLoadError } from '../lib/lazyPage';
import { useAsyncOperation } from '../lib/useAsyncOperation';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { EventDetailPageSkeleton } from '../components/PageSkeletons';
import { AssignmentsSection } from '../components/schedule/AssignmentsSection';
import { CompactMeta } from '../components/schedule/CompactMeta';
import { EventDetailsPanel } from '../components/schedule/EventDetailsPanel';
import { ScheduleEventHeader } from '../components/schedule/ScheduleEventHeader';
import { EventSectionNav } from '../components/schedule/EventSectionNav';
import { PlayerSwitcher } from '../components/schedule/PlayerSwitcher';
import { RideshareSection } from '../components/schedule/RideshareSection';
import { Status } from '../components/schedule/ScheduleStatus';
import { StaffRsvpBreakdownPanel } from '../components/schedule/StaffRsvpBreakdownPanel';
import { StaffRsvpReminderPanel } from '../components/schedule/StaffRsvpReminderPanel';
import { AttentionPanel, type AttentionItem, type ScheduleEventDetailSectionId } from '../components/schedule/AttentionPanel';
import { AvailabilityNotesList } from '../components/schedule/AvailabilityNotesList';
import {
  QuickAvailabilityPanel,
  ReadOnlyAvailabilityPanel,
  TeamRsvpToolsDisclosure,
  formatRsvpSummary,
  getAvailabilityNoteSaveState,
  rsvpBadgeClasses,
  rsvpLabels
} from '../components/schedule/AvailabilityPanels';
import {
  formatEventDateLabel,
  formatEventTimeLabel,
  getScheduleMapHref,
  getScheduleForecastHref,
  getScheduleLocationLabel,
  canSubmitScheduleEventRsvp,
  getScheduleEventRsvpCapability,
  isScheduleAssignmentOpen,
  getScheduleTitle,
  normalizeRsvpResponse,
  type ParentScheduleEvent,
  type PracticePacketCompletion,
  type RsvpResponse
} from '../lib/scheduleLogic';
import { completeParentCoreWorkflowTimer } from '../lib/parentWorkflowTiming';
import type { PracticeFeedItem } from '../lib/gameWrapupService';
import type { AuthState } from '../lib/types';
import { ScheduleEventDetailProvider, useScheduleEventDetailContext } from './schedule/ScheduleEventDetailContext';
import { useScheduleEventRsvp } from '../hooks/schedule/useScheduleEventRsvp';
import { useStaffRsvpBreakdown } from '../hooks/schedule/useStaffRsvpBreakdown';
import type { GameHubPanelId } from './schedule/ScheduleGameHubSection';

export { getAvailabilityNoteSaveState } from '../components/schedule/AvailabilityPanels';

type EventDetailSectionId = ScheduleEventDetailSectionId;

const eventDetailSectionIds = new Set<EventDetailSectionId>(['availability', 'rideshare', 'assignments', 'game']);
const gameHubPanelIds = new Set<GameHubPanelId>(['foul', 'chat', 'reactions', 'wrapup', 'statsheet', 'lineup', 'substitutions', 'report']);

function parseRequestedEventDetailSection(section: string | null | undefined): EventDetailSectionId | null {
  const normalized = String(section || '').trim().toLowerCase();
  if (normalized && eventDetailSectionIds.has(normalized as EventDetailSectionId)) {
    return normalized as EventDetailSectionId;
  }
  return null;
}

export function parseEventDetailSection(section: string | null | undefined): EventDetailSectionId {
  return parseRequestedEventDetailSection(section) || 'availability';
}

export function parseGameHubPanel(panel: string | null | undefined): GameHubPanelId | null {
  const normalized = String(panel || '').trim().toLowerCase();
  if (normalized && gameHubPanelIds.has(normalized as GameHubPanelId)) {
    return normalized as GameHubPanelId;
  }
  return null;
}

function isActiveTrackedScheduleEvent(event?: ParentScheduleEvent | null) {
  return Boolean(event?.isDbGame && !event?.isCancelled);
}

function getDefaultEventDetailSection(event?: ParentScheduleEvent | null) {
  if (isActiveTrackedScheduleEvent(event) && event?.canUpdateScore) {
    return 'game';
  }
  if (event && canSubmitScheduleEventRsvp(event)) {
    return 'availability';
  }
  return 'game';
}

function hasRideshareActivity(event?: ParentScheduleEvent | null) {
  const summary = event?.rideshareSummary;
  if (!summary) return false;
  return [summary.offerCount, summary.requests, summary.pending, summary.confirmed, summary.seatsLeft]
    .some((value) => Number(value || 0) > 0);
}

function hasAssignmentsPosted(event?: ParentScheduleEvent | null) {
  return Array.isArray(event?.assignments) && event.assignments.length > 0;
}

function canManageEventAssignments(event?: ParentScheduleEvent | null) {
  return event?.isTeamAdmin === true;
}

function getEventDetailSections(event?: ParentScheduleEvent | null): Array<{ id: EventDetailSectionId; label: string; shortLabel?: string }> {
  const eventLabel = event?.type === 'practice' ? 'More' : 'Game';
  const sections: Array<{ id: EventDetailSectionId; label: string; shortLabel?: string }> = [
    { id: 'availability', label: 'Availability' }
  ];

  if (isActiveTrackedScheduleEvent(event) || hasRideshareActivity(event)) {
    sections.push({ id: 'rideshare', label: 'Rideshare' });
  }

  if (isActiveTrackedScheduleEvent(event) || hasAssignmentsPosted(event) || canManageEventAssignments(event)) {
    sections.push({ id: 'assignments', label: 'Assignments', shortLabel: 'Tasks' });
  }

  sections.push({ id: 'game', label: eventLabel });
  return sections;
}

function getScheduleEventDetailLoadErrorMessage(error: AppServiceError, hasExistingEvent: boolean) {
  if (hasExistingEvent) {
    if (error.type === 'network') return 'Unable to refresh this event while offline. Showing the last loaded details.';
    if (error.type === 'permission') return 'Unable to refresh this event because access was denied. Showing the last loaded details.';
    if (error.type === 'not_found') return 'Unable to refresh this event because it is no longer available. Showing the last loaded details.';
    if (error.type === 'validation') return error.message;
    return 'Unable to refresh this event. Showing the last loaded details. Try again.';
  }
  if (error.type === 'network') return 'Unable to load this event while offline. Check your connection and try again.';
  if (error.type === 'permission') return 'You do not have permission to view this event.';
  if (error.type === 'not_found') return 'This event is not available for your account.';
  if (error.type === 'validation') return error.message;
  return error.message || 'Unable to load event details.';
}

type ScheduleGameHubSectionModule = typeof import('./schedule/ScheduleGameHubSection');

let scheduleGameHubSectionPromise: Promise<ScheduleGameHubSectionModule> | null = null;
let scheduleGameHubSectionImporter = () => import('./schedule/ScheduleGameHubSection');

export function loadScheduleGameHubSection() {
  if (!scheduleGameHubSectionPromise) {
    scheduleGameHubSectionPromise = Promise.resolve()
      .then(scheduleGameHubSectionImporter)
      .then((module) => {
        clearLazyChunkReloadAttempt();
        return module;
      })
      .catch((error) => {
        scheduleGameHubSectionPromise = null;
        return handleLazyPageLoadError(error) as unknown as Promise<ScheduleGameHubSectionModule>;
      });
  }
  return scheduleGameHubSectionPromise;
}

function resetScheduleGameHubSectionLoader() {
  scheduleGameHubSectionPromise = null;
}

export function setScheduleGameHubSectionImporterForTest(importer?: () => Promise<ScheduleGameHubSectionModule>) {
  resetScheduleGameHubSectionLoader();
  scheduleGameHubSectionImporter = importer || (() => import('./schedule/ScheduleGameHubSection'));
}

function createLazyScheduleGameHubSection() {
  return lazy(() => (
    loadScheduleGameHubSection().then((module) => ({ default: module.ScheduleGameHubSection }))
  ));
}

let LazyScheduleGameHubSection = createLazyScheduleGameHubSection();

export function ScheduleEventDetail({ auth }: { auth: AuthState }) {
  const { teamId = '', eventId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const decodedTeamId = decodeURIComponent(teamId);
  const decodedEventId = decodeURIComponent(eventId);
  const [GameHubSection, setGameHubSection] = useState(() => LazyScheduleGameHubSection);
  const retryScheduleGameHubSection = useCallback(() => {
    resetScheduleGameHubSectionLoader();
    LazyScheduleGameHubSection = createLazyScheduleGameHubSection();
    setGameHubSection(LazyScheduleGameHubSection);
  }, []);
  const initialHandoffScopeRef = useRef({
    userId: auth.user?.uid || '',
    teamId: decodedTeamId,
    eventId: decodedEventId
  });
  const initialHandoffRef = useRef(
    auth.user?.uid
      ? peekScheduleEventDetailHandoff(auth.user.uid, decodedTeamId, decodedEventId)
      : null
  );
  const initialHandoffAppliedRef = useRef(false);
  const [events, setEvents] = useState<ParentScheduleEvent[]>(() => initialHandoffRef.current?.events || []);
  const [selectedChildId, setSelectedChildId] = useState(searchParams.get('childId') || '');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<EventDetailSectionId | null>(() => (
    searchParams.has('section') ? parseEventDetailSection(searchParams.get('section')) : null
  ));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [availabilityNote, setAvailabilityNote] = useState('');
  const [initialLoadPending, setInitialLoadPending] = useState(() => !initialHandoffRef.current);
  const hasLoadedEventRef = useRef(Boolean(initialHandoffRef.current?.events.length));
  const loadGenerationRef = useRef(0);
  const { loading, error, clearError, setError, run: runPrimaryLoad } = useAsyncOperation();

  const replaceEventRouteParams = (updates: { section?: EventDetailSectionId; childId?: string; panel?: GameHubPanelId | null }) => {
    const nextParams = new URLSearchParams(searchParams);
    if (updates.section) {
      nextParams.set('section', updates.section);
      if (updates.section !== 'game') nextParams.delete('panel');
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'childId')) {
      const nextChildId = String(updates.childId || '').trim();
      if (nextChildId) {
        nextParams.set('childId', nextChildId);
      } else {
        nextParams.delete('childId');
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'panel')) {
      if (updates.panel) {
        nextParams.set('panel', updates.panel);
      } else {
        nextParams.delete('panel');
      }
    }
    setSearchParams(nextParams, { replace: true });
  };

  const selectSection = (sectionId: EventDetailSectionId) => {
    setActiveSection(sectionId);
    replaceEventRouteParams({ section: sectionId });
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const selectChild = (childId: string) => {
    setSelectedChildId(childId);
    replaceEventRouteParams({ childId });
  };

  const selectGameHubPanel = (panel: GameHubPanelId | null) => {
    setActiveSection('game');
    replaceEventRouteParams({ section: 'game', panel });
  };

  const applyLoadedEvent = useCallback((result: ParentScheduleLoadResult, loadGeneration: number) => {
    setEvents(result.events);
    hasLoadedEventRef.current = result.events.length > 0;
    if (!selectedChildId && result.events[0]?.childId) {
      setSelectedChildId(result.events[0].childId);
    }
    const optionalBaselines = new Map(result.events.map((event) => [event.eventKey, {
      rideshareSummary: event.rideshareSummary,
      assignments: event.assignments,
      openAssignmentCount: event.openAssignmentCount,
      assignmentClaimsHydrated: event.assignmentClaimsHydrated
    }]));
    const optionalSnapshot = {
      ...result,
      events: result.events.map((event) => ({ ...event }))
    };
    void hydrateParentScheduleEventOptionalDetails(optionalSnapshot).then((hydrated) => {
      if (loadGenerationRef.current !== loadGeneration) return;
      const hydratedByKey = new Map(hydrated.events.map((event) => [event.eventKey, event]));
      setEvents((current) => current.map((event) => {
        const optionalBaseline = optionalBaselines.get(event.eventKey);
        const hydratedEvent = hydratedByKey.get(event.eventKey);
        if (!optionalBaseline || !hydratedEvent) return event;
        return {
          ...event,
          ...(event.rideshareSummary === optionalBaseline.rideshareSummary
            ? { rideshareSummary: hydratedEvent.rideshareSummary }
            : {}),
          ...(event.assignments === optionalBaseline.assignments
            && event.openAssignmentCount === optionalBaseline.openAssignmentCount
            && event.assignmentClaimsHydrated === optionalBaseline.assignmentClaimsHydrated
            ? {
              assignments: hydratedEvent.assignments,
              openAssignmentCount: hydratedEvent.openAssignmentCount,
              assignmentClaimsHydrated: hydratedEvent.assignmentClaimsHydrated
            }
            : {})
        };
      }));
    }).catch(() => undefined);
  }, [selectedChildId]);

  const loadEvent = useCallback(async () => {
    const loadGeneration = ++loadGenerationRef.current;
    if (!auth.user) {
      setInitialLoadPending(false);
      return;
    }
    setStatusMessage(null);
    clearError();
    const hasExistingEvent = hasLoadedEventRef.current;
    try {
      await runPrimaryLoad(
        () => loadParentScheduleEventDetail(auth.user, { teamId: decodedTeamId, eventId: decodedEventId }),
        {
          getErrorMessage: (loadError) => getScheduleEventDetailLoadErrorMessage(
            toAppServiceError(loadError, 'Unable to load event details.'),
            hasExistingEvent
          ),
          rethrow: false,
          onSuccess: (result) => {
            applyLoadedEvent(result, loadGeneration);
          },
          onError: () => {
            if (!hasExistingEvent) {
              setEvents([]);
              hasLoadedEventRef.current = false;
            }
          }
        }
      );
    } finally {
      setInitialLoadPending(false);
    }
  }, [applyLoadedEvent, auth.user, clearError, decodedEventId, decodedTeamId, runPrimaryLoad]);

  useEffect(() => {
    hasLoadedEventRef.current = false;
    const initialHandoffScope = initialHandoffScopeRef.current;
    if (
      initialHandoffRef.current
      && initialHandoffScope.userId === auth.user?.uid
      && initialHandoffScope.teamId === decodedTeamId
      && initialHandoffScope.eventId === decodedEventId
    ) {
      hasLoadedEventRef.current = initialHandoffRef.current.events.length > 0;
      if (!initialHandoffAppliedRef.current) {
        consumeScheduleEventDetailHandoff(auth.user.uid, decodedTeamId, decodedEventId);
        const loadGeneration = ++loadGenerationRef.current;
        applyLoadedEvent(initialHandoffRef.current, loadGeneration);
        initialHandoffAppliedRef.current = true;
        setInitialLoadPending(false);
      }
      return;
    }
    initialHandoffRef.current = null;
    const handedOffDetail = auth.user?.uid
      ? consumeScheduleEventDetailHandoff(auth.user.uid, decodedTeamId, decodedEventId)
      : null;
    if (handedOffDetail) {
      const loadGeneration = ++loadGenerationRef.current;
      applyLoadedEvent(handedOffDetail, loadGeneration);
      setInitialLoadPending(false);
      return;
    }
    // Warm-start from cached parent schedule data when the same event was just
    // rendered in Schedule/Home, so in-app navigation shows content immediately
    // and only true cold loads fall back to the full-page skeleton (#2649).
    const cachedEvents = auth.user?.uid
      ? resolveCachedParentScheduleEvents(auth.user.uid, decodedTeamId, decodedEventId)
      : [];
    if (cachedEvents.length > 0) {
      setEvents(cachedEvents);
      hasLoadedEventRef.current = true;
      if (!selectedChildId && cachedEvents[0]?.childId) {
        setSelectedChildId(cachedEvents[0].childId);
      }
      setInitialLoadPending(false);
    } else {
      setEvents([]);
      hasLoadedEventRef.current = false;
      setInitialLoadPending(true);
    }
    void loadEvent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, decodedTeamId, decodedEventId]);

  useEffect(() => {
    setActiveSection(searchParams.has('section') ? parseEventDetailSection(searchParams.get('section')) : null);
    const routeChildId = searchParams.get('childId') || '';
    if (routeChildId) {
      setSelectedChildId(routeChildId);
    }
  }, [searchParams]);

  const selectedEvent = useMemo(() => {
    if (!events.length) return null;
    return events.find((event) => event.childId === selectedChildId) || events[0];
  }, [events, selectedChildId]);

  useLayoutEffect(() => {
    setAvailabilityNote(selectedEvent?.myRsvpNote || '');
  }, [selectedEvent?.eventKey, selectedEvent?.myRsvpNote]);

  useEffect(() => {
    if (!selectedEvent || loading || initialLoadPending) return;
    completeParentCoreWorkflowTimer('schedule_event', {
      targetPage: 'schedule_event',
      teamId: decodedTeamId,
      eventId: decodedEventId,
      playerId: selectedEvent.childId || '',
      eventType: selectedEvent.type,
      section: searchParams.get('section') || '',
      completedRoute: `/schedule/${decodedTeamId}/${decodedEventId}`
    });
  }, [decodedEventId, decodedTeamId, initialLoadPending, loading, searchParams, selectedEvent]);

  const updateEvents = useCallback((updater: (current: ParentScheduleEvent[]) => ParentScheduleEvent[]) => {
    setEvents((current) => updater(current));
  }, []);

  const handleScoreUpdated = useCallback((homeScore: number, awayScore: number) => {
    setEvents((current) => current.map((event) => (
      event.teamId === decodedTeamId && event.id === decodedEventId
        ? { ...event, homeScore, awayScore }
        : event
    )));
  }, [decodedEventId, decodedTeamId]);

  const handleLiveClockUpdated = useCallback((payload: Partial<ParentScheduleEvent> & { period?: string | null }) => {
    setEvents((current) => current.map((event) => (
      event.teamId === decodedTeamId && event.id === decodedEventId
        ? { ...event, ...payload }
        : event
    )));
  }, [decodedEventId, decodedTeamId]);

  const handleGameCancelled = useCallback(() => {
    setEvents((current) => current.map((event) => (
      event.teamId === decodedTeamId && event.id === decodedEventId
        ? { ...event, status: 'cancelled', isCancelled: true, availabilityLocked: true }
        : event
    )));
  }, [decodedEventId, decodedTeamId]);

  const handlePracticeOccurrenceCancelled = useCallback(() => {
    setEvents((current) => current.map((event) => (
      event.teamId === decodedTeamId && event.id === decodedEventId
        ? { ...event, status: 'cancelled', isCancelled: true, availabilityLocked: true }
        : event
    )));
  }, [decodedEventId, decodedTeamId]);

  const handleGamePlanPublished = useCallback((gamePlan: Record<string, any>) => {
    setEvents((current) => current.map((event) => (
      event.teamId === decodedTeamId && event.id === decodedEventId
        ? { ...event, gamePlan }
        : event
    )));
  }, [decodedEventId, decodedTeamId]);

  const handleWrapupCompleted = useCallback((payload: { homeScore: number; awayScore: number; postGameNotes: string; summary: string; practiceFeedItems: PracticeFeedItem[] }) => {
    setEvents((current) => current.map((event) => (
      event.teamId === decodedTeamId && event.id === decodedEventId
        ? {
          ...event,
          homeScore: payload.homeScore,
          awayScore: payload.awayScore,
          postGameNotes: payload.postGameNotes,
          summary: payload.summary,
          practiceFeedItems: payload.practiceFeedItems,
          status: 'completed',
          liveStatus: 'completed'
        }
        : event
    )));
  }, [decodedEventId, decodedTeamId]);

  const handleStatsheetImported = useCallback((payload: { homeScore: number; awayScore: number; statSheetPhotoUrl?: string | null }) => {
    setEvents((current) => current.map((event) => (
      event.teamId === decodedTeamId && event.id === decodedEventId
        ? {
          ...event,
          homeScore: payload.homeScore,
          awayScore: payload.awayScore,
          status: 'completed',
          liveStatus: 'completed',
          ...(payload.statSheetPhotoUrl ? { statSheetPhotoUrl: payload.statSheetPhotoUrl } : {})
        }
        : event
    )));
  }, [decodedEventId, decodedTeamId]);

  // Keep the full-page skeleton for cold loads only; once a cached or fetched
  // event is available, render it and let the background refresh reconcile (#2649).
  if ((loading || initialLoadPending) && !selectedEvent) {
    return <EventDetailPageSkeleton />;
  }

  if (!selectedEvent) {
    return (
      <div className="space-y-3">
        <Link to="/schedule" className="ghost-button min-h-9 px-3 text-xs">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Schedule
        </Link>
        <Status tone="error" message={error || 'This event is not available for your account.'} />
        {error ? (
          <button
            type="button"
            className="secondary-button min-h-9 w-fit px-3 text-xs"
            onClick={() => void loadEvent()}
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  const rsvp = normalizeRsvpResponse(selectedEvent.myRsvp);
  const rsvpCapability = getScheduleEventRsvpCapability(selectedEvent);
  const rsvpPresentation = rsvpCapability === 'calendar_only'
    ? { label: 'Calendar only', className: 'border-gray-200 bg-gray-100 text-gray-700' }
    : rsvpCapability === 'locked'
      ? { label: 'Availability closed', className: 'border-gray-200 bg-gray-100 text-gray-700' }
      : rsvpCapability === 'cancelled'
        ? { label: 'Cancelled', className: 'border-rose-200 bg-rose-50 text-rose-700' }
        : rsvpCapability === 'untracked'
          ? { label: 'Availability unavailable', className: 'border-gray-200 bg-gray-100 text-gray-700' }
          : { label: rsvpLabels[rsvp], className: rsvpBadgeClasses[rsvp] };
  const title = getScheduleTitle(selectedEvent);
  const hasPracticePacket = selectedEvent.type === 'practice' && Boolean(selectedEvent.practiceHomePacketSummary);
  const attentionItems = getAttentionItems(selectedEvent, rsvp).filter((item) => item.section !== 'availability' && item.title !== 'Practice packet ready');
  const sections = getEventDetailSections(selectedEvent);
  const sectionIds = new Set(sections.map((section) => section.id));
  const defaultSection = getDefaultEventDetailSection(selectedEvent);
  const resolvedActiveSection = activeSection && sectionIds.has(activeSection)
    ? activeSection
    : sectionIds.has(defaultSection)
      ? defaultSection
      : sections[0]?.id || 'availability';
  const requestedGameHubPanel = resolvedActiveSection === 'game'
    ? parseGameHubPanel(searchParams.get('panel'))
    : null;

  const addEventToCalendar = async () => {
    const icsTitle = `${title} | ${selectedEvent.teamName}`;
    const fileDate = selectedEvent.date.toISOString().slice(0, 10);
    const filename = `${selectedEvent.teamName}-${title}-${fileDate}.ics`;
    setError(null);
    setStatusMessage(null);
    try {
      const result = await exportCalendarIcsFile(
        filename,
        buildParentScheduleEventIcs(selectedEvent, icsTitle)
      );
      setStatusMessage(result === 'shared' ? 'Calendar file ready to share.' : 'Add to Calendar download started.');
    } catch (calendarError: any) {
      setError(calendarError?.message || 'Unable to export the calendar file. Try again or use another calendar option.');
    }
  };

  return (
    <ScheduleEventDetailProvider value={{
      auth,
      event: selectedEvent,
      childEvents: events,
      refreshEvent: () => void loadEvent(),
      updateEvents
    }}>
      <div className="event-detail-page space-y-3">
      <aside className="event-detail-rail space-y-3">
        <section className="event-summary-card app-card overflow-hidden p-0">
          <div className="event-summary-shell px-3 py-1.5 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <Link to="/schedule" className="inline-flex min-h-8 w-fit items-center gap-1 rounded-full text-xs font-black text-gray-600 transition hover:text-primary-700">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Schedule
              </Link>
              <button
                type="button"
                className="event-details-toggle inline-flex min-h-8 flex-none items-center gap-1 rounded-full border border-gray-200 bg-white px-3 text-xs font-black text-gray-700 shadow-sm transition hover:border-primary-200 hover:text-primary-700"
                onClick={() => setDetailsOpen((current) => !current)}
                aria-expanded={detailsOpen}
              >
                Details
                <ChevronDown className={`h-3.5 w-3.5 transition ${detailsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
            </div>

            <ScheduleEventHeader
              date={selectedEvent.date}
              teamName={selectedEvent.teamName}
              eventType={selectedEvent.type}
              title={title}
              timeLabel={formatHeroTime(selectedEvent)}
              location={selectedEvent.location || 'Location TBD'}
              locationDetail={selectedEvent.locationDetail}
              playerSummary={events.length > 1 ? (
                <>
                  <PlayerSwitcher events={events} selectedChildId={selectedEvent.childId} onSelect={selectChild} compact />
                  <div className="mt-1 truncate text-xs font-bold text-gray-600">{selectedEvent.childName} · {selectedEvent.teamName}</div>
                </>
              ) : (
                <CompactMeta icon={Users} value={`${selectedEvent.childName} · ${selectedEvent.teamName}`} />
              )}
              rsvpLabel={rsvpPresentation.label}
              rsvpClassName={rsvpPresentation.className}
              briefPieces={getEventBriefPieces(selectedEvent)}
            />
            <button
              type="button"
              className="secondary-button event-calendar-button mt-1.5 w-full justify-center sm:mt-2"
              onClick={addEventToCalendar}
            >
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              Add to Calendar
            </button>
            {hasPracticePacket ? <PracticePacketPrompt event={selectedEvent} onOpen={() => selectSection('game')} /> : null}
            <EventSectionNav
              className="event-workflow-nav event-nav-desktop mt-3"
              includeBaseClass={false}
              sections={sections}
              activeSection={resolvedActiveSection}
              hasPracticePacket={hasPracticePacket}
              onSelect={selectSection}
            />
            <div className="event-details-mobile">
              <EventDetailsPanel event={selectedEvent} open={detailsOpen} />
            </div>
            <div className="event-details-desktop">
              <EventDetailsPanel event={selectedEvent} open />
            </div>
          </div>
        </section>

        <EventSectionNav
          className="event-nav-mobile sticky top-24 z-30 w-full max-w-full bg-gray-50/95 py-1 backdrop-blur sm:py-2"
          sections={sections}
          activeSection={resolvedActiveSection}
          hasPracticePacket={hasPracticePacket}
          onSelect={selectSection}
        />
      </aside>

      <div className="event-detail-content space-y-3">
        {statusMessage ? <Status tone="success" message={statusMessage} /> : null}
        {error ? <Status tone="error" message={error} /> : null}

        {resolvedActiveSection === 'availability' ? (
          <AvailabilitySection
            event={selectedEvent}
            rsvp={rsvp}
            availabilityNote={availabilityNote}
            onAvailabilityNoteChange={setAvailabilityNote}
            attentionItems={attentionItems}
            onSelectSection={selectSection}
            onEventMaterialized={(trackedEventId) => {
              const childId = String(selectedEvent.childId || '').trim();
              const query = new URLSearchParams();
              if (childId) query.set('childId', childId);
              query.set('section', 'availability');
              navigate(`/schedule/${encodeURIComponent(selectedEvent.teamId)}/${encodeURIComponent(trackedEventId)}?${query.toString()}`);
            }}
          />
        ) : null}
        {resolvedActiveSection === 'rideshare' ? <RideshareSection /> : null}
        {resolvedActiveSection === 'assignments' ? <AssignmentsSection /> : null}
        {resolvedActiveSection === 'game' ? (
          <ErrorBoundary name="schedule-game-hub" onRetry={retryScheduleGameHubSection}>
            <Suspense fallback={(
              <div
                className="min-h-40 rounded-2xl border border-gray-200 bg-white p-4 text-sm font-semibold text-gray-500 shadow-sm"
                data-testid="schedule-game-hub-loading"
              >
                Loading Game hub...
              </div>
            )}>
              <GameHubSection
                key={selectedEvent.eventKey}
                auth={auth}
                event={selectedEvent}
                childEvents={events}
                requestedPanel={requestedGameHubPanel}
                onPanelChange={selectGameHubPanel}
                onScoreUpdated={handleScoreUpdated}
                onLiveClockUpdated={handleLiveClockUpdated}
                onWrapupCompleted={handleWrapupCompleted}
                onStatsheetImported={handleStatsheetImported}
                onGameCancelled={handleGameCancelled}
                onPracticeOccurrenceCancelled={handlePracticeOccurrenceCancelled}
                onGamePlanPublished={handleGamePlanPublished}
              />
            </Suspense>
          </ErrorBoundary>
        ) : null}
      </div>
      </div>
    </ScheduleEventDetailProvider>
  );
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0');
}

function PracticePacketPrompt({ event, onOpen }: { event: ParentScheduleEvent; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-100"
      onClick={onOpen}
      aria-label="Practice packet ready, review packet"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white text-blue-700">
          <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-black text-gray-950">Practice packet ready</span>
          <span className="mt-0.5 block truncate text-xs font-semibold text-blue-800">{event.practiceHomePacketSummary}</span>
        </span>
      </span>
      <span className="flex-none rounded-full bg-white px-3 py-1 text-xs font-black text-blue-700">Review</span>
    </button>
  );
}

function AvailabilitySection({ event, rsvp, availabilityNote, onAvailabilityNoteChange, attentionItems, onSelectSection, onEventMaterialized }: {
  event: ParentScheduleEvent;
  rsvp: RsvpResponse;
  availabilityNote: string;
  onAvailabilityNoteChange: (note: string) => void;
  attentionItems: AttentionItem[];
  onSelectSection: (sectionId: EventDetailSectionId) => void;
  onEventMaterialized: (trackedEventId: string) => void;
}) {
  const { auth, childEvents } = useScheduleEventDetailContext();
  const [materializing, setMaterializing] = useState(false);
  const [materializationError, setMaterializationError] = useState('');
  const matchingChildEvents = childEvents.filter((childEvent) => (
    childEvent.teamId === event.teamId && childEvent.id === event.id && Boolean(childEvent.childId) && childEvent.isLinkedParentChild === true
  ));
  const savedNotesDiffer = new Set(matchingChildEvents.map((childEvent) => String(childEvent.myRsvpNote || '').trim())).size > 1;
  const [individualMode, setIndividualMode] = useState(savedNotesDiffer);
  const [sharedNoteExplicitlyChosen, setSharedNoteExplicitlyChosen] = useState(!savedNotesDiffer);
  useEffect(() => {
    setIndividualMode(savedNotesDiffer);
    setSharedNoteExplicitlyChosen(!savedNotesDiffer);
  }, [event.id, event.teamId, savedNotesDiffer]);
  const familyRsvpAvailable = event.isLinkedParentChild === true && matchingChildEvents.length > 1 && matchingChildEvents.every((childEvent) => (
    childEvent.isDbGame && !childEvent.isCancelled && !childEvent.availabilityLocked
  ));
  const useFamilyRsvp = familyRsvpAvailable && !individualMode;
  const familyResponses = new Set(matchingChildEvents.map((childEvent) => normalizeRsvpResponse(childEvent.myRsvp)));
  const visibleRsvp = useFamilyRsvp && familyResponses.size === 1
    ? normalizeRsvpResponse(matchingChildEvents[0]?.myRsvp)
    : useFamilyRsvp
      ? 'not_responded'
      : rsvp;
  const familyNames = matchingChildEvents.map((childEvent) => childEvent.childName).filter(Boolean);
  const familyQuestion = familyNames.length === 2
    ? `Are ${familyNames[0]} and ${familyNames[1]} going?`
    : `Are all ${familyNames.length} children going?`;
  const rsvpWorkflow = useScheduleEventRsvp({ availabilityNote, applyToAllChildren: useFamilyRsvp, sharedNoteExplicitlyChosen });
  const staffRsvpEventScopeKey = `${event.teamId}:${event.id}`;
  const staffRsvpLoader = useMemo(() => createStaffRsvpAvailabilityLoader(staffRsvpEventScopeKey), [staffRsvpEventScopeKey]);
  const staffRsvp = useStaffRsvpBreakdown(staffRsvpLoader);
  const showTeamRsvpTools = event.isDbGame && Boolean(event.isTeamAdmin || event.isTeamRsvpReminderManager);
  const rsvpCapability = getScheduleEventRsvpCapability(event);
  const isCalendarOnly = rsvpCapability === 'calendar_only';
  const availabilityPresentation = rsvpCapability === 'calendar_only'
    ? { label: 'Calendar only', className: 'border-gray-200 bg-gray-100 text-gray-700' }
    : rsvpCapability === 'locked'
      ? { label: 'Closed', className: 'border-gray-200 bg-gray-100 text-gray-700' }
      : rsvpCapability === 'cancelled'
        ? { label: 'Cancelled', className: 'border-rose-200 bg-rose-50 text-rose-700' }
        : rsvpCapability === 'untracked'
          ? { label: 'Unavailable', className: 'border-gray-200 bg-gray-100 text-gray-700' }
          : { label: rsvpLabels[visibleRsvp], className: rsvpBadgeClasses[visibleRsvp] };
  const availabilitySummary = showTeamRsvpTools ? (staffRsvp.breakdown?.counts || event.rsvpSummary) : event.rsvpSummary;

  return (
    <section className="app-card overflow-hidden p-0">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <h2 className="app-section-title">Availability</h2>
          <div className="mt-0.5 text-xs font-semibold text-gray-500">{formatRsvpSummary(availabilitySummary)}</div>
        </div>
        <span className={`mt-0.5 inline-flex min-h-6 flex-none items-center rounded-full border px-2 text-[11px] font-extrabold uppercase tracking-[0.04em] ${availabilityPresentation.className}`}>
          {availabilityPresentation.label}
        </span>
      </div>
      {familyRsvpAvailable ? (
        <div data-testid="family-rsvp-controls" className="flex flex-wrap items-center justify-between gap-2 border-b border-primary-100 bg-primary-50 px-3 py-2.5 sm:px-4">
          <div className="min-w-0">
            <div className="text-xs font-black text-primary-900">{useFamilyRsvp ? 'Family response' : `Responding for ${event.childName}`}</div>
            <div className="mt-0.5 text-xs font-semibold text-primary-700">
              {useFamilyRsvp
                ? savedNotesDiffer
                  ? 'Choose one shared note before responding together.'
                  : `One choice updates ${familyNames.join(' and ')}.`
                : savedNotesDiffer
                  ? 'Saved notes differ, so responses start separately. Use the player switcher above to choose a child.'
                  : 'Use the player switcher above to choose a child.'}
            </div>
          </div>
          <button
            type="button"
            className="min-h-8 rounded-full border border-primary-200 bg-white px-3 text-xs font-black text-primary-700 transition hover:border-primary-300 hover:bg-primary-100"
            onClick={() => {
              if (useFamilyRsvp) {
                setIndividualMode(true);
                return;
              }
              if (savedNotesDiffer) {
                onAvailabilityNoteChange('');
                setSharedNoteExplicitlyChosen(false);
              }
              setIndividualMode(false);
            }}
          >
            {useFamilyRsvp ? 'Set individually' : 'Respond together'}
          </button>
        </div>
      ) : null}
      {rsvpWorkflow.canSubmit ? (
        <>
          {rsvpWorkflow.requiresSharedNoteChoice ? (
            <div className="border-b border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-900 sm:px-4">
              Enter a shared note below, or{' '}
              <button
                type="button"
                className="font-black underline underline-offset-2"
                onClick={() => setSharedNoteExplicitlyChosen(true)}
              >
                use no shared note
              </button>.
            </div>
          ) : null}
          <QuickAvailabilityPanel
            event={event}
            rsvp={visibleRsvp}
            canSubmitRsvp={!rsvpWorkflow.requiresSharedNoteChoice}
            canEditAvailabilityNote={rsvpWorkflow.canSubmit}
            submitting={rsvpWorkflow.submitting}
            availabilityNote={availabilityNote}
            onAvailabilityNoteChange={(note) => {
              onAvailabilityNoteChange(note);
              if (useFamilyRsvp && savedNotesDiffer) setSharedNoteExplicitlyChosen(true);
            }}
            onSubmit={rsvpWorkflow.submit}
            question={useFamilyRsvp ? familyQuestion : undefined}
          />
        </>
      ) : (
        <>
          <ReadOnlyAvailabilityPanel event={event} rsvp={visibleRsvp} />
          {isCalendarOnly ? (
            <div className="border-b border-gray-200 bg-white px-3 py-3 sm:px-4">
              {event.isTeamAdmin ? (
                <>
                  <p className="text-sm font-semibold leading-5 text-gray-600">Create a tracked copy of this event so families can respond. The imported calendar entry will be hidden after the tracked copy loads.</p>
                  <button
                    type="button"
                    className="secondary-button mt-3 !min-h-11 text-sm"
                    disabled={materializing}
                    onClick={async () => {
                      const eventLabel = event.type === 'practice' ? 'practice' : 'game';
                      if (!window.confirm(`Enable RSVP for this imported ${eventLabel}? This adds a tracked copy to the team schedule so families can respond.`)) return;
                      setMaterializationError('');
                      setMaterializing(true);
                      try {
                        const trackedEventId = await enableRsvpForImportedCalendarEvent(event, auth.user);
                        onEventMaterialized(trackedEventId);
                      } catch (nextError: any) {
                        setMaterializationError(nextError?.message || 'Unable to enable RSVP for this event.');
                      } finally {
                        setMaterializing(false);
                      }
                    }}
                  >
                    {materializing ? 'Enabling RSVP…' : 'Enable RSVP'}
                  </button>
                </>
              ) : (
                <p className="text-sm font-semibold leading-5 text-gray-600">Ask a team owner or admin to enable RSVP for this event.</p>
              )}
              {materializationError ? <div className="mt-2"><Status tone="error" message={materializationError} /></div> : null}
            </div>
          ) : null}
        </>
      )}
      <div className="px-3 pb-3 sm:px-4">
        {rsvpWorkflow.message ? <Status tone="success" message={rsvpWorkflow.message} /> : null}
        {rsvpWorkflow.error ? <div className="mt-2"><Status tone="error" message={rsvpWorkflow.error} /></div> : null}
        {attentionItems.length > 0 || visibleRsvp !== 'not_responded' ? (
          <AttentionPanel items={attentionItems} onSelectSection={onSelectSection} />
        ) : null}
        {showTeamRsvpTools ? (
          <TeamRsvpToolsDisclosure key={event.eventKey} summary={availabilitySummary}>
            <StaffRsvpBreakdownPanel
              breakdown={staffRsvp.breakdown}
              loading={staffRsvp.loading}
              error={staffRsvp.error}
              submittingPlayerId={staffRsvp.submittingPlayerId}
              status={staffRsvp.status}
              onOverride={staffRsvp.submitOverride}
            />
            <StaffRsvpReminderPanel refreshToken={staffRsvp.refreshToken} staffRsvpLoader={staffRsvpLoader} />
            <AvailabilityNotesList event={event} />
          </TeamRsvpToolsDisclosure>
        ) : (
          <AvailabilityNotesList event={event} />
        )}
      </div>
    </section>
  );
}


function formatAssignment(assignment?: { role?: string; value?: string; claim?: { claimedByName?: string } | null }) {
  if (!assignment) return 'None posted';
  if (assignment.claim?.claimedByName) return `${assignment.role || 'Role'}: ${assignment.claim.claimedByName}`;
  if (assignment.value) return `${assignment.role || 'Role'}: ${assignment.value}`;
  if (assignment.role) return `${assignment.role}: Open`;
  return 'None posted';
}

function getAttentionItems(event: ParentScheduleEvent, rsvp: RsvpResponse): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (canSubmitScheduleEventRsvp(event) && rsvp === 'not_responded') {
    items.push({
      title: 'Set availability',
      detail: `${event.childName} still needs an RSVP for this ${event.type}.`,
      section: 'availability'
    });
  }

  const openAssignments = event.assignments.filter(isScheduleAssignmentOpen);
  if (openAssignments.length) {
    items.push({
      title: 'Review assignments',
      detail: `${openAssignments.length} ${openAssignments.length === 1 ? 'assignment is' : 'assignments are'} still open.`,
      section: 'assignments'
    });
  }

  if ((event.rideshareSummary?.requests || 0) > 0) {
    items.push({
      title: 'Check rideshare',
      detail: `${event.rideshareSummary?.requests || 0} ${event.rideshareSummary?.requests === 1 ? 'ride request needs' : 'ride requests need'} attention.`,
      section: 'rideshare'
    });
  }

  if (event.type === 'practice' && event.practiceHomePacketSummary) {
    items.push({
      title: 'Practice packet ready',
      detail: `${event.practiceHomePacketSummary}. Review the drills and mark completion for ${event.childName}.`,
      section: 'game'
    });
  }

  return items;
}

function getEventBriefPieces(event: ParentScheduleEvent) {
  const scoreLabel = getScoreLabel(event);
  const statusLabel = getEventStatusLabel(event);

  return [
    event.isCancelled ? 'Cancelled' : '',
    scoreLabel ? (statusLabel === 'Live now' ? scoreLabel : `Final ${scoreLabel}`) : '',
    event.isHome === true ? 'Home' : event.isHome === false ? 'Away' : '',
    event.kitColor ? `${event.kitColor} kit` : '',
    event.seasonLabel ? event.seasonLabel : '',
    event.competitionType ? event.competitionType : '',
    event.isImported ? 'Imported' : '',
    event.practiceHomePacketSummary ? `Packet: ${event.practiceHomePacketSummary}` : ''
  ].filter(Boolean).slice(0, 6);
}

function formatHeroTime(event: ParentScheduleEvent) {
  if (event.arrivalTime) {
    return `Arrive ${formatEventTimeLabel(event.arrivalTime)} · Starts ${formatEventTimeLabel(event.date)}`;
  }
  return `Starts ${formatEventTimeLabel(event.date)}`;
}

function getPracticePacketBlocks(packet?: ParentPracticePacket | null) {
  return Array.isArray(packet?.homePacket?.blocks) ? packet.homePacket.blocks : [];
}

function getPracticePacketTotalMinutes(packet: ParentPracticePacket) {
  const blocks = getPracticePacketBlocks(packet);
  return packet.homePacket.totalMinutes || blocks.reduce((sum, block) => sum + (Number.parseInt(String(block?.duration || 0), 10) || 0), 0);
}

function formatPracticePacketDuration(duration: unknown) {
  return Number.parseInt(String(duration || 0), 10) || 0;
}

function toDateInputValue(value: Date | string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') {
    const normalized = value.trim();
    const utcCalendarDateMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.\d+)?Z)?$/i);
    if (utcCalendarDateMatch) return utcCalendarDateMatch[1];
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const useUtcCalendarDate = date.getUTCHours() === 0
    && date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0
    && date.getUTCMilliseconds() === 0;
  if (useUtcCalendarDate) {
    return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;
  }
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function getCompletedPacketChildIds(completions: PracticePacketCompletion[]) {
  return new Set((Array.isArray(completions) ? completions : [])
    .filter((completion) => completion.status === 'completed')
    .map((completion) => completion.childId)
    .filter(Boolean) as string[]);
}

function upsertPacketCompletion(completions: PracticePacketCompletion[], completion: PracticePacketCompletion) {
  const next = (Array.isArray(completions) ? completions : [])
    .filter((existing) => !(existing.childId === completion.childId && existing.parentUserId === completion.parentUserId));
  next.push(completion);
  return next;
}

function getEventStatusLabel(event: ParentScheduleEvent) {
  const liveStatus = String(event.liveStatus || '').toLowerCase();
  const status = String(event.status || '').toLowerCase();
  if (event.isCancelled || status === 'cancelled') return 'Cancelled';
  if (liveStatus === 'live') return 'Live now';
  if (liveStatus === 'completed' || status === 'completed' || status === 'final') return 'Final';
  if (!event.isDbGame) return 'Calendar';
  return event.type === 'practice' ? 'Scheduled' : 'Upcoming';
}

function getEventStatusClasses(event: ParentScheduleEvent) {
  const label = getEventStatusLabel(event);
  if (label === 'Live now') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (label === 'Final') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (label === 'Cancelled') return 'border-gray-200 bg-gray-100 text-gray-600';
  if (label === 'Calendar') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-primary-200 bg-primary-50 text-primary-700';
}

const pastScheduledGameScoreCutoffMs = 3 * 60 * 60 * 1000;

function getScoreLabel(event: ParentScheduleEvent) {
  if (event.type !== 'game') return '';
  if (event.homeScore === null || event.homeScore === undefined || event.awayScore === null || event.awayScore === undefined) return '';
  const status = String(event.status || '').trim().toLowerCase();
  const liveStatus = String(event.liveStatus || '').trim().toLowerCase();
  const isLive = status === 'live' || liveStatus === 'live';
  const isCompleted = status === 'completed' || status === 'final' || liveStatus === 'completed' || liveStatus === 'final';
  const isPastScheduledResult = event.date.getTime() < Date.now() - pastScheduledGameScoreCutoffMs;
  if (!isLive && !isCompleted && !isPastScheduledResult) return '';
  return `${event.homeScore}-${event.awayScore}`;
}
