import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ClipboardCheck, ExternalLink, FileText, Radio, RefreshCw, Share2, Users, Video, type LucideIcon } from 'lucide-react';
import {
  cancelPracticeOccurrenceForApp,
  cancelScheduledGameForApp,
  loadScheduleStatTrackerConfigsForApp,
  loadScheduledPracticeSeriesForEdit,
  updateScheduledGameForApp,
  updateScheduledPracticeForApp,
  revertScheduledPracticeOccurrenceForApp,
  type ScheduleGameFormInput,
  type SchedulePracticeFormInput,
  type PracticeRecurrenceFormInput,
  type ScheduleStatTrackerConfigOption,
  loadParentPracticePacket,
  loadStaffPracticePacket,
  loadStaffPracticeAttendance,
  loadParentScheduleEventDetail,
  resolveCachedParentScheduleEvents,
  loadAutoFilledLineupDraftPreviewForApp,
  markParentPracticePacketComplete,
  publishGamePlanForApp,
  loadHomeScoringPlayers,
  publishLiveScoreUpdateEvent,
  recordPlayerGameStat,
  recordPlayerScoringStat,
  undoRecordedPlayerGameStat,
  saveScheduledGameLineupDraftForApp,
  saveStaffPracticeAttendance,
  saveStaffPracticePacket,
  completeGameWrapupForApp,
  loadGameDayLiveEventsForApp,
  saveGameDaySubstitutionForApp,
  updateGameScore,
  updateLiveGameClockState,
  buildLiveGameClockPeriods,
  resolveLiveGameClockSnapshot,
  createStaffRsvpAvailabilityLoader,
  type PracticeAttendancePlayer,
  type StaffPracticeAttendance,
  type StaffPracticePacket,
  type StaffPracticePacketBlock,
  type ParentPracticePacket,
  type ParentPracticePacketChild,
  type ScheduleHomeScoringPlayer,
  type PlayerGameStatResult,
  type LineupDraftPreviewResult
} from '../lib/scheduleService';
import { LINEUP_FORMATIONS, getLineupPublishStatus, hasLineupDraft } from '../lib/gameDayLineupPublish';
import {
  assignLineupPlayer,
  buildLineupAiPrompt,
  buildLineupEditorAssignments,
  buildLineupEditorPlayers,
  buildProjectedPlayingTimeSummary,
  buildRoundRobinLineup,
  clearLineupPlayer,
  getLineupAiModel,
  getLineupSlotKey,
  getOrderedLineupPeriods,
  moveLineupPlayer,
  parseAiLineupPlan
} from '../lib/gameDayLineupBuilder';
import { buildAppWrapupCompletionPayload, buildGameWrapupEmailDraft, generateGameWrapupArtifactsForApp, type PracticeFeedItem } from '../lib/gameWrapupService';
import { appendPracticeTimelineLiveNoteForApp, createPracticeTimelineBlockFromOption, getPracticeTimelineTotalMinutes, loadPracticeTimelineModel, savePracticeTimelineForApp, type PracticeTimelineBlock, type PracticeTimelineDrillOption } from '../lib/practiceTimelineService';
import { acquireTrackStatsheetPhoto, analyzeTrackStatsheetPhoto, applyTrackStatsheetImportForApp, loadTrackStatsheetContextForApp, type TrackStatsheetReviewRow } from '../lib/statsheetImportService';
import { buildRotationPlanFromGamePlan } from '../lib/adapters/legacyScheduleHelpers';
import { applyLiveSubstitution, getSubstitutionOptions } from '../lib/adapters/legacyScheduleHelpers';
import { exportCalendarIcsFile, openPublicUrl, sharePublicUrl } from '../lib/publicActions';
import { buildParentScheduleEventIcs } from '../lib/parentToolsService';
import {
  buildGameHubDestinations,
  buildPracticeHubDestinations,
  type ScheduleHubDestination,
  type ScheduleHubIcon
} from '../lib/scheduleHub';
import { type AppServiceError, toAppServiceError } from '../lib/appErrors';
import { useAsyncOperation } from '../lib/useAsyncOperation';
import { EventDetailPageSkeleton } from '../components/PageSkeletons';
import { AssignmentsSection } from '../components/schedule/AssignmentsSection';
import { CompactMeta } from '../components/schedule/CompactMeta';
import { EventDetailsPanel } from '../components/schedule/EventDetailsPanel';
import { ScheduleEventHeader } from '../components/schedule/ScheduleEventHeader';
import { EventSectionNav } from '../components/schedule/EventSectionNav';
import { GameReportSections } from '../components/schedule/GameReportSections';
import { PlayerSwitcher } from '../components/schedule/PlayerSwitcher';
import { PracticeAttendancePanel } from '../components/schedule/PracticeAttendancePanel';
import { ReportMarkdownText } from '../components/schedule/ReportMarkdownText';
import { RideshareSection } from '../components/schedule/RideshareSection';
import { ScoreStepper } from '../components/schedule/ScoreStepper';
import { Status } from '../components/schedule/ScheduleStatus';
import { StaffRsvpBreakdownPanel } from '../components/schedule/StaffRsvpBreakdownPanel';
import { StaffRsvpReminderPanel } from '../components/schedule/StaffRsvpReminderPanel';
import { AttentionPanel, type AttentionItem, type ScheduleEventDetailSectionId } from '../components/schedule/AttentionPanel';
import { AvailabilityNotesList } from '../components/schedule/AvailabilityNotesList';
import {
  QuickAvailabilityPanel,
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
  isScheduleAssignmentOpen,
  getScheduleTitle,
  getLiveClockViewModel,
  normalizeRsvpResponse,
  type ParentScheduleEvent,
  type PracticePacketCompletion,
  type RsvpResponse
} from '../lib/scheduleLogic';
// Type-only imports for deferred modules — runtime values loaded on demand below
import type { LiveGameChatMessage } from '../lib/liveGameChatService';
import type { LiveGameReaction, LiveGameReactionType } from '../lib/liveGameReactionsService';

// Deferred module type aliases for promise caches
type LiveGameChatModule = typeof import('../lib/liveGameChatService');
type LiveGameReactionsModule = typeof import('../lib/liveGameReactionsService');

// Module-level promise caches — each module loads at most once per session
let liveGameChatModulePromise: Promise<LiveGameChatModule> | null = null;
let liveGameReactionsModulePromise: Promise<LiveGameReactionsModule> | null = null;

function loadLiveGameChatModule() {
  if (!liveGameChatModulePromise) {
    liveGameChatModulePromise = import('../lib/liveGameChatService');
  }
  return liveGameChatModulePromise;
}

function loadLiveGameReactionsModule() {
  if (!liveGameReactionsModulePromise) {
    liveGameReactionsModulePromise = import('../lib/liveGameReactionsService');
  }
  return liveGameReactionsModulePromise;
}
import type { AuthState } from '../lib/types';
import { ScheduleEventDetailProvider } from './schedule/ScheduleEventDetailContext';
import { useScheduleEventRsvp } from '../hooks/schedule/useScheduleEventRsvp';
import { useStaffRsvpBreakdown } from '../hooks/schedule/useStaffRsvpBreakdown';

export { getAvailabilityNoteSaveState } from '../components/schedule/AvailabilityPanels';

type EventDetailSectionId = ScheduleEventDetailSectionId;

const eventDetailSectionIds = new Set<EventDetailSectionId>(['availability', 'rideshare', 'assignments', 'game']);

export function parseEventDetailSection(section: string | null | undefined): EventDetailSectionId {
  const normalized = String(section || '').trim().toLowerCase();
  if (normalized && eventDetailSectionIds.has(normalized as EventDetailSectionId)) {
    return normalized as EventDetailSectionId;
  }
  return 'availability';
}

const hubIconComponents: Record<ScheduleHubIcon, LucideIcon> = {
  video: Video,
  radio: Radio,
  'file-text': FileText,
  share: Share2,
  'clipboard-check': ClipboardCheck,
  users: Users
};

function getEventDetailSections(event?: ParentScheduleEvent | null): Array<{ id: EventDetailSectionId; label: string; shortLabel?: string }> {
  const eventLabel = event?.type === 'practice' ? 'More' : 'Game';
  return [
    { id: 'availability', label: 'Availability' },
    { id: 'rideshare', label: 'Rideshare' },
    { id: 'assignments', label: 'Assignments', shortLabel: 'Tasks' },
    { id: 'game', label: eventLabel }
  ];
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

type ActiveLiveReaction = LiveGameReaction & {
  localId: string;
  emoji: string;
};

export function shouldPersistLineupDraft(user: AuthState['user'] | null | undefined, formationId: string, _lineups: Record<string, string>) {
  return Boolean(user?.uid && String(formationId || '').trim());
}

export function shouldAutosaveLineupDraft(isDirty: boolean, formationId: string, _lineups: Record<string, string>) {
  return Boolean(isDirty && String(formationId || '').trim());
}

export function shouldAutosaveGeneratedLineupDraft(existingGamePlan: Record<string, any> | null | undefined, previewGamePlan: Record<string, any> | null | undefined) {
  return !hasLineupDraft(existingGamePlan) && hasLineupDraft(previewGamePlan);
}

export function ScheduleEventDetail({ auth }: { auth: AuthState }) {
  const { teamId = '', eventId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [events, setEvents] = useState<ParentScheduleEvent[]>([]);
  const [selectedChildId, setSelectedChildId] = useState(searchParams.get('childId') || '');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<EventDetailSectionId>(() => parseEventDetailSection(searchParams.get('section')));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [availabilityNote, setAvailabilityNote] = useState('');
  const [initialLoadPending, setInitialLoadPending] = useState(true);
  const hasLoadedEventRef = useRef(false);
  const { loading, error, clearError, setError, run: runPrimaryLoad } = useAsyncOperation();

  const decodedTeamId = decodeURIComponent(teamId);
  const decodedEventId = decodeURIComponent(eventId);

  const replaceEventRouteParams = (updates: { section?: EventDetailSectionId; childId?: string }) => {
    const nextParams = new URLSearchParams(searchParams);
    if (updates.section) nextParams.set('section', updates.section);
    if (Object.prototype.hasOwnProperty.call(updates, 'childId')) {
      const nextChildId = String(updates.childId || '').trim();
      if (nextChildId) {
        nextParams.set('childId', nextChildId);
      } else {
        nextParams.delete('childId');
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

  const loadEvent = useCallback(async () => {
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
            setEvents(result.events);
            hasLoadedEventRef.current = result.events.length > 0;
            if (!selectedChildId && result.events[0]?.childId) {
              setSelectedChildId(result.events[0].childId);
            }
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
  }, [auth.user, clearError, decodedEventId, decodedTeamId, runPrimaryLoad, selectedChildId]);

  useEffect(() => {
    hasLoadedEventRef.current = false;
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
    setActiveSection(parseEventDetailSection(searchParams.get('section')));
    const routeChildId = searchParams.get('childId') || '';
    if (routeChildId) {
      setSelectedChildId(routeChildId);
    }
  }, [searchParams]);

  const selectedEvent = useMemo(() => {
    if (!events.length) return null;
    return events.find((event) => event.childId === selectedChildId) || events[0];
  }, [events, selectedChildId]);

  useEffect(() => {
    setAvailabilityNote(selectedEvent?.myRsvpNote || '');
  }, [selectedEvent?.eventKey, selectedEvent?.myRsvpNote]);

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
  const title = getScheduleTitle(selectedEvent);
  const hasPracticePacket = selectedEvent.type === 'practice' && Boolean(selectedEvent.practiceHomePacketSummary);
  const attentionItems = getAttentionItems(selectedEvent, rsvp).filter((item) => item.section !== 'availability' && item.title !== 'Practice packet ready');
  const sections = getEventDetailSections(selectedEvent);

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
              location={selectedEvent.location}
              playerSummary={events.length > 1 ? (
                <>
                  <PlayerSwitcher events={events} selectedChildId={selectedEvent.childId} onSelect={selectChild} compact />
                  <div className="mt-1 truncate text-xs font-bold text-gray-600">{selectedEvent.childName} · {selectedEvent.teamName}</div>
                </>
              ) : (
                <CompactMeta icon={Users} value={`${selectedEvent.childName} · ${selectedEvent.teamName}`} />
              )}
              rsvpLabel={rsvpLabels[rsvp]}
              rsvpClassName={rsvpBadgeClasses[rsvp]}
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
              activeSection={activeSection}
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
          activeSection={activeSection}
          hasPracticePacket={hasPracticePacket}
          onSelect={selectSection}
        />
      </aside>

      <div className="event-detail-content space-y-3">
        {statusMessage ? <Status tone="success" message={statusMessage} /> : null}
        {error ? <Status tone="error" message={error} /> : null}

        {activeSection === 'availability' ? (
          <AvailabilitySection
            event={selectedEvent}
            rsvp={rsvp}
            availabilityNote={availabilityNote}
            onAvailabilityNoteChange={setAvailabilityNote}
            attentionItems={attentionItems}
            onSelectSection={selectSection}
          />
        ) : null}
        {activeSection === 'rideshare' ? <RideshareSection /> : null}
        {activeSection === 'assignments' ? <AssignmentsSection /> : null}
        {activeSection === 'game' ? <GameHubSection key={selectedEvent.eventKey} auth={auth} event={selectedEvent} childEvents={events} onScoreUpdated={handleScoreUpdated} onLiveClockUpdated={handleLiveClockUpdated} onWrapupCompleted={handleWrapupCompleted} onStatsheetImported={handleStatsheetImported} onGameCancelled={handleGameCancelled} onPracticeOccurrenceCancelled={handlePracticeOccurrenceCancelled} onGamePlanPublished={handleGamePlanPublished} /> : null}
      </div>
      </div>
    </ScheduleEventDetailProvider>
  );
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0');
}

function toDatetimeLocalInputValue(value: Date | string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}
function getDefaultPracticeEndDate(startDate: Date) {
  return new Date(startDate.getTime() + 90 * 60000);
}

function buildPracticeFormFromEvent(event: ParentScheduleEvent): SchedulePracticeFormInput {
  const startDate = event.date instanceof Date ? event.date : new Date(event.date);
  const endDate = event.endDate instanceof Date ? event.endDate : (event.endDate ? new Date(event.endDate) : getDefaultPracticeEndDate(startDate));
  return {
    title: event.title || 'Practice',
    startDate,
    endDate,
    location: event.location || '',
    notes: event.notes || '',
    recurrence: { isRecurring: event.id.includes('__') }
  };
}

function buildGameFormFromEvent(event: ParentScheduleEvent): ScheduleGameFormInput {
  const startDate = event.date instanceof Date ? event.date : new Date(event.date);
  const endDate = event.endDate instanceof Date ? event.endDate : (event.endDate ? new Date(event.endDate) : null);
  const arrivalTime = event.arrivalTime instanceof Date ? event.arrivalTime : (event.arrivalTime ? new Date(event.arrivalTime) : null);
  return {
    opponent: event.opponent || event.title || '',
    startDate,
    endDate,
    location: event.location || '',
    arrivalTime,
    isHome: event.isHome === false ? false : event.isHome === true ? true : null,
    notes: event.notes || '',
    statTrackerConfigId: event.statTrackerConfigId || '',
    competitionType: event.competitionType || 'league',
    countsTowardSeasonRecord: event.countsTowardSeasonRecord !== false,
    opponentTeamId: event.opponentTeamId || null,
    opponentTeamName: event.opponentTeamName || null,
    opponentTeamPhoto: event.opponentTeamPhoto || null
  };
}

function GameScheduleEditPanel({ auth, event }: { auth: AuthState; event: ParentScheduleEvent }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ScheduleGameFormInput>(() => buildGameFormFromEvent(event));
  const [configs, setConfigs] = useState<ScheduleStatTrackerConfigOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    setForm(buildGameFormFromEvent(event));
    setStatus(null);
  }, [event.eventKey]);

  useEffect(() => {
    if (!open || !auth.user) return;
    let cancelled = false;
    setConfigError(null);
    loadScheduleStatTrackerConfigsForApp(event.teamId, auth.user)
      .then((nextConfigs) => {
        if (!cancelled) setConfigs(nextConfigs);
      })
      .catch((error: any) => {
        if (!cancelled) setConfigError(error?.message || 'Unable to load tracker configs.');
      });
    return () => {
      cancelled = true;
    };
  }, [auth.user, event.teamId, open]);

  const updateField = (field: keyof ScheduleGameFormInput, value: string | Date | boolean | null) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const saveGame = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (!auth.user) return;
    setSaving(true);
    setStatus(null);
    try {
      await updateScheduledGameForApp(event.teamId, event.id, form, auth.user);
      setStatus({ tone: 'success', message: 'Game schedule was updated.' });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to update game.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="app-card p-3 sm:p-4" aria-label="Edit game schedule">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.04em] text-primary-700">Schedule management</div>
          <h2 className="mt-1 text-base font-black text-gray-950">Edit game</h2>
          <p className="mt-1 text-sm font-semibold text-gray-500">Update opponent, timing, location, home/away, and tracker config without touching score data.</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => setOpen((current) => !current)}>{open ? 'Hide editor' : 'Edit game'}</button>
      </div>
      {open ? (
        <form className="mt-3 space-y-3" onSubmit={saveGame}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Opponent<input className="auth-input mt-1" value={form.opponent} onChange={(e) => updateField('opponent', e.target.value)} /></label>
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Location<input className="auth-input mt-1" value={form.location || ''} onChange={(e) => updateField('location', e.target.value)} /></label>
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Starts<input type="datetime-local" className="auth-input mt-1" value={toDatetimeLocalInputValue(form.startDate)} onChange={(e) => updateField('startDate', new Date(e.target.value))} /></label>
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Ends<input type="datetime-local" className="auth-input mt-1" value={toDatetimeLocalInputValue(form.endDate)} onChange={(e) => updateField('endDate', e.target.value ? new Date(e.target.value) : null)} /></label>
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Arrival<input type="datetime-local" className="auth-input mt-1" value={toDatetimeLocalInputValue(form.arrivalTime)} onChange={(e) => updateField('arrivalTime', e.target.value ? new Date(e.target.value) : null)} /></label>
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Home / away<select className="auth-input mt-1" value={form.isHome === false ? 'away' : form.isHome === true ? 'home' : 'neutral'} onChange={(e) => updateField('isHome', e.target.value === 'neutral' ? null : e.target.value === 'home')}><option value="home">Home</option><option value="away">Away</option><option value="neutral">Neutral</option></select></label>
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Tracker config<select className="auth-input mt-1" value={form.statTrackerConfigId || ''} onChange={(e) => updateField('statTrackerConfigId', e.target.value)}><option value="">No tracker config</option>{configs.map((config) => <option key={config.id} value={config.id}>{config.name}</option>)}</select></label>
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Competition<select className="auth-input mt-1" value={form.competitionType || 'league'} onChange={(e) => updateField('competitionType', e.target.value)}><option value="league">League</option><option value="tournament">Tournament</option><option value="scrimmage">Scrimmage</option><option value="friendly">Friendly</option></select></label>
          </div>
          <label className="flex items-center gap-2 text-sm font-black text-gray-800"><input type="checkbox" checked={form.countsTowardSeasonRecord !== false} onChange={(e) => updateField('countsTowardSeasonRecord', e.target.checked)} /> Counts toward season record</label>
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Notes<textarea className="auth-input mt-1 min-h-20" value={form.notes || ''} onChange={(e) => updateField('notes', e.target.value)} /></label>
          <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving' : 'Save game'}</button>
          {configError ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">{configError}</div> : null}
        </form>
      ) : null}
      {status ? <div className={`mt-3 rounded-2xl border px-3 py-2 text-sm font-bold ${status.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{status.message}</div> : null}
    </section>
  );
}

function PracticeScheduleEditPanel({ auth, event }: { auth: AuthState; event: ParentScheduleEvent }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'occurrence' | 'series'>(event.id.includes('__') ? 'occurrence' : 'series');
  const [form, setForm] = useState<SchedulePracticeFormInput>(() => buildPracticeFormFromEvent(event));
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [seriesEventId, setSeriesEventId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setForm(buildPracticeFormFromEvent(event));
    setScope(event.id.includes('__') ? 'occurrence' : 'series');
    setSeriesId(null);
    setSeriesEventId(null);
    setStatus(null);
  }, [event.eventKey]);

  const updateField = (field: keyof SchedulePracticeFormInput, value: string | Date | PracticeRecurrenceFormInput) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const loadSeries = async () => {
    if (!auth.user) return;
    setSaving(true);
    setStatus(null);
    try {
      const loaded = await loadScheduledPracticeSeriesForEdit(event.teamId, event.id, auth.user);
      setForm(loaded.input);
      setSeriesId(loaded.seriesId || null);
      setSeriesEventId(loaded.eventId);
      setScope('series');
      setOpen(true);
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to load practice series.' });
    } finally {
      setSaving(false);
    }
  };

  const savePractice = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (!auth.user) return;
    setSaving(true);
    setStatus(null);
    try {
      await updateScheduledPracticeForApp(event.teamId, form, auth.user, {
        eventId: scope === 'series' ? (seriesEventId || event.id) : event.id,
        seriesId,
        scope
      });
      setStatus({ tone: 'success', message: scope === 'occurrence' ? 'This practice occurrence was updated.' : 'Practice series was updated.' });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to update practice.' });
    } finally {
      setSaving(false);
    }
  };

  const revertOccurrence = async () => {
    if (!auth.user) return;
    setSaving(true);
    setStatus(null);
    try {
      await revertScheduledPracticeOccurrenceForApp(event.teamId, event.id, auth.user);
      setStatus({ tone: 'success', message: 'This occurrence now follows the series again.' });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to revert this occurrence.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="app-card p-3 sm:p-4" aria-label="Edit practice schedule">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.04em] text-primary-700">Schedule management</div>
          <h2 className="mt-1 text-base font-black text-gray-950">Edit practice</h2>
          <p className="mt-1 text-sm font-semibold text-gray-500">Update this occurrence or the full recurring series using the same backend semantics as the website.</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => setOpen((current) => !current)}>{open ? 'Hide editor' : 'Edit practice'}</button>
      </div>
      {open ? (
        <form className="mt-3 space-y-3" onSubmit={savePractice}>
          {event.id.includes('__') ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" className={scope === 'occurrence' ? 'primary-button' : 'secondary-button'} onClick={() => { setScope('occurrence'); setForm(buildPracticeFormFromEvent(event)); }}>This occurrence</button>
              <button type="button" className={scope === 'series' ? 'primary-button' : 'secondary-button'} onClick={loadSeries} disabled={saving}>Entire series</button>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Title<input className="auth-input mt-1" value={form.title} onChange={(e) => updateField('title', e.target.value)} /></label>
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Location<input className="auth-input mt-1" value={form.location || ''} onChange={(e) => updateField('location', e.target.value)} /></label>
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Starts<input type="datetime-local" className="auth-input mt-1" value={toDatetimeLocalInputValue(form.startDate)} onChange={(e) => updateField('startDate', new Date(e.target.value))} /></label>
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Ends<input type="datetime-local" className="auth-input mt-1" value={toDatetimeLocalInputValue(form.endDate)} onChange={(e) => updateField('endDate', new Date(e.target.value))} /></label>
          </div>
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Notes<textarea className="auth-input mt-1 min-h-20" value={form.notes || ''} onChange={(e) => updateField('notes', e.target.value)} /></label>
          {scope === 'series' ? <PracticeRecurrenceFields form={form} onChange={setForm} /> : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving' : 'Save practice'}</button>
            {event.id.includes('__') ? <button type="button" className="secondary-button" disabled={saving} onClick={revertOccurrence}>Revert occurrence</button> : null}
          </div>
        </form>
      ) : null}
      {status ? <div className={`mt-3 rounded-2xl border px-3 py-2 text-sm font-bold ${status.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{status.message}</div> : null}
    </section>
  );
}

function PracticeRecurrenceFields({ form, onChange }: { form: SchedulePracticeFormInput; onChange: (form: SchedulePracticeFormInput) => void }) {
  const recurrence = form.recurrence || { isRecurring: false };
  const byDays = new Set(recurrence.byDays || []);
  const setRecurrence = (next: Partial<PracticeRecurrenceFormInput>) => onChange({ ...form, recurrence: { ...recurrence, ...next } });
  const days = [['MO', 'Mon'], ['TU', 'Tue'], ['WE', 'Wed'], ['TH', 'Thu'], ['FR', 'Fri'], ['SA', 'Sat'], ['SU', 'Sun']];
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
      <label className="flex items-center gap-2 text-sm font-black text-gray-800"><input type="checkbox" checked={recurrence.isRecurring === true} onChange={(e) => setRecurrence({ isRecurring: e.target.checked })} /> Weekly recurrence</label>
      {recurrence.isRecurring ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {days.map(([value, label]) => (
              <label key={value} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-black text-gray-700"><input className="mr-1" type="checkbox" checked={byDays.has(value)} onChange={(e) => { const next = new Set(byDays); if (e.target.checked) next.add(value); else next.delete(value); setRecurrence({ byDays: Array.from(next) }); }} />{label}</label>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Every<input type="number" min="1" className="auth-input mt-1" value={recurrence.interval || 1} onChange={(e) => setRecurrence({ interval: Number(e.target.value) || 1 })} /></label>
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Ends<select className="auth-input mt-1" value={recurrence.endType || 'never'} onChange={(e) => setRecurrence({ endType: e.target.value as PracticeRecurrenceFormInput['endType'] })}><option value="never">Never</option><option value="until">On date</option><option value="count">After count</option></select></label>
            {recurrence.endType === 'until' ? <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Until<input type="date" className="auth-input mt-1" value={recurrence.untilValue || ''} onChange={(e) => setRecurrence({ untilValue: e.target.value })} /></label> : null}
            {recurrence.endType === 'count' ? <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Count<input type="number" min="1" className="auth-input mt-1" value={recurrence.countValue || 10} onChange={(e) => setRecurrence({ countValue: Number(e.target.value) || 10 })} /></label> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
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

function AvailabilitySection({ event, rsvp, availabilityNote, onAvailabilityNoteChange, attentionItems, onSelectSection }: {
  event: ParentScheduleEvent;
  rsvp: RsvpResponse;
  availabilityNote: string;
  onAvailabilityNoteChange: (note: string) => void;
  attentionItems: AttentionItem[];
  onSelectSection: (sectionId: EventDetailSectionId) => void;
}) {
  const rsvpWorkflow = useScheduleEventRsvp({ availabilityNote });
  const staffRsvpLoader = useMemo(() => createStaffRsvpAvailabilityLoader(), [event.teamId, event.id]);
  const staffRsvp = useStaffRsvpBreakdown(staffRsvpLoader);

  return (
    <section className="app-card overflow-hidden p-0">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <h2 className="app-section-title">Availability</h2>
          <div className="mt-0.5 text-xs font-semibold text-gray-500">{formatRsvpSummary(event.rsvpSummary)}</div>
        </div>
        <span className={`mt-0.5 inline-flex min-h-6 flex-none items-center rounded-full border px-2 text-[11px] font-extrabold uppercase tracking-[0.04em] ${rsvpBadgeClasses[rsvp]}`}>
          {rsvpLabels[rsvp]}
        </span>
      </div>
      <QuickAvailabilityPanel
        event={event}
        rsvp={rsvp}
        canSubmitRsvp={rsvpWorkflow.canSubmit}
        submitting={rsvpWorkflow.submitting}
        availabilityNote={availabilityNote}
        onAvailabilityNoteChange={onAvailabilityNoteChange}
        onSubmit={rsvpWorkflow.submit}
      />
      <div className="px-3 pb-3 sm:px-4">
        {rsvpWorkflow.message ? <Status tone="success" message={rsvpWorkflow.message} /> : null}
        {rsvpWorkflow.error ? <div className="mt-2"><Status tone="error" message={rsvpWorkflow.error} /></div> : null}
        <AttentionPanel items={attentionItems} onSelectSection={onSelectSection} />
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
        {!event.isDbGame ? <div className="mt-2 text-xs font-semibold text-gray-500">Availability opens after this event is tracked in the schedule.</div> : null}
        {event.availabilityLocked ? <div className="mt-2 text-xs font-semibold text-amber-700">Availability locked {String(event.availabilityCutoffLabel || '').toLowerCase()}.</div> : null}
      </div>
    </section>
  );
}


function LiveGameReactionsPanel({ auth, event }: { auth: AuthState; event: ParentScheduleEvent }) {
  const [reactionsModule, setReactionsModule] = useState<LiveGameReactionsModule | null>(null);
  const [activeReactions, setActiveReactions] = useState<ActiveLiveReaction[]>([]);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [sendingReactionKey, setSendingReactionKey] = useState<LiveGameReactionType | null>(null);
  const timeoutIdsRef = useRef<number[]>([]);

  useEffect(() => {
    void loadLiveGameReactionsModule().then(setReactionsModule);
  }, []);

  const canReact = reactionsModule ? reactionsModule.canUseLiveGameReactions(event, { now: new Date() }) : false;
  const reactionNotice = reactionsModule ? reactionsModule.getLiveGameReactionNotice(event, { now: new Date() }) : null;
  const reactionOptions = reactionsModule ? reactionsModule.liveGameReactionOptions : [];
  const reactionsReady = Boolean(reactionsModule && reactionOptions.length);

  useEffect(() => {
    if (!reactionsModule || !event.isDbGame || !event.teamId || !event.id) return undefined;

    const { subscribeToLiveGameReactions, liveGameReactionOptions: options } = reactionsModule;
    const unsubscribe = subscribeToLiveGameReactions(event.teamId, event.id, (reaction) => {
      const normalizedType = options.some((option) => option.key === reaction.type)
        ? reaction.type
        : 'fire';
      const emoji = options.find((r) => r.key === normalizedType)?.emoji || '🔥';
      const nextReaction: ActiveLiveReaction = {
        ...reaction,
        type: normalizedType,
        localId: `${reaction.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        emoji
      };
      setActiveReactions((current) => [...current, nextReaction].slice(-12));
      const timeoutId = window.setTimeout(() => {
        setActiveReactions((current) => current.filter((item) => item.localId !== nextReaction.localId));
        timeoutIdsRef.current = timeoutIdsRef.current.filter((item) => item !== timeoutId);
      }, 2400);
      timeoutIdsRef.current.push(timeoutId);
    }, (error: any) => {
      setSendStatus(error?.message || 'Live reactions disconnected.');
    });

    return () => {
      unsubscribe?.();
      timeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutIdsRef.current = [];
    };
  }, [reactionsModule, event.id, event.isDbGame, event.teamId]);

  const sendReaction = async (type: LiveGameReactionType) => {
    if (!reactionsModule || !canReact || !event.teamId || !event.id || !auth.user?.uid || sendingReactionKey === type) return;
    setSendingReactionKey(type);
    setSendStatus(null);
    try {
      await reactionsModule.sendLiveGameReaction(event.teamId, event.id, {
        type,
        user: auth.user
      });
    } catch (error: any) {
      setSendStatus(error?.message || 'Unable to send reaction.');
    } finally {
      window.setTimeout(() => setSendingReactionKey((current) => (current === type ? null : current)), 1000);
    }
  };

  if (!event.isDbGame) return null;

  return (
    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-3" data-testid="live-game-reactions-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-[0.04em] text-amber-700">Live reactions</div>
          <div className="mt-1 text-sm font-semibold text-gray-900">Send the same quick emoji bursts the web live viewer uses.</div>
        </div>
        <div className="rounded-full bg-white px-3 py-1 text-xs font-black text-amber-700 shadow-sm">
          {activeReactions.length ? `${activeReactions.length} live` : 'Ready'}
        </div>
      </div>

      <div className="relative mt-3 min-h-24 overflow-hidden rounded-2xl border border-white/80 bg-gradient-to-br from-white via-white to-amber-50 px-3 py-3">
        <div className="flex flex-wrap gap-2" aria-label="Live reaction stream">
          {activeReactions.length ? activeReactions.map((reaction) => (
            <span
              key={reaction.localId}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-amber-100 bg-white text-2xl shadow-sm"
              aria-label={`Live reaction ${reaction.type}`}
            >
              {reaction.emoji}
            </span>
          )) : (
            <span className="text-sm font-semibold text-gray-500">Reactions from the app and web viewer will pop in here during the game.</span>
          )}
        </div>
      </div>

      <div className="mt-3 flex min-h-11 flex-wrap gap-2">
        {reactionsReady ? reactionOptions.map((reaction) => {
          const disabled = !canReact || sendingReactionKey === reaction.key;
          return (
            <button
              key={reaction.key}
              type="button"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-amber-200 bg-white px-3 text-2xl shadow-sm transition hover:border-amber-300 hover:bg-amber-100 disabled:opacity-50"
              onClick={() => sendReaction(reaction.key)}
              disabled={disabled}
              aria-label={reaction.label}
            >
              {reaction.emoji}
            </button>
          );
        }) : Array.from({ length: 5 }).map((_, index) => (
          <span
            key={`reaction-loading-${index}`}
            className="inline-flex min-h-11 min-w-11 animate-pulse items-center justify-center rounded-full border border-amber-100 bg-white/80 px-3"
            aria-hidden="true"
          />
        ))}
      </div>

      <div className="mt-2 text-xs font-semibold text-gray-500">
        {reactionsReady
          ? (reactionNotice || 'Shared Firestore stream. App and web viewers see the same reactions in real time.')
          : 'Loading reaction controls…'}
      </div>
      {sendStatus ? <div className="mt-2 text-xs font-bold text-rose-700">{sendStatus}</div> : null}
    </div>
  );
}

function LiveGameChatPanel({ auth, event }: { auth: AuthState; event: ParentScheduleEvent }) {
  const [chatModule, setChatModule] = useState<LiveGameChatModule | null>(null);
  const [messages, setMessages] = useState<LiveGameChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [anonymousDisplayName, setAnonymousDisplayName] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const messagesContentRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const stickToLatestRef = useRef(true);
  const shouldFollowLatestRef = useRef(true);
  const scheduledScrollTimeoutsRef = useRef<number[]>([]);

  useEffect(() => {
    void loadLiveGameChatModule().then(setChatModule);
  }, []);

  const canChat = chatModule ? chatModule.canUseLiveGameChat(event, { now: new Date() }) : false;
  const chatNotice = chatModule ? chatModule.getLiveGameChatNotice(event, { now: new Date() }) : null;
  const canSend = canChat && Boolean(messageText.trim()) && !sending;
  const latestMessageId = messages[messages.length - 1]?.id || '';

  const scrollToLatest = useCallback(() => {
    const container = messagesScrollRef.current;
    if (!container) return;

    const nextHeight = Math.max(container.scrollHeight, messagesContentRef.current?.scrollHeight || 0);
    container.scrollTop = Math.max(0, nextHeight - container.clientHeight);
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ block: 'end', behavior: 'auto' });
    }
    stickToLatestRef.current = true;
  }, []);

  const clearScheduledScrolls = useCallback(() => {
    scheduledScrollTimeoutsRef.current.forEach((timerId) => window.clearTimeout(timerId));
    scheduledScrollTimeoutsRef.current = [];
  }, []);

  const scheduleScrollToLatest = useCallback(() => {
    clearScheduledScrolls();
    const followIfNeeded = () => {
      const container = messagesScrollRef.current;
      if (!container) return;
      if (stickToLatestRef.current || isLiveGameChatNearBottom(container)) {
        scrollToLatest();
      }
    };

    followIfNeeded();
    [120, 300, 700].forEach((delay) => {
      let timerId = 0;
      timerId = window.setTimeout(() => {
        scheduledScrollTimeoutsRef.current = scheduledScrollTimeoutsRef.current.filter((id) => id !== timerId);
        followIfNeeded();
      }, delay);
      scheduledScrollTimeoutsRef.current.push(timerId);
    });
  }, [clearScheduledScrolls, scrollToLatest]);

  const handleMessagesScroll = useCallback(() => {
    stickToLatestRef.current = isLiveGameChatNearBottom(messagesScrollRef.current);
  }, []);

  useLayoutEffect(() => {
    if (!messages.length || !shouldFollowLatestRef.current) return;
    scheduleScrollToLatest();
  }, [latestMessageId, messages.length, scheduleScrollToLatest]);

  useEffect(() => clearScheduledScrolls, [clearScheduledScrolls]);

  useEffect(() => {
    if (!chatModule || !event.isDbGame || !event.teamId || !event.id) return undefined;

    setLoading(true);
    setStatus(null);
    stickToLatestRef.current = true;
    shouldFollowLatestRef.current = true;
    const unsubscribe = chatModule.subscribeToLiveGameChat(event.teamId, event.id, (nextMessages) => {
      shouldFollowLatestRef.current = stickToLatestRef.current || isLiveGameChatNearBottom(messagesScrollRef.current);
      setMessages(sortLiveGameChatMessages(nextMessages));
      setLoading(false);
    }, (subscribeError: any) => {
      setStatus({ tone: 'error', message: subscribeError?.message || 'Unable to load live chat.' });
      setLoading(false);
    });

    return () => {
      unsubscribe?.();
    };
  }, [chatModule, event.id, event.isDbGame, event.teamId]);

  const sendMessage = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!chatModule || !canChat || !event.teamId || !event.id || !messageText.trim() || sending) return;

    shouldFollowLatestRef.current = stickToLatestRef.current || isLiveGameChatNearBottom(messagesScrollRef.current);
    setSending(true);
    setStatus(null);
    try {
      await chatModule.sendLiveGameChatMessage(event.teamId, event.id, {
        text: messageText,
        user: auth.user || undefined,
        anonymousDisplayName
      });
      setMessageText('');
      setStatus({ tone: 'success', message: 'Message sent.' });
    } catch (sendError: any) {
      setStatus({ tone: 'error', message: sendError?.message || 'Unable to send message.' });
    } finally {
      setSending(false);
    }
  };

  if (!event.isDbGame) return null;

  return (
    <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50/60 p-3" data-testid="live-game-chat-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-[0.04em] text-sky-700">Live chat</div>
          <div className="mt-1 text-sm font-semibold text-gray-900">Read and send game-day chat without leaving this screen.</div>
        </div>
        <div className="rounded-full bg-white px-3 py-1 text-xs font-black text-sky-700 shadow-sm">
          {messages.length ? `${messages.length} messages` : 'Ready'}
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-white/80 bg-white p-3 shadow-sm">
        <div
          ref={messagesScrollRef}
          className="max-h-64 overflow-y-auto pr-1"
          aria-label="Live chat messages"
          data-testid="live-game-chat-messages"
          onScroll={handleMessagesScroll}
        >
          <div ref={messagesContentRef} className="space-y-2">
            {loading ? (
              <div className="text-sm font-semibold text-gray-500">Loading live chat…</div>
            ) : messages.length ? messages.map((message) => (
              <article key={message.id} className="rounded-xl border border-gray-100 bg-gray-50 p-2.5" data-testid={`live-chat-message-${message.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-black text-gray-950">{message.senderName || 'Fan'}</div>
                  <div className="text-[11px] font-semibold text-gray-500">{formatLiveGameChatTimestamp(message.createdAt)}</div>
                </div>
                <div className="mt-1 text-sm font-semibold leading-5 text-gray-700">{String(message.text || '').trim() || ' '}</div>
              </article>
            )) : (
              <div className="text-sm font-semibold text-gray-500">No messages yet. Start the game-day chat.</div>
            )}
            <div ref={messagesEndRef} aria-hidden="true" />
          </div>
        </div>

        <form className="mt-3 space-y-2" onSubmit={sendMessage}>
          {!auth.user ? (
            <label className="block">
              <span className="app-label">Display name</span>
              <input
                className="auth-input mt-1 min-h-10 !px-3 !py-2 text-sm"
                value={anonymousDisplayName}
                onChange={(changeEvent) => setAnonymousDisplayName(changeEvent.target.value)}
                maxLength={60}
                placeholder="Your name"
                disabled={!canChat || sending}
              />
            </label>
          ) : null}
          <label className="block">
            <span className="sr-only">Live chat message</span>
            <textarea
              aria-label="Live chat message"
              className="auth-input min-h-24 resize-none !px-3 !py-2 text-sm font-semibold"
              value={messageText}
              onChange={(changeEvent) => setMessageText(changeEvent.target.value)}
              placeholder={canChat ? 'Send a message to fans and parents' : 'Live chat is locked'}
              maxLength={280}
              disabled={!canChat || sending}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-gray-500">{chatNotice || 'Shared with the same live-game chat stream as the web viewer.'}</div>
            <button
              type="submit"
              className="primary-button min-h-10 px-4 text-sm disabled:opacity-60"
              disabled={!canSend}
            >
              {sending ? 'Sending' : 'Send'}
            </button>
          </div>
        </form>
      </div>

      {status ? <div className="mt-3"><Status tone={status.tone} message={status.message} /></div> : null}
    </div>
  );
}

function LazyGameHubPanel({
  panelId,
  title,
  description,
  open,
  onToggle,
  children
}: {
  panelId: string;
  title: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mt-3">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition hover:border-primary-200 hover:bg-primary-50"
        onClick={onToggle}
        aria-label={title}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <div className="min-w-0">
          <div className="text-sm font-black text-gray-950">{title}</div>
          <div className="mt-1 text-xs font-semibold text-gray-500">{description}</div>
        </div>
        <ChevronDown className={`h-4 w-4 flex-none text-gray-500 transition ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open ? <div id={panelId}>{children}</div> : null}
    </div>
  );
}

const LiveGameClockNowContext = createContext<Date | null>(null);

function LiveGameClockTickerProvider({ event, children }: { event: ParentScheduleEvent; children: ReactNode }) {
  const [clockNow, setClockNow] = useState(() => new Date());

  useEffect(() => {
    setClockNow(new Date());
    if (!event.liveClockRunning) return undefined;
    const intervalId = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => window.clearInterval(intervalId);
  }, [event.eventKey, event.liveClockMs, event.liveClockRunning, event.liveClockPeriod, event.liveClockUpdatedAt]);

  return <LiveGameClockNowContext.Provider value={clockNow}>{children}</LiveGameClockNowContext.Provider>;
}

function useLiveGameClockNow() {
  return useContext(LiveGameClockNowContext) || new Date();
}

function GameHubLiveClockBadge({ event }: { event: ParentScheduleEvent }) {
  const clockNow = useLiveGameClockNow();
  const liveClockView = getLiveClockViewModel(event, clockNow);

  if (!liveClockView) return null;

  return (
    <div className="inline-flex min-h-6 items-center rounded-full border border-rose-200 bg-rose-50 px-2 text-[11px] font-extrabold uppercase tracking-[0.04em] text-rose-700 tabular-nums" aria-label="Live game clock">
      {liveClockView.label}
    </div>
  );
}

function GameHubSection({ auth, event, childEvents, onScoreUpdated, onLiveClockUpdated, onWrapupCompleted, onStatsheetImported, onGameCancelled, onPracticeOccurrenceCancelled, onGamePlanPublished }: { auth: AuthState; event: ParentScheduleEvent; childEvents: ParentScheduleEvent[]; onScoreUpdated: (homeScore: number, awayScore: number) => void; onLiveClockUpdated: (payload: Partial<ParentScheduleEvent> & { period?: string | null }) => void; onWrapupCompleted: (payload: { homeScore: number; awayScore: number; postGameNotes: string; summary: string; practiceFeedItems: PracticeFeedItem[] }) => void; onStatsheetImported: (payload: { homeScore: number; awayScore: number; statSheetPhotoUrl?: string | null }) => void; onGameCancelled: () => void; onPracticeOccurrenceCancelled: () => void; onGamePlanPublished: (gamePlan: Record<string, any>) => void }) {
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [cancelStatus, setCancelStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({});
  const statusLabel = getEventStatusLabel(event);
  const scoreLabel = getScoreLabel(event);
  const isPractice = event.type === 'practice';
  const showAdminPracticeTimeline = Boolean(isPractice && event.isTeamAdmin);
  const showNonAdminPracticePacketFirst = Boolean(isPractice && !event.isTeamAdmin);
  const canUpdateScore = Boolean(!isPractice && event.isDbGame && !event.isCancelled && event.canUpdateScore && auth.user);
  const canWrapup = canUpdateScore;
  const canCancelGame = Boolean(!isPractice && event.isDbGame && !event.isCancelled && event.canUpdateScore && auth.user);
  const canCancelPracticeOccurrence = Boolean(isPractice && event.isDbGame && !event.isCancelled && event.isTeamAdmin && auth.user && event.id.includes('__'));
  const canPublishLineup = Boolean(!isPractice && event.isDbGame && event.isTeamStaff);
  const notifiesCounterpartTeam = Boolean(event.opponentTeamId || event.sharedScheduleOpponentTeamId);
  const hubDestinations = isPractice ? buildPracticeHubDestinations(event) : buildGameHubDestinations(event);
  const standardTrackerHref = `/schedule/${encodeURIComponent(event.teamId)}/${encodeURIComponent(event.id)}/track`;

  useEffect(() => {
    setOpenPanels({});
  }, [event.eventKey]);

  const togglePanel = useCallback((panelId: string) => {
    setOpenPanels((current) => ({
      ...current,
      [panelId]: !current[panelId]
    }));
  }, []);

  const cancelGame = async () => {
    if (!auth.user) return;
    const opponentLabel = event.opponent || event.title || 'this game';
    const confirmed = window.confirm(`Cancel ${opponentLabel} on ${formatEventDateLabel(event.date)}? This marks the game cancelled and notifies ${notifiesCounterpartTeam ? 'both team chats' : 'the team in chat'}.`);
    if (!confirmed) return;

    setCancelling(true);
    setCancelStatus(null);
    try {
      const result = await cancelScheduledGameForApp(event, auth.user);
      onGameCancelled();
      setCancelStatus(result.notificationError
        ? { tone: 'error', message: `Game cancelled, but team chat notification failed: ${result.notificationError}` }
        : { tone: 'success', message: notifiesCounterpartTeam ? 'Game cancelled and both team chats notified.' : 'Game cancelled and team chat notified.' });
    } catch (error: any) {
      setCancelStatus({ tone: 'error', message: error?.message || 'Unable to cancel game.' });
    } finally {
      setCancelling(false);
    }
  };

  const cancelPracticeOccurrence = async () => {
    if (!auth.user) return;
    const practiceLabel = event.title || 'this practice';
    const confirmed = window.confirm(`Cancel only ${practiceLabel} on ${formatEventDateLabel(event.date)}? This cancels just this occurrence, not the full recurring series.`);
    if (!confirmed) return;

    setCancelling(true);
    setCancelStatus(null);
    try {
      await cancelPracticeOccurrenceForApp(event, auth.user);
      onPracticeOccurrenceCancelled();
      setCancelStatus({ tone: 'success', message: 'Practice occurrence cancelled for this date only.' });
    } catch (error: any) {
      setCancelStatus({ tone: 'error', message: error?.message || 'Unable to cancel practice occurrence.' });
    } finally {
      setCancelling(false);
    }
  };

  const sharePublicDestination = async (destination: { title: string; text: string; url?: string; label: string }) => {
    setShareStatus(null);
    const clipboardText = destination.url ? `${destination.text}\n${destination.url}` : destination.text;
    const result = await sharePublicUrl({
      title: destination.title,
      text: destination.text,
      url: destination.url,
      clipboardText
    });
    if (result === 'shared') {
      setShareStatus(`${destination.label} share sheet opened.`);
    } else if (result === 'copied') {
      setShareStatus(destination.url ? `${destination.label} link copied.` : `${destination.label} details copied.`);
    } else if (result === 'failed') {
      setShareStatus(`Unable to share ${destination.label.toLowerCase()} from this device.`);
    }
  };

  return (
    <section className="space-y-3">
      {showNonAdminPracticePacketFirst ? <PracticePacketSection auth={auth} event={event} childEvents={childEvents} /> : null}
      {showAdminPracticeTimeline ? <PracticeTimelineSection auth={auth} event={event} /> : null}
      {!isPractice && event.isTeamAdmin && event.isDbGame && !event.isCancelled ? <GameScheduleEditPanel auth={auth} event={event} /> : null}
      {isPractice && event.isTeamAdmin && event.isDbGame && !event.isCancelled ? <PracticeScheduleEditPanel auth={auth} event={event} /> : null}
      {isPractice && event.isTeamAdmin && event.isDbGame && !event.isCancelled ? <StaffPracticePacketEditor auth={auth} event={event} childEvents={childEvents} /> : null}
      {isPractice && !showNonAdminPracticePacketFirst ? <PracticePacketSection auth={auth} event={event} childEvents={childEvents} /> : null}
      <div className="app-card overflow-hidden p-0">
        <div className="border-b border-gray-100 px-3 py-3 sm:px-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="app-section-title">{isPractice ? 'Practice hub' : 'Game hub'}</h2>
              <div className="mt-1 text-xs font-semibold text-gray-500">{event.teamName} · {event.childName}</div>
            </div>
            <span className={`inline-flex min-h-6 flex-none items-center rounded-full border px-2 text-[11px] font-extrabold uppercase tracking-[0.04em] ${getEventStatusClasses(event)}`}>
              {statusLabel}
            </span>
          </div>
        </div>

        <div className="px-3 py-3 sm:px-4">
          <LiveGameClockTickerProvider event={event}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-black text-gray-950">{isPractice ? event.title || 'Practice' : getScheduleTitle(event)}</div>
                <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs font-semibold text-gray-500">
                  <span>{formatEventDateLabel(event.date)} · {formatEventTimeLabel(event.date)}</span>
                  <span className="min-w-0 truncate">{event.location || 'Location TBD'}</span>
                </div>
              </div>
              <div className="flex flex-none flex-col items-end gap-1 text-right">
                {scoreLabel ? <div className="text-2xl font-black tabular-nums text-gray-950">{scoreLabel}</div> : null}
                <GameHubLiveClockBadge event={event} />
              </div>
            </div>

            {canUpdateScore ? <LiveGameClockPanel auth={auth} event={event} onLiveClockUpdated={onLiveClockUpdated} /> : null}
          </LiveGameClockTickerProvider>
          {canUpdateScore ? (
            <Link to={standardTrackerHref} className="secondary-button mt-3 min-h-11 w-full justify-center px-4 text-sm" data-testid="standard-tracker-launch">
              <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
              Standard tracker
            </Link>
          ) : null}
          {canUpdateScore ? <LiveScoreEditor auth={auth} event={event} onScoreUpdated={onScoreUpdated} /> : null}
          {canUpdateScore ? <GameDayFoulTrackerPanel auth={auth} event={event} /> : null}

          {!isPractice ? (
            <LazyGameHubPanel
              panelId="game-hub-reactions-panel"
              title="Live reactions"
              description="Start the shared reaction stream only when you need it."
              open={Boolean(openPanels.reactions)}
              onToggle={() => togglePanel('reactions')}
            >
              <LiveGameReactionsPanel auth={auth} event={event} />
            </LazyGameHubPanel>
          ) : null}
          {!isPractice ? (
            <LazyGameHubPanel
              panelId="game-hub-chat-panel"
              title="Live chat"
              description="Open chat on demand instead of subscribing during first paint."
              open={Boolean(openPanels.chat)}
              onToggle={() => togglePanel('chat')}
            >
              <LiveGameChatPanel auth={auth} event={event} />
            </LazyGameHubPanel>
          ) : null}

          {canWrapup ? (
            <LazyGameHubPanel
              panelId="game-hub-wrapup-panel"
              title="Post-game wrap-up"
              description="Load wrap-up tools only when staff is ready to finish the game."
              open={Boolean(openPanels.wrapup)}
              onToggle={() => togglePanel('wrapup')}
            >
              <GameWrapupPanel auth={auth} event={event} onWrapupCompleted={onWrapupCompleted} />
            </LazyGameHubPanel>
          ) : null}

          {canWrapup ? (
            <LazyGameHubPanel
              panelId="game-hub-statsheet-panel"
              title="Statsheet import"
              description="Defer photo analysis and roster context until someone opens import."
              open={Boolean(openPanels.statsheet)}
              onToggle={() => togglePanel('statsheet')}
            >
              <StatsheetImportPanel event={event} onImported={onStatsheetImported} />
            </LazyGameHubPanel>
          ) : null}

          {canPublishLineup ? (
            <LazyGameHubPanel
              panelId="game-hub-lineup-panel"
              title="Lineup builder"
              description="Only load lineup preview data after staff opens lineup tools."
              open={Boolean(openPanels.lineup)}
              onToggle={() => togglePanel('lineup')}
            >
              <GameHubLineupBuilderPanel auth={auth} event={event} onGamePlanSaved={onGamePlanPublished} />
            </LazyGameHubPanel>
          ) : null}

          {canPublishLineup ? (
            <LazyGameHubPanel
              panelId="game-hub-substitutions-panel"
              title="Live substitutions"
              description="Keep substitution planning idle until the bench actually needs it."
              open={Boolean(openPanels.substitutions)}
              onToggle={() => togglePanel('substitutions')}
            >
              <GameDaySubstitutionPanel auth={auth} event={event} />
            </LazyGameHubPanel>
          ) : null}

          {canCancelGame ? (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-black uppercase tracking-[0.04em] text-rose-700">Schedule management</div>
                  <div className="mt-1 text-sm font-semibold text-rose-900">{notifiesCounterpartTeam ? 'Cancel this game and notify both team chats.' : 'Cancel this game and notify the team chat.'}</div>
                </div>
                <button
                  type="button"
                  className="min-h-11 rounded-full bg-rose-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-60"
                  onClick={cancelGame}
                  disabled={cancelling}
                >
                  {cancelling ? 'Cancelling game' : 'Cancel game'}
                </button>
              </div>
            </div>
          ) : null}

          {canCancelPracticeOccurrence ? (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-black uppercase tracking-[0.04em] text-rose-700">Schedule management</div>
                  <div className="mt-1 text-sm font-semibold text-rose-900">Cancel only this recurring practice occurrence.</div>
                </div>
                <button
                  type="button"
                  className="min-h-11 rounded-full bg-rose-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-60"
                  onClick={cancelPracticeOccurrence}
                  disabled={cancelling}
                >
                  {cancelling ? 'Cancelling occurrence' : 'Cancel this occurrence'}
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {hubDestinations.map((destination) => (
              <GameHubDestinationCard
                key={destination.id}
                destination={destination}
                onShare={() => sharePublicDestination({
                  title: destination.shareTitle,
                  text: destination.shareText,
                  url: destination.shareUrl === null ? undefined : (destination.shareUrl || destination.url),
                  label: destination.shareLabel
                })}
              />
            ))}
          </div>
        </div>
      </div>

      {shareStatus ? <Status tone={shareStatus.startsWith('Unable') ? 'error' : 'success'} message={shareStatus} /> : null}
      {cancelStatus ? <Status tone={cancelStatus.tone} message={cancelStatus.message} /> : null}
      {!isPractice ? (
        <LazyGameHubPanel
          panelId="game-hub-report-panel"
          title="Report sections"
          description="Load reports and live play refreshes only when someone opens reports."
          open={Boolean(openPanels.report)}
          onToggle={() => togglePanel('report')}
        >
          <GameReportSections event={event} />
        </LazyGameHubPanel>
      ) : null}
    </section>
  );
}

function StatsheetImportPanel({ event, onImported }: { event: ParentScheduleEvent; onImported: (payload: { homeScore: number; awayScore: number; statSheetPhotoUrl?: string | null }) => void }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const previewUrlRef = useRef<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('')
  const [roster, setRoster] = useState<any[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [homeRows, setHomeRows] = useState<TrackStatsheetReviewRow[]>([])
  const [visitorRows, setVisitorRows] = useState<TrackStatsheetReviewRow[]>([])
  const [homeScore, setHomeScore] = useState(Math.max(0, Number(event.homeScore ?? 0)))
  const [awayScore, setAwayScore] = useState(Math.max(0, Number(event.awayScore ?? 0)))
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [matchHint, setMatchHint] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [loadingContext, setLoadingContext] = useState(false)
  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState('')

  useEffect(() => () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  const ensureContext = useCallback(async () => {
    if (roster.length && columns.length) {
      return { roster, columns }
    }
    setLoadingContext(true)
    try {
      const context = await loadTrackStatsheetContextForApp(event.teamId, event.id)
      const nextRoster = Array.isArray(context.roster) ? context.roster : []
      const nextColumns = Array.isArray(context.config?.columns) ? context.config.columns : []
      setRoster(nextRoster)
      setColumns(nextColumns)
      return { roster: nextRoster, columns: nextColumns }
    } finally {
      setLoadingContext(false)
    }
  }, [columns.length, event.id, event.teamId, roster])

  const setPreviewFile = useCallback((nextFile: File | null) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = ''
    }
    setFile(nextFile)
    if (!nextFile) {
      setPhotoPreviewUrl('')
      return
    }
    const nextPreviewUrl = URL.createObjectURL(nextFile)
    previewUrlRef.current = nextPreviewUrl
    setPhotoPreviewUrl(nextPreviewUrl)
  }, [])

  useEffect(() => {
    setPreviewFile(null)
    setRoster([])
    setColumns([])
    setHomeRows([])
    setVisitorRows([])
    setHomeScore(Math.max(0, Number(event.homeScore ?? 0)))
    setAwayScore(Math.max(0, Number(event.awayScore ?? 0)))
    setMatchHint('')
    setStatus(null)
    setUploadedPhotoUrl('')
  }, [event.eventKey, event.homeScore, event.awayScore, setPreviewFile])

  const handlePhotoSelection = useCallback((nextFile: File | null) => {
    if (!nextFile) return
    if (!nextFile.type.startsWith('image/')) {
      setStatus({ tone: 'error', message: 'Choose an image file.' })
      return
    }
    setPreviewFile(nextFile)
    setUploadedPhotoUrl('')
    setHomeRows([])
    setVisitorRows([])
    setMatchHint('')
    setStatus(null)
  }, [setPreviewFile])

  const handleNativePhotoChoice = async (source: 'camera' | 'photos') => {
    setStatus(null)
    try {
      const nextFile = await acquireTrackStatsheetPhoto(source)
      handlePhotoSelection(nextFile)
    } catch (error: any) {
      if (error?.code === 'cancelled') return
      if (error?.code === 'unavailable' && source === 'photos') {
        fileInputRef.current?.click()
        return
      }
      const message = error?.code === 'permission-denied'
        ? source === 'camera'
          ? 'Camera permission was denied. Allow camera access to capture a statsheet.'
          : 'Photo permission was denied. Allow photo library access to choose a statsheet.'
        : error?.message || 'Statsheet photo could not be loaded right now.'
      setStatus({ tone: 'error', message })
    }
  }

  const handleAnalyze = async () => {
    if (!file) {
      setStatus({ tone: 'error', message: 'Choose a statsheet photo first.' })
      return
    }
    setAnalyzing(true)
    setStatus(null)
    try {
      const context = await ensureContext()
      const review = await analyzeTrackStatsheetPhoto(file, context.roster)
      setHomeRows(review.homeRows)
      setVisitorRows(review.visitorRows)
      setHomeScore((value) => (value > 0 ? value : review.shouldSwap ? review.awayScore : review.homeScore))
      setAwayScore((value) => (value > 0 ? value : review.shouldSwap ? review.homeScore : review.awayScore))
      setMatchHint(`Roster matches: home ${review.homeMatches}, visitor ${review.visitorMatches}.`)
      setStatus({ tone: 'success', message: 'Analysis complete. Review and adjust before applying.' })
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Failed to analyze this statsheet.' })
    } finally {
      setAnalyzing(false)
    }
  }

  const updateRow = (side: 'home' | 'visitor', index: number, patch: Partial<TrackStatsheetReviewRow>) => {
    const setter = side === 'home' ? setHomeRows : setVisitorRows
    setter((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
  }

  const handleApply = async (replaceExisting = false) => {
    if (!file) {
      setStatus({ tone: 'error', message: 'Choose a statsheet photo first.' })
      return
    }
    setApplying(true)
    setStatus(null)
    try {
      const context = await ensureContext()
      const result = await applyTrackStatsheetImportForApp({
        teamId: event.teamId,
        gameId: event.id,
        roster: context.roster,
        columns: context.columns,
        homeRows,
        visitorRows,
        homeScore,
        awayScore,
        file,
        uploadedPhotoUrl,
        replaceExisting
      })

      if (result.requiresReplaceConfirmation) {
        if (replaceExisting) {
          setStatus({ tone: 'error', message: 'Replacement confirmation could not be completed. Please try again later.' })
          return
        }
        const confirmed = window.confirm('This game already has tracked data. Replace it with the stat sheet results?')
        if (confirmed) {
          await handleApply(true)
        }
        return
      }

      setUploadedPhotoUrl(result.uploadedPhotoUrl || '')
      onImported({
        homeScore,
        awayScore,
        statSheetPhotoUrl: result.uploadedPhotoUrl || null
      })
      setStatus({ tone: 'success', message: 'Stats applied to the game.' })
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to apply statsheet stats.' })
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3" data-testid="statsheet-import-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black uppercase tracking-[0.04em] text-emerald-700">Statsheet import</div>
          <div className="mt-1 text-sm font-semibold text-gray-950">Capture or upload a paper scoresheet, review the mapped stats, then apply the same legacy statsheet writes inside the app.</div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          handlePhotoSelection(event.target.files?.[0] || null)
          event.target.value = ''
        }}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="primary-button min-h-11 px-4 text-sm" onClick={() => void handleNativePhotoChoice('camera')} disabled={analyzing || applying || loadingContext}>
          Take photo
        </button>
        <button type="button" className="secondary-button min-h-11 px-4 text-sm" onClick={() => void handleNativePhotoChoice('photos')} disabled={analyzing || applying || loadingContext}>
          Choose from library
        </button>
        <button type="button" className="secondary-button min-h-11 px-4 text-sm" onClick={() => fileInputRef.current?.click()} disabled={analyzing || applying || loadingContext}>
          Upload file
        </button>
        <button type="button" className="secondary-button min-h-11 px-4 text-sm" onClick={() => void handleAnalyze()} disabled={!file || analyzing || applying || loadingContext}>
          {analyzing ? 'Analyzing' : 'Analyze photo'}
        </button>
      </div>

      {photoPreviewUrl ? (
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-3">
          <img src={photoPreviewUrl} alt="Statsheet preview" className="max-h-72 w-full rounded-xl object-contain" />
        </div>
      ) : null}

      {matchHint ? <div className="mt-3 text-xs font-semibold text-gray-500">{matchHint}</div> : null}

      {homeRows.length ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <ScoreStepper label="Final home" value={homeScore} onDecrease={() => setHomeScore((value) => Math.max(0, value - 1))} onIncrease={() => setHomeScore((value) => value + 1)} disabled={applying} />
            <ScoreStepper label="Final away" value={awayScore} onDecrease={() => setAwayScore((value) => Math.max(0, value - 1))} onIncrease={() => setAwayScore((value) => value + 1)} disabled={applying} />
          </div>

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-3 py-2 text-xs font-black uppercase tracking-[0.04em] text-gray-500">Home rows</div>
            <div className="divide-y divide-gray-100">
              {homeRows.map((row, index) => (
                <div key={`home-${index}`} className="grid gap-2 px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_88px_88px_88px_minmax(0,1fr)] sm:items-center">
                  <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                    <input type="checkbox" checked={row.include} onChange={(event) => updateRow('home', index, { include: event.target.checked })} />
                    Include
                  </label>
                  <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900" value={row.name} onChange={(event) => updateRow('home', index, { name: event.target.value })} aria-label={`Home player ${index + 1} name`} />
                  <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900" value={row.number} onChange={(event) => updateRow('home', index, { number: event.target.value })} aria-label={`Home player ${index + 1} number`} />
                  <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900" type="number" min="0" value={row.totalPoints} onChange={(event) => updateRow('home', index, { totalPoints: Number(event.target.value || 0) })} aria-label={`Home player ${index + 1} points`} />
                  <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900" type="number" min="0" value={row.fouls} onChange={(event) => updateRow('home', index, { fouls: Number(event.target.value || 0) })} aria-label={`Home player ${index + 1} fouls`} />
                  <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900" value={row.mappedPlayerId} onChange={(event) => updateRow('home', index, { mappedPlayerId: event.target.value })} aria-label={`Home player ${index + 1} roster match`}>
                    <option value="">Unmatched</option>
                    {roster.map((player) => <option key={player.id} value={player.id}>{`#${player.number || '-'} ${player.name || 'Player'}`}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-3 py-2 text-xs font-black uppercase tracking-[0.04em] text-gray-500">Visitor rows</div>
            <div className="divide-y divide-gray-100">
              {visitorRows.map((row, index) => (
                <div key={`visitor-${index}`} className="grid gap-2 px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_88px_88px_88px] sm:items-center">
                  <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                    <input type="checkbox" checked={row.include} onChange={(event) => updateRow('visitor', index, { include: event.target.checked })} />
                    Include
                  </label>
                  <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900" value={row.name} onChange={(event) => updateRow('visitor', index, { name: event.target.value })} aria-label={`Visitor player ${index + 1} name`} />
                  <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900" value={row.number} onChange={(event) => updateRow('visitor', index, { number: event.target.value })} aria-label={`Visitor player ${index + 1} number`} />
                  <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900" type="number" min="0" value={row.totalPoints} onChange={(event) => updateRow('visitor', index, { totalPoints: Number(event.target.value || 0) })} aria-label={`Visitor player ${index + 1} points`} />
                  <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900" type="number" min="0" value={row.fouls} onChange={(event) => updateRow('visitor', index, { fouls: Number(event.target.value || 0) })} aria-label={`Visitor player ${index + 1} fouls`} />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="primary-button min-h-11 px-4 text-sm" onClick={() => void handleApply()} disabled={applying || analyzing || loadingContext}>
              {applying ? 'Applying' : 'Apply to game'}
            </button>
            <span className="text-xs font-semibold text-gray-500">Existing tracked data will require replacement confirmation.</span>
          </div>
        </div>
      ) : null}

      {status ? <div className="mt-3"><Status tone={status.tone} message={status.message} /></div> : null}
    </div>
  )
}

function GameWrapupPanel({ auth, event, onWrapupCompleted }: {
  auth: AuthState;
  event: ParentScheduleEvent;
  onWrapupCompleted: (payload: { homeScore: number; awayScore: number; postGameNotes: string; summary: string; practiceFeedItems: PracticeFeedItem[] }) => void;
}) {
  const savedHomeScore = Math.max(0, Number(event.homeScore ?? 0));
  const savedAwayScore = Math.max(0, Number(event.awayScore ?? 0));
  const [homeScore, setHomeScore] = useState(savedHomeScore);
  const [awayScore, setAwayScore] = useState(savedAwayScore);
  const [postGameNotes, setPostGameNotes] = useState(String(event.postGameNotes || ''));
  const [practiceFeedItems, setPracticeFeedItems] = useState<PracticeFeedItem[]>(Array.isArray(event.practiceFeedItems) ? event.practiceFeedItems : []);
  const [summary, setSummary] = useState(String(event.summary || ''));
  const [shouldGenerateSummary, setShouldGenerateSummary] = useState(true);
  const [shouldSendEmail, setShouldSendEmail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setHomeScore(savedHomeScore);
    setAwayScore(savedAwayScore);
    setPostGameNotes(String(event.postGameNotes || ''));
    setPracticeFeedItems(Array.isArray(event.practiceFeedItems) ? event.practiceFeedItems : []);
    setSummary(String(event.summary || ''));
    setShouldGenerateSummary(true);
    setShouldSendEmail(false);
  }, [event.eventKey, event.homeScore, event.awayScore, event.postGameNotes, event.summary, event.practiceFeedItems, savedHomeScore, savedAwayScore]);

  const completeWrapup = async () => {
    if (!auth.user) return;
    const previousScore = { homeScore: savedHomeScore, awayScore: savedAwayScore };
    const trimmedNotes = postGameNotes.trim();
    setSaving(true);
    setStatus(null);
    let finalSummary = String(event.summary || '');
    let finalPracticeFeedItems = Array.isArray(event.practiceFeedItems) ? event.practiceFeedItems as PracticeFeedItem[] : [];

    try {
      const scorePayload = await updateGameScore(event.teamId, event.id, { homeScore, awayScore }, auth.user);
      const nextHomeScore = Number(scorePayload.homeScore ?? homeScore);
      const nextAwayScore = Number(scorePayload.awayScore ?? awayScore);

      if (nextHomeScore !== previousScore.homeScore || nextAwayScore !== previousScore.awayScore) {
        try {
          await publishLiveScoreUpdateEvent(event.teamId, event.id, { homeScore: nextHomeScore, awayScore: nextAwayScore }, auth.user, previousScore);
        } catch (publishError) {
          console.warn('[schedule-event-detail] Wrap-up score saved but live play-by-play posting failed:', publishError);
        }
      }

      let aiFailure = false;
      if (shouldGenerateSummary) {
        try {
          const artifacts = await generateGameWrapupArtifactsForApp({
            teamId: event.teamId,
            gameId: event.id,
            score: { home: nextHomeScore, away: nextAwayScore },
            notes: trimmedNotes
          });
          finalSummary = artifacts.summary;
          finalPracticeFeedItems = artifacts.practiceFeedItems;
          setSummary(finalSummary);
          setPracticeFeedItems(finalPracticeFeedItems);
        } catch (aiError) {
          aiFailure = true;
          console.warn('[schedule-event-detail] Wrap-up AI failed:', aiError);
        }
      }

      const completionPayload = buildAppWrapupCompletionPayload({
        homeScore: nextHomeScore,
        awayScore: nextAwayScore,
        postGameNotes: trimmedNotes
      });
      await completeGameWrapupForApp(event.teamId, event.id, {
        ...completionPayload,
        summary: finalSummary,
        practiceFeedItems: finalPracticeFeedItems
      }, auth.user);
      onWrapupCompleted({
        homeScore: nextHomeScore,
        awayScore: nextAwayScore,
        postGameNotes: trimmedNotes,
        summary: finalSummary,
        practiceFeedItems: finalPracticeFeedItems
      });

      if (shouldSendEmail) {
        const emailDraft = buildGameWrapupEmailDraft({
          teamName: event.teamName,
          opponentName: event.opponent || event.title || 'Opponent',
          gameDate: event.date,
          score: { home: nextHomeScore, away: nextAwayScore },
          summary: finalSummary,
          postGameNotes: trimmedNotes,
          teamNotificationEmail: event.teamNotificationEmail,
          userEmail: auth.user.email
        });
        if (emailDraft) {
          window.location.href = emailDraft.mailto;
        }
      }

      setStatus({
        tone: 'success',
        message: aiFailure
          ? 'Wrap-up saved. AI analysis failed, so you can retry by running wrap-up again.'
          : shouldGenerateSummary
            ? `Wrap-up saved with ${finalPracticeFeedItems.length} practice focus ${finalPracticeFeedItems.length === 1 ? 'item' : 'items'}.`
            : shouldSendEmail
              ? 'Wrap-up saved and email recap opened.'
              : 'Wrap-up saved without AI summary.'
      });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to complete wrap-up.' });
    } finally {
      setSaving(false);
    }
  };

  const isCompleted = String(event.liveStatus || event.status || '').trim().toLowerCase() === 'completed';

  return (
    <div className="mt-3 rounded-2xl border border-violet-200 bg-violet-50/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black uppercase tracking-[0.04em] text-violet-700">Post-game wrap-up</div>
          <div className="mt-1 text-sm font-semibold text-gray-950">Confirm the final score, save notes, and write the same AI summary and practice focus fields the web command center uses.</div>
        </div>
        {isCompleted ? <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-violet-700 shadow-sm">Completed</span> : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <ScoreStepper label="Final home" value={homeScore} onDecrease={() => setHomeScore((value) => Math.max(0, value - 1))} onIncrease={() => setHomeScore((value) => value + 1)} disabled={saving} />
        <ScoreStepper label="Final away" value={awayScore} onDecrease={() => setAwayScore((value) => Math.max(0, value - 1))} onIncrease={() => setAwayScore((value) => value + 1)} disabled={saving} />
      </div>

      <label className="mt-3 block text-xs font-black uppercase tracking-[0.04em] text-gray-500" htmlFor="game-wrapup-notes">Post-game notes</label>
      <textarea
        id="game-wrapup-notes"
        className="mt-1 min-h-28 w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-semibold text-gray-900"
        value={postGameNotes}
        onChange={(changeEvent) => setPostGameNotes(changeEvent.target.value)}
        placeholder="What changed the game? What should practice fix next?"
        disabled={saving}
      />

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-semibold text-gray-900">
          <input type="checkbox" checked={shouldGenerateSummary} onChange={(changeEvent) => setShouldGenerateSummary(changeEvent.target.checked)} disabled={saving} />
          <span>Generate AI summary</span>
        </label>
        <label className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-semibold text-gray-900">
          <input type="checkbox" checked={shouldSendEmail} onChange={(changeEvent) => setShouldSendEmail(changeEvent.target.checked)} disabled={saving} />
          <span>Email recap after save</span>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="primary-button min-h-11 px-4 text-sm"
          onClick={completeWrapup}
          disabled={saving}
        >
          {saving ? 'Saving wrap-up' : isCompleted ? 'Run wrap-up again' : 'Complete wrap-up'}
        </button>
        <span className="text-xs font-semibold text-gray-500">AI failures do not block completion. Uncheck AI summary to skip it, or run wrap-up again to regenerate.</span>
      </div>

      {status ? <div className={`mt-3 text-sm font-semibold ${status.tone === 'error' ? 'text-rose-700' : 'text-emerald-700'}`}>{status.message}</div> : null}

      {practiceFeedItems.length ? (
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-3">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Suggested practice focus</div>
          <div className="mt-2 space-y-2">
            {practiceFeedItems.slice(0, 4).map((item, index) => (
              <div key={`${item.weakness}-${index}`} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-black text-gray-950">{item.weakness || 'Practice focus'}</div>
                  <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase text-gray-600">{item.urgency || 'medium'}</span>
                </div>
                {item.evidence ? <div className="mt-1 text-sm font-semibold text-gray-700">{item.evidence}</div> : null}
                {item.drillCategory ? <div className="mt-1 text-xs font-semibold text-gray-500">Drill category: {item.drillCategory}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {summary ? (
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-3">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Saved summary</div>
          <ReportMarkdownText text={summary} compact />
        </div>
      ) : null}
    </div>
  );
}

type GameDayLogEntry = {
  id: string;
  createdAtMs: number;
  timeLabel: string;
  period: string;
  kind: 'substitution' | 'score' | 'stat' | 'note';
  text: string;
};

function toGameDayTimestamp(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatGameDayTimeLabel(value: unknown) {
  const timestamp = toGameDayTimestamp(value);
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function buildGameDayLogEntries(coachingNotes: ParentScheduleEvent['coachingNotes'] = [], liveEvents: ParentScheduleEvent['liveEvents'] = []) {
  const noteEntries: GameDayLogEntry[] = (Array.isArray(coachingNotes) ? coachingNotes : []).map((note, index) => ({
    id: `note-${index}-${String(note?.createdAt || '')}`,
    createdAtMs: toGameDayTimestamp(note?.createdAt),
    timeLabel: formatGameDayTimeLabel(note?.createdAt),
    period: String(note?.period || '').trim(),
    kind: note?.type === 'substitution' ? 'substitution' : 'note',
    text: String(note?.text || '').trim()
  }));

  const liveEntries: GameDayLogEntry[] = (Array.isArray(liveEvents) ? liveEvents : []).map((entry, index) => ({
    id: String(entry?.eventId || entry?.id || `event-${index}`),
    createdAtMs: toGameDayTimestamp(entry?.createdAt),
    timeLabel: formatGameDayTimeLabel(entry?.createdAt),
    period: String(entry?.period || '').trim(),
    kind: entry?.type === 'score_update' ? 'score' : 'stat',
    text: String(entry?.description || '').trim() || [entry?.playerName, entry?.stat || entry?.type].filter(Boolean).join(' ')
  }));

  return [...noteEntries, ...liveEntries]
    .filter((entry) => entry.text)
    .sort((left, right) => right.createdAtMs - left.createdAtMs || left.id.localeCompare(right.id));
}

function formatSubstitutionPlayer(player: { name?: string; number?: string | null } | null | undefined) {
  if (!player) return 'Player';
  return `${player.number ? `#${player.number} ` : ''}${player.name || 'Player'}`;
}

function GameDaySubstitutionPanel({ auth, event }: { auth: AuthState; event: ParentScheduleEvent }) {
  const formationId = event.gamePlan?.publishedFormationId || event.gamePlan?.formationId || '';
  const [players, setPlayers] = useState<Array<{ id: string; name: string; number?: string | null }>>([]);
  const [rotationPlan, setRotationPlan] = useState<Record<string, any>>(() => event.rotationPlan || buildRotationPlanFromGamePlan(event.gamePlan || {}));
  const [rotationActual, setRotationActual] = useState<Record<string, any>>(() => event.rotationActual || {});
  const [coachingNotes, setCoachingNotes] = useState<any[]>(() => Array.isArray(event.coachingNotes) ? event.coachingNotes : []);
  const [liveEvents, setLiveEvents] = useState<any[]>(() => Array.isArray(event.liveEvents) ? event.liveEvents : []);
  const [period, setPeriod] = useState('');
  const [outPlayerId, setOutPlayerId] = useState('');
  const [inPlayerId, setInPlayerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const periods = useMemo(() => Object.keys(rotationPlan || {}), [rotationPlan]);
  const activePeriod = period || periods[0] || '';
  const projectedTime = useMemo(() => buildProjectedPlayingTimeSummary(formationId, event.gamePlan || null, players as any), [formationId, event.gamePlan, players]);
  const subOptions = useMemo(() => getSubstitutionOptions({
    period: activePeriod,
    rotationPlan,
    rotationActual,
    players
  }), [activePeriod, rotationPlan, rotationActual, players]);
  const logEntries = useMemo(() => buildGameDayLogEntries(coachingNotes, liveEvents), [coachingNotes, liveEvents]);

  useEffect(() => {
    const nextPlan = event.rotationPlan || buildRotationPlanFromGamePlan(event.gamePlan || {});
    setRotationPlan(nextPlan);
    setRotationActual(event.rotationActual || {});
    setCoachingNotes(Array.isArray(event.coachingNotes) ? event.coachingNotes : []);
    setLiveEvents(Array.isArray(event.liveEvents) ? event.liveEvents : []);
    setPeriod('');
    setOutPlayerId('');
    setInPlayerId('');
    setStatus(null);
  }, [event.eventKey, event.gamePlan, event.rotationPlan, event.rotationActual, event.coachingNotes, event.liveEvents]);

  useEffect(() => {
    if (!auth.user || !formationId || event.isCancelled) {
      setPlayers([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      loadAutoFilledLineupDraftPreviewForApp(event, auth.user, formationId),
      loadGameDayLiveEventsForApp(event.teamId, event.id)
    ])
      .then(([preview, loadedLiveEvents]) => {
        if (cancelled) return;
        const loadedPlayers = buildLineupEditorPlayers(preview?.availablePlayers || [], preview?.goingPlayers || []);
        setPlayers(loadedPlayers.map((player) => ({ id: player.id, name: player.name, number: player.number || null })));
        setLiveEvents(Array.isArray(loadedLiveEvents) ? loadedLiveEvents : []);
      })
      .catch((error: any) => {
        if (cancelled) return;
        setPlayers([]);
        setStatus({ tone: 'error', message: error?.message || 'Unable to load substitution data.' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [auth.user, event.teamId, event.id, event.gamePlan, event.isCancelled, formationId]);

  useEffect(() => {
    if (period && periods.includes(period)) return;
    setPeriod(periods[0] || '');
  }, [period, periods]);

  useEffect(() => {
    if (!subOptions.onFieldPlayers.some((player: any) => player.id === outPlayerId)) {
      setOutPlayerId(subOptions.onFieldPlayers[0]?.id || '');
    }
    if (!subOptions.offFieldPlayers.some((player: any) => player.id === inPlayerId)) {
      setInPlayerId(subOptions.offFieldPlayers[0]?.id || '');
    }
  }, [subOptions.onFieldPlayers, subOptions.offFieldPlayers, outPlayerId, inPlayerId]);

  const executeSubstitution = async () => {
    if (!auth.user || !activePeriod || !outPlayerId || !inPlayerId) return;
    const now = new Date();
    const result = applyLiveSubstitution({
      period: activePeriod,
      outId: outPlayerId,
      inId: inPlayerId,
      rotationPlan,
      rotationActual,
      players,
      now
    });
    if (!result) {
      setStatus({ tone: 'error', message: 'Choose an on-field player and an available substitute.' });
      return;
    }

    const note = {
      type: 'substitution',
      period: activePeriod,
      text: `${formatSubstitutionPlayer(result.inPlayer)} for ${formatSubstitutionPlayer(result.outPlayer)} at ${result.position}`,
      createdAt: now.toISOString(),
      createdBy: auth.user.uid,
      createdByName: auth.user.displayName || auth.user.email || 'Staff'
    };
    const nextNotes = [...coachingNotes, note];
    setSaving(true);
    setStatus(null);
    try {
      const saved = await saveGameDaySubstitutionForApp(event.teamId, event.id, auth.user, {
        rotationPlan: result.rotationPlan,
        rotationActual: result.rotationActual,
        coachingNotes: nextNotes
      });
      setRotationPlan(saved.rotationPlan || result.rotationPlan);
      setRotationActual(saved.rotationActual || result.rotationActual);
      setCoachingNotes(saved.coachingNotes || nextNotes);
      setStatus({ tone: 'success', message: 'Substitution saved to the shared game-day log.' });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to save substitution.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-2xl border border-cyan-200 bg-cyan-50/70 p-3" data-testid="game-day-substitution-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-[0.04em] text-cyan-700">Substitution plan</div>
          <div className="mt-1 text-sm font-semibold text-gray-950">Run the published lineup rotation and live log from the same game-day fields as the web command center.</div>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-cyan-700 shadow-sm">{loading ? 'Loading' : `${periods.length} periods`}</span>
      </div>

      {periods.length && players.length ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <label className="text-xs font-black uppercase tracking-[0.04em] text-cyan-700">
              Period
              <select className="mt-1 min-h-11 w-full rounded-xl border border-cyan-200 bg-white px-3 text-sm font-semibold text-gray-900" value={activePeriod} onChange={(changeEvent) => setPeriod(changeEvent.target.value)} disabled={saving}>
                {periods.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
              </select>
            </label>
            <label className="text-xs font-black uppercase tracking-[0.04em] text-cyan-700">
              Out
              <select className="mt-1 min-h-11 w-full rounded-xl border border-cyan-200 bg-white px-3 text-sm font-semibold text-gray-900" value={outPlayerId} onChange={(changeEvent) => setOutPlayerId(changeEvent.target.value)} disabled={saving || !subOptions.onFieldPlayers.length}>
                {subOptions.onFieldPlayers.map((player: any) => <option key={player.id} value={player.id}>{formatSubstitutionPlayer(player)}</option>)}
              </select>
            </label>
            <label className="text-xs font-black uppercase tracking-[0.04em] text-cyan-700">
              In
              <select className="mt-1 min-h-11 w-full rounded-xl border border-cyan-200 bg-white px-3 text-sm font-semibold text-gray-900" value={inPlayerId} onChange={(changeEvent) => setInPlayerId(changeEvent.target.value)} disabled={saving || !subOptions.offFieldPlayers.length}>
                {subOptions.offFieldPlayers.map((player: any) => <option key={player.id} value={player.id}>{formatSubstitutionPlayer(player)}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="primary-button min-h-11 px-4 text-sm" onClick={executeSubstitution} disabled={saving || !outPlayerId || !inPlayerId}>
              {saving ? 'Saving sub' : 'Execute sub'}
            </button>
            <span className="text-xs font-semibold text-gray-500">Writes rotationPlan, rotationActual, and coachingNotes for web/app handoff.</span>
          </div>
        </>
      ) : (
        <div className="mt-3 rounded-xl border border-cyan-100 bg-white p-3 text-sm font-semibold text-gray-600">
          Publish a lineup first to enable live substitution planning.
        </div>
      )}

      {projectedTime.length ? (
        <div className="mt-3 rounded-xl border border-cyan-100 bg-white p-3">
          <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Projected playing time</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {projectedTime.slice(0, 8).map((row) => (
              <div key={row.playerId} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2 py-2 text-sm font-semibold">
                <span className="min-w-0 truncate">{row.playerNumber ? `#${row.playerNumber} ` : ''}{row.playerName}</span>
                <span className="flex-none tabular-nums text-gray-700">{Math.round(row.minutes)} min</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 rounded-xl border border-cyan-100 bg-white p-3">
        <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Live log</div>
        <div className="mt-2 space-y-2">
          {logEntries.length ? logEntries.slice(0, 8).map((entry) => (
            <div key={entry.id} className="rounded-lg border border-gray-100 bg-gray-50 px-2 py-2">
              <div className="text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">{entry.kind}{entry.period ? ` · ${entry.period}` : ''}{entry.timeLabel ? ` · ${entry.timeLabel}` : ''}</div>
              <div className="mt-0.5 text-sm font-semibold text-gray-900">{entry.text}</div>
            </div>
          )) : <div className="text-sm font-semibold text-gray-500">Subs and score events will appear here in game order.</div>}
        </div>
      </div>

      {status ? <div className={`mt-3 text-sm font-semibold ${status.tone === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{status.message}</div> : null}
    </div>
  );
}

function GameHubLineupBuilderPanel({ auth, event, onGamePlanSaved }: { auth: AuthState; event: ParentScheduleEvent; onGamePlanSaved: (gamePlan: Record<string, any>) => void }) {
  const [formationId, setFormationId] = useState(event.gamePlan?.formationId || '');
  const [preview, setPreview] = useState<LineupDraftPreviewResult | null>(null);
  const [draftLineups, setDraftLineups] = useState<Record<string, string>>({});
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const latestDraftRef = useRef<Record<string, string>>({});
  const latestPreviewRef = useRef<LineupDraftPreviewResult | null>(null);

  const formation = LINEUP_FORMATIONS[formationId] || null;
  const lineupPeriods = useMemo(() => getOrderedLineupPeriods(formationId, preview?.gamePlan || event.gamePlan || null), [formationId, preview?.gamePlan, event.gamePlan]);
  const editorPlayers = useMemo(() => buildLineupEditorPlayers(preview?.availablePlayers || [], preview?.goingPlayers || []), [preview?.availablePlayers, preview?.goingPlayers]);
  const playerById = useMemo(() => new Map(editorPlayers.map((player) => [player.id, player])), [editorPlayers]);
  const hasSavedDraft = hasLineupDraft(preview?.gamePlan ?? event.gamePlan);
  const hasDraft = Object.keys(draftLineups).length > 0 || (!dirtyRef.current && hasSavedDraft);
  const statusCopy = getLineupPublishStatus(event.gamePlan);

  useEffect(() => {
    setFormationId(event.gamePlan?.formationId || '');
    setPreview(null);
    setDraftLineups({});
    setSelectedPlayerId('');
    setStatus(null);
    dirtyRef.current = false;
    latestDraftRef.current = {};
    latestPreviewRef.current = null;
  }, [event.eventKey]);

  useEffect(() => {
    let cancelled = false;
    if (!auth.user || !formationId || event.isCancelled) {
      setPreview(null);
      setDraftLineups({});
      return undefined;
    }

    setLoadingPreview(true);
    loadAutoFilledLineupDraftPreviewForApp(event, auth.user, formationId)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        latestPreviewRef.current = result;
        const seeded = buildLineupEditorAssignments(formationId, result.gamePlan || event.gamePlan || null);
        setDraftLineups(seeded);
        latestDraftRef.current = seeded;
        dirtyRef.current = shouldAutosaveGeneratedLineupDraft(event.gamePlan, result.gamePlan);
      })
      .catch((error: any) => {
        if (cancelled) return;
        setPreview(null);
        setDraftLineups({});
        setStatus({ tone: 'error', message: error?.message || 'Unable to load the lineup builder.' });
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });

    return () => { cancelled = true; };
  }, [auth.user, event.teamId, event.id, event.gamePlan, event.isCancelled, formationId]);

  useEffect(() => {
    latestDraftRef.current = draftLineups;
  }, [draftLineups]);

  const persistDraft = useCallback(async (lineups: Record<string, string>, reason: 'autosave' | 'manual' | 'publish') => {
    if (!shouldPersistLineupDraft(auth.user, formationId, lineups)) return true;
    setSaving(true);
    if (reason !== 'autosave') setStatus(null);
    try {
      const result = await saveScheduledGameLineupDraftForApp(event, auth.user, formationId, { lineups });
      setPreview(result);
      latestPreviewRef.current = result;
      if (result.gamePlan) onGamePlanSaved(result.gamePlan);
      dirtyRef.current = false;
      if (reason !== 'publish') {
        setStatus({ tone: 'success', message: reason === 'autosave' ? 'Lineup draft autosaved.' : 'Lineup draft saved.' });
      }
      return true;
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to save lineup draft.' });
      return false;
    } finally {
      setSaving(false);
    }
  }, [auth.user, event, formationId, onGamePlanSaved]);

  useEffect(() => {
    if (!shouldAutosaveLineupDraft(dirtyRef.current, formationId, draftLineups)) return undefined;
    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = window.setTimeout(() => {
      void persistDraft(latestDraftRef.current, 'autosave');
    }, 800);
    return () => {
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    };
  }, [draftLineups, formationId, persistDraft]);

  const updateDraft = (nextLineups: Record<string, string>) => {
    dirtyRef.current = true;
    setDraftLineups(nextLineups);
  };

  const applySelectedPlayerToSlot = (slotKey: string) => {
    if (!selectedPlayerId) return;
    updateDraft(assignLineupPlayer(draftLineups, slotKey, selectedPlayerId));
  };

  const runAiSuggestion = async () => {
    if (!formation || !preview?.goingPlayers?.length) return;
    setAiLoading(true);
    setStatus(null);
    try {
      const model = await getLineupAiModel();
      const prompt = buildLineupAiPrompt({
        periods: lineupPeriods,
        positions: formation.positions,
        goingPlayers: preview.goingPlayers,
        formationId: formation.id
      });
      const result = await model.generateContent(prompt);
      const suggestion = parseAiLineupPlan(result?.response?.text?.() || '', lineupPeriods, formation.positions, preview.goingPlayers)
        || buildRoundRobinLineup(lineupPeriods, formation.positions, preview.goingPlayers);
      updateDraft(suggestion);
      setStatus({ tone: 'success', message: 'AI lineup suggestion applied. You can still edit every slot.' });
    } catch {
      updateDraft(buildRoundRobinLineup(lineupPeriods, formation.positions, preview?.goingPlayers || []));
      setStatus({ tone: 'success', message: 'AI was unavailable, so a balanced local lineup was applied instead.' });
    } finally {
      setAiLoading(false);
    }
  };

  const publishLineup = async () => {
    if (!auth.user || !hasDraft || publishing) return;
    const saved = await persistDraft(latestDraftRef.current, 'publish');
    if (!saved) return;
    setPublishing(true);
    try {
      const result = await publishGamePlanForApp({ ...event, gamePlan: latestPreviewRef.current?.gamePlan || event.gamePlan }, auth.user);
      onGamePlanSaved(result.gamePlan);
      const version = Number.parseInt(String(result.gamePlan?.publishedVersion || ''), 10) || 0;
      setStatus(result.notificationError
        ? { tone: 'error', message: `Lineup saved${version ? ` as v${version}` : ''}, but team chat notification failed: ${result.notificationError}` }
        : { tone: 'success', message: `Lineup published${version ? ` as v${version}` : ''}. Team chat notified.` });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to publish lineup.' });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black uppercase tracking-[0.04em] text-emerald-700">Lineup builder</div>
          <div className="mt-1 text-sm font-semibold text-gray-950">Build, autosave, and publish the shared game-day lineup.</div>
          <label className="mt-3 block text-xs font-black uppercase tracking-[0.04em] text-gray-500" htmlFor="game-hub-lineup-formation">Formation</label>
          <select
            id="game-hub-lineup-formation"
            className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900"
            value={formationId}
            onChange={(changeEvent) => setFormationId(changeEvent.target.value)}
            disabled={!auth.user || event.isCancelled || saving || publishing}
          >
            <option value="">Select formation</option>
            {Object.values(LINEUP_FORMATIONS).map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-11 rounded-full border border-gray-200 bg-white px-4 text-sm font-black text-gray-700 shadow-sm disabled:opacity-60"
            onClick={runAiSuggestion}
            disabled={!formation || !preview?.goingPlayers?.length || aiLoading || saving || publishing}
          >
            {aiLoading ? 'Suggesting lineup' : 'AI suggest'}
          </button>
          <button
            type="button"
            className="min-h-11 rounded-full bg-primary-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60"
            onClick={publishLineup}
            disabled={!auth.user || !hasDraft || event.isCancelled || publishing || saving}
          >
            {publishing ? 'Publishing lineup' : 'Publish lineup'}
          </button>
        </div>
      </div>
      <div className="mt-3 text-sm font-semibold text-gray-700">{statusCopy}</div>
      {loadingPreview ? <div className="mt-3 text-sm font-semibold text-gray-500">Loading lineup builder…</div> : null}
      {formation && preview ? (
        <>
          <div className="mt-3 rounded-2xl border border-white/80 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Available players</div>
              <div className="text-xs font-semibold text-gray-500">Tap a player, then tap a slot. Drag and drop also works.</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {editorPlayers.map((player) => {
                const selected = selectedPlayerId === player.id;
                return (
                  <button
                    key={player.id}
                    type="button"
                    draggable
                    onDragStart={(dragEvent) => dragEvent.dataTransfer.setData('text/plain', JSON.stringify({ playerId: player.id }))}
                    onClick={() => setSelectedPlayerId(selected ? '' : player.id)}
                    className={`rounded-full border px-3 py-2 text-xs font-black ${selected ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-700'}`}
                  >
                    {player.number ? `#${player.number} ` : ''}{player.name}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] ${player.availability === 'going' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {player.availability === 'going' ? 'Going' : 'Roster'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-white/80 bg-white p-3">
            <table className="min-w-full border-separate border-spacing-2">
              <thead>
                <tr>
                  <th className="text-left text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">Position</th>
                  {lineupPeriods.map((period) => <th key={period} className="text-left text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">{period}</th>)}
                </tr>
              </thead>
              <tbody>
                {formation.positions.map((position) => (
                  <tr key={position.id}>
                    <td className="pr-2 text-sm font-black text-gray-900">{position.name}</td>
                    {lineupPeriods.map((period) => {
                      const slotKey = getLineupSlotKey(period, position.id);
                      const player = playerById.get(draftLineups[slotKey] || '');
                      return (
                        <td key={slotKey}>
                          <button
                            type="button"
                            aria-label={`${period} ${position.name}`}
                            data-testid={`lineup-slot-${slotKey}`}
                            className="min-h-20 w-full min-w-28 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-left shadow-sm"
                            onClick={() => applySelectedPlayerToSlot(slotKey)}
                            onDoubleClick={() => updateDraft(clearLineupPlayer(draftLineups, slotKey))}
                            onDragOver={(dragEvent) => dragEvent.preventDefault()}
                            onDrop={(dropEvent) => {
                              dropEvent.preventDefault();
                              try {
                                const payload = JSON.parse(dropEvent.dataTransfer.getData('text/plain') || '{}');
                                if (payload.sourceKey) {
                                  updateDraft(moveLineupPlayer(draftLineups, payload.sourceKey, slotKey));
                                } else if (payload.playerId) {
                                  updateDraft(assignLineupPlayer(draftLineups, slotKey, payload.playerId));
                                }
                              } catch {
                                // ignore invalid drops
                              }
                            }}
                          >
                            <div className="text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">{period}</div>
                            {player ? (
                              <div
                                draggable
                                onDragStart={(dragEvent) => dragEvent.dataTransfer.setData('text/plain', JSON.stringify({ playerId: player.id, sourceKey: slotKey }))}
                                className="mt-1 rounded-xl bg-white px-2 py-2"
                              >
                                <div className="text-sm font-black text-gray-950">{player.number ? `#${player.number} ` : ''}{player.name}</div>
                                <div className="mt-1 text-[11px] font-semibold text-gray-500">Double tap to clear</div>
                              </div>
                            ) : (
                              <div className="mt-2 text-sm font-semibold text-gray-400">Open</div>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!preview.goingPlayers.length ? <div className="mt-3 text-sm font-semibold text-amber-800">No Going players are available to auto-fill this lineup. Manual roster edits still work.</div> : null}
        </>
      ) : null}
      {status ? <div className={`mt-3 text-sm font-semibold ${status.tone === 'success' ? 'text-emerald-700' : 'text-amber-800'}`}>{status.message}</div> : null}
    </div>
  );
}

type ScoreSnapshot = {
  homeScore: number;
  awayScore: number;
};

function LiveGameClockPanel({ auth, event, onLiveClockUpdated }: { auth: AuthState; event: ParentScheduleEvent; onLiveClockUpdated: (payload: Partial<ParentScheduleEvent> & { period?: string | null }) => void }) {
  const clockNow = useLiveGameClockNow();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const periods = useMemo(() => buildLiveGameClockPeriods(event as Record<string, any>), [event]);
  const clockState = useMemo(() => resolveLiveGameClockSnapshot(event as Record<string, any>, clockNow), [event, clockNow]);
  const activePeriodIndex = Math.max(0, periods.indexOf(clockState.period));
  const activePeriod = periods[activePeriodIndex] || clockState.period;
  const hasNextPeriod = activePeriodIndex < periods.length - 1;
  const liveClockView = getLiveClockViewModel({
    type: event.type,
    liveStatus: event.liveStatus,
    liveClockMs: clockState.persistedClockMs,
    liveClockRunning: clockState.running,
    liveClockPeriod: activePeriod,
    liveClockUpdatedAt: clockState.updatedAt
  } as ParentScheduleEvent, clockNow);

  const persistClock = async (next: { running: boolean; period: string }) => {
    if (!auth.user) return;
    setSaving(true);
    setStatus(null);
    try {
      const payload = await updateLiveGameClockState(event.teamId, event.id, {
        liveClockMs: clockState.effectiveClockMs,
        liveClockRunning: next.running,
        liveClockPeriod: next.period,
        currentGame: event
      }, auth.user);
      onLiveClockUpdated(payload as Partial<ParentScheduleEvent> & { period?: string | null });
      setStatus({ tone: 'success', message: next.running ? 'Clock running.' : `Clock saved${next.period !== activePeriod ? ` for ${next.period}.` : '.'}` });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to update the live clock.' });
    } finally {
      setSaving(false);
    }
  };

  const toggleClock = async () => {
    await persistClock({ running: !clockState.running, period: activePeriod });
  };

  const advancePeriod = async () => {
    if (!hasNextPeriod) {
      setStatus({ tone: 'error', message: 'Already at the final configured period.' });
      return;
    }
    await persistClock({ running: clockState.running, period: periods[activePeriodIndex + 1] || activePeriod });
  };

  return (
    <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-3" data-testid="live-game-clock-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-[0.04em] text-rose-700">Live game clock</div>
          <div className="mt-1 text-sm font-semibold text-gray-950">Start, pause, and advance periods with the same persisted live clock fields the legacy tracker restores.</div>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-rose-700 shadow-sm">{liveClockView?.label || activePeriod}</span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <label className="text-xs font-black uppercase tracking-[0.04em] text-rose-700">
          Current period
          <div className="mt-1 min-h-11 rounded-xl border border-rose-200 bg-white px-3 py-3 text-sm font-semibold text-gray-900">{activePeriod}</div>
        </label>
        <button
          type="button"
          className="primary-button min-h-11 px-4 text-sm"
          onClick={() => void toggleClock()}
          disabled={saving}
        >
          {saving ? 'Saving clock' : clockState.running ? 'Pause clock' : 'Start clock'}
        </button>
        <button
          type="button"
          className="ghost-button min-h-11 px-4 text-sm"
          onClick={() => void advancePeriod()}
          disabled={saving || !hasNextPeriod}
        >
          Advance period
        </button>
      </div>

      <div className="mt-2 text-xs font-semibold text-gray-500">Clock state is anchored with a persisted timestamp so app backgrounding restores correctly.</div>
      {status ? <div className={`mt-2 text-xs font-bold ${status.tone === 'error' ? 'text-rose-700' : 'text-emerald-700'}`}>{status.message}</div> : null}
    </div>
  );
}

function getFoulWarningState(fouls: number) {
  if (fouls >= 5) {
    return {
      pillClass: 'border-rose-200 bg-rose-100 text-rose-800',
      label: 'FOULED OUT'
    };
  }
  if (fouls >= 4) {
    return {
      pillClass: 'border-amber-200 bg-amber-100 text-amber-800',
      label: 'Warning'
    };
  }
  return {
    pillClass: 'border-gray-200 bg-gray-100 text-gray-700',
    label: 'Eligible'
  };
}

function getBonusState(teamFouls: number) {
  if (teamFouls >= 10) {
    return {
      label: 'Double bonus',
      detail: `${teamFouls} team fouls this period`,
      className: 'border-rose-200 bg-rose-50 text-rose-700'
    };
  }
  if (teamFouls >= 7) {
    return {
      label: 'Bonus',
      detail: `${teamFouls} team fouls this period`,
      className: 'border-amber-200 bg-amber-50 text-amber-700'
    };
  }
  return {
    label: 'No bonus',
    detail: `${teamFouls} team fouls this period`,
    className: 'border-gray-200 bg-gray-50 text-gray-600'
  };
}

function LiveScoreEditor({ auth, event, onScoreUpdated }: { auth: AuthState; event: ParentScheduleEvent; onScoreUpdated: (homeScore: number, awayScore: number) => void }) {
  const savedHomeScore = Math.max(0, Number(event.homeScore ?? 0));
  const savedAwayScore = Math.max(0, Number(event.awayScore ?? 0));
  const [homeScore, setHomeScore] = useState(savedHomeScore);
  const [awayScore, setAwayScore] = useState(savedAwayScore);
  const [previousScoreSnapshots, setPreviousScoreSnapshots] = useState<ScoreSnapshot[]>([]);
  const [homePlayers, setHomePlayers] = useState<ScheduleHomeScoringPlayer[]>([]);
  const [loadingHomePlayers, setLoadingHomePlayers] = useState(false);
  const [playerScoringId, setPlayerScoringId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const lastSavedScoreRef = useRef({ eventKey: event.eventKey, homeScore: savedHomeScore, awayScore: savedAwayScore });
  const pendingLocalSaveRef = useRef<ScoreSnapshot | null>(null);

  useEffect(() => {
    const pendingLocalSave = pendingLocalSaveRef.current;
    const isLocalSaveEcho = Boolean(
      pendingLocalSave
        && lastSavedScoreRef.current.eventKey === event.eventKey
        && pendingLocalSave.homeScore === savedHomeScore
        && pendingLocalSave.awayScore === savedAwayScore
    );

    if (!isLocalSaveEcho) {
      setHomeScore(savedHomeScore);
      setAwayScore(savedAwayScore);
      setPreviousScoreSnapshots([]);
    }

    pendingLocalSaveRef.current = null;
    lastSavedScoreRef.current = { eventKey: event.eventKey, homeScore: savedHomeScore, awayScore: savedAwayScore };
  }, [event.eventKey, savedHomeScore, savedAwayScore]);

  useEffect(() => {
    let cancelled = false;
    async function loadPlayers() {
      setLoadingHomePlayers(true);
      try {
        const players = await loadHomeScoringPlayers(event.teamId, event.id);
        if (!cancelled) setHomePlayers(Array.isArray(players) ? players : []);
      } catch (error) {
        console.warn('[schedule-event-detail] Unable to load home scoring players:', error);
        if (!cancelled) setHomePlayers([]);
      } finally {
        if (!cancelled) setLoadingHomePlayers(false);
      }
    }
    loadPlayers();
    return () => {
      cancelled = true;
    };
  }, [event.teamId, event.id, event.eventKey]);

  const dirty = homeScore !== savedHomeScore || awayScore !== savedAwayScore;
  const adjust = (side: 'home' | 'away', delta: number) => {
    const nextHomeScore = side === 'home' ? Math.max(0, homeScore + delta) : homeScore;
    const nextAwayScore = side === 'away' ? Math.max(0, awayScore + delta) : awayScore;
    if (nextHomeScore === homeScore && nextAwayScore === awayScore) return;
    setPreviousScoreSnapshots((snapshots) => [...snapshots, { homeScore, awayScore }]);
    setHomeScore(nextHomeScore);
    setAwayScore(nextAwayScore);
    setStatus(null);
  };

  const undoLastScoreChange = () => {
    setPreviousScoreSnapshots((snapshots) => {
      const latestSnapshot = snapshots[snapshots.length - 1];
      if (!latestSnapshot) return snapshots;
      setHomeScore(latestSnapshot.homeScore);
      setAwayScore(latestSnapshot.awayScore);
      setStatus(null);
      return snapshots.slice(0, -1);
    });
  };

  const saveScore = async () => {
    if (!auth.user) return;
    const previousScore = { homeScore: savedHomeScore, awayScore: savedAwayScore };
    setSaving(true);
    setStatus(null);
    try {
      const payload = await updateGameScore(event.teamId, event.id, { homeScore, awayScore }, auth.user);
      const nextHomeScore = Number(payload.homeScore ?? homeScore);
      const nextAwayScore = Number(payload.awayScore ?? awayScore);
      pendingLocalSaveRef.current = { homeScore: nextHomeScore, awayScore: nextAwayScore };
      onScoreUpdated(nextHomeScore, nextAwayScore);
      if (nextHomeScore === previousScore.homeScore && nextAwayScore === previousScore.awayScore) {
        setStatus({ tone: 'success', message: 'Score saved.' });
        return;
      }
      try {
        await publishLiveScoreUpdateEvent(event.teamId, event.id, { homeScore: nextHomeScore, awayScore: nextAwayScore }, auth.user, previousScore);
        setStatus({ tone: 'success', message: 'Score saved and posted to live play-by-play.' });
      } catch (publishError) {
        console.warn('[schedule-event-detail] Score saved but live play-by-play posting failed:', publishError);
        setStatus({ tone: 'success', message: 'Score saved. Live play-by-play post failed.' });
      }
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to save score.' });
    } finally {
      setSaving(false);
    }
  };

  const recordPlayerTwo = async (player: ScheduleHomeScoringPlayer) => {
    if (!auth.user || saving || playerScoringId || dirty) return;
    setPlayerScoringId(player.id);
    setStatus(null);
    try {
      const result = await recordPlayerScoringStat(event.teamId, event.id, player.id, {
        statKey: 'pts',
        value: 2,
        playerName: player.name,
        playerNumber: player.number,
        teamSide: event.isHome === false ? 'away' : 'home'
      }, auth.user);
      setHomeScore(result.homeScore);
      setAwayScore(result.awayScore);
      pendingLocalSaveRef.current = { homeScore: result.homeScore, awayScore: result.awayScore };
      onScoreUpdated(result.homeScore, result.awayScore);
      setHomePlayers((players) => players.map((candidate) => (
        candidate.id === player.id ? { ...candidate, points: result.playerPoints } : candidate
      )));
      setPreviousScoreSnapshots([]);
      setStatus({ tone: 'success', message: `${player.name} +2 recorded and posted to live play-by-play.` });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to record player scoring.' });
    } finally {
      setPlayerScoringId(null);
    }
  };

  return (
    <div data-testid="live-score-editor" className={`mt-3 rounded-2xl border p-3 ${dirty ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-gray-50'}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Live score</div>
          <div className="mt-0.5 text-xs font-semibold text-gray-600">{dirty ? 'Unsaved score changes' : 'Saved score controls'}</div>
        </div>
        <div className="rounded-full bg-white px-3 py-1 text-xl font-black tabular-nums text-gray-950 shadow-sm">{homeScore}-{awayScore}</div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <ScoreStepper label="Home" value={homeScore} onDecrease={() => adjust('home', -1)} onIncrease={() => adjust('home', 1)} disabled={saving || Boolean(playerScoringId)} />
        <ScoreStepper label="Away" value={awayScore} onDecrease={() => adjust('away', -1)} onIncrease={() => adjust('away', 1)} disabled={saving || Boolean(playerScoringId)} />
      </div>
      <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Team player +2</div>
            <div className="mt-0.5 text-xs font-semibold text-gray-500">Record a player-attributed made two.</div>
          </div>
          {loadingHomePlayers ? <span className="text-xs font-bold text-gray-500">Loading roster</span> : null}
        </div>
        {homePlayers.length ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {homePlayers.map((player) => {
              const label = `${player.number ? `#${player.number} ` : ''}${player.name}`;
              const busy = playerScoringId === player.id;
              return (
                <button
                  key={player.id}
                  type="button"
                  className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 text-left text-sm font-black text-gray-900 disabled:opacity-50"
                  onClick={() => recordPlayerTwo(player)}
                  disabled={saving || Boolean(playerScoringId) || dirty}
                  aria-label={`${label} plus 2 points`}
                >
                  <span className="min-w-0 truncate">{label}</span>
                  <span className="flex-none rounded-full bg-primary-50 px-2 py-1 text-xs text-primary-700">{busy ? 'Saving' : `+2 · ${player.points} pts`}</span>
                </button>
              );
            })}
          </div>
        ) : !loadingHomePlayers ? <div className="mt-2 text-xs font-semibold text-gray-500">No active team roster players found.</div> : null}
        {dirty ? <div className="mt-2 text-xs font-semibold text-amber-700">Save or undo manual score changes before recording player stats.</div> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="primary-button min-h-11 px-4 text-sm"
            onClick={saveScore}
            disabled={saving || Boolean(playerScoringId) || !dirty}
          >
            {saving ? 'Saving score' : 'Save score'}
          </button>
          {previousScoreSnapshots.length ? (
            <button
              type="button"
              className="ghost-button min-h-11 px-4 text-sm"
              onClick={undoLastScoreChange}
              disabled={saving || Boolean(playerScoringId) || !previousScoreSnapshots.length}
              aria-label="Undo last score change"
            >
              Undo last score change
            </button>
          ) : null}
        </div>
        {status ? <span className={`text-xs font-bold ${status.tone === 'error' ? 'text-rose-700' : 'text-emerald-700'}`}>{status.message}</span> : null}
      </div>
    </div>
  );
}

function GameDayFoulTrackerPanel({ auth, event }: { auth: AuthState; event: ParentScheduleEvent }) {
  const [homePlayers, setHomePlayers] = useState<ScheduleHomeScoringPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingPlayerId, setSavingPlayerId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [liveEvents, setLiveEvents] = useState<any[]>(() => Array.isArray(event.liveEvents) ? event.liveEvents : []);
  const [recordedFouls, setRecordedFouls] = useState<PlayerGameStatResult[]>([]);

  useEffect(() => {
    setLiveEvents(Array.isArray(event.liveEvents) ? event.liveEvents : []);
    setRecordedFouls([]);
    setStatus(null);
  }, [event.eventKey, event.liveEvents]);

  useEffect(() => {
    let cancelled = false;
    async function loadPlayers() {
      setLoading(true);
      try {
        const [players, loadedLiveEvents] = await Promise.all([
          loadHomeScoringPlayers(event.teamId, event.id),
          loadGameDayLiveEventsForApp(event.teamId, event.id)
        ]);
        if (cancelled) return;
        setHomePlayers(Array.isArray(players) ? players : []);
        setLiveEvents(Array.isArray(loadedLiveEvents) ? loadedLiveEvents : []);
      } catch (error) {
        if (!cancelled) {
          console.warn('[schedule-event-detail] Unable to load foul tracker state:', error);
          setHomePlayers([]);
          setLiveEvents([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadPlayers();
    return () => {
      cancelled = true;
    };
  }, [event.teamId, event.id, event.eventKey]);

  const activePeriod = useMemo(() => resolveLiveGameClockSnapshot(event as Record<string, any>).period || event.liveClockPeriod || (event as Record<string, any>).period || 'Q1', [event]);
  const homeTeamFouls = useMemo(() => Math.max(0,
    (Array.isArray(liveEvents) ? liveEvents : []).reduce((total, entry) => {
      if (entry?.type !== 'stat' || entry?.isOpponent === true) return total;
      if (String(entry?.statKey || '').toLowerCase() !== 'fouls') return total;
      if (String(entry?.period || '') !== String(activePeriod || '')) return total;
      return total + (Number(entry?.value || 0) || 0);
    }, 0)
  ), [activePeriod, liveEvents]);
  const bonusState = getBonusState(homeTeamFouls);

  const recordFoul = async (player: ScheduleHomeScoringPlayer) => {
    if (!auth.user || savingPlayerId) return;
    setSavingPlayerId(player.id);
    setStatus(null);
    try {
      const result = await recordPlayerGameStat(event.teamId, event.id, player.id, {
        statKey: 'fouls',
        value: 1,
        teamSide: event.isHome === false ? 'away' : 'home',
        playerName: player.name,
        playerNumber: player.number
      }, auth.user);
      setHomePlayers((players) => players.map((candidate) => (
        candidate.id === player.id ? { ...candidate, fouls: result.playerStatTotal } : candidate
      )));
      setLiveEvents((entries) => [...entries, result.liveEvent]);
      setRecordedFouls((entries) => [...entries, result]);
      setStatus({ tone: 'success', message: result.playerStatTotal >= 5 ? `${player.name} reached 5 fouls. Use the substitution panel if they must come off.` : `${player.name} foul recorded.` });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to record the foul.' });
    } finally {
      setSavingPlayerId(null);
    }
  };

  const undoLastFoul = async () => {
    const latest = recordedFouls[recordedFouls.length - 1];
    if (!auth.user || !latest || savingPlayerId) return;
    setSavingPlayerId(latest.playerId);
    setStatus(null);
    try {
      const result = await undoRecordedPlayerGameStat(event.teamId, event.id, {
        trackerEventId: latest.trackerEventId,
        liveEventId: latest.liveEventId,
        playerId: latest.playerId,
        playerName: latest.playerName,
        playerNumber: latest.playerNumber,
        statKey: 'fouls',
        value: 1,
        teamSide: event.isHome === false ? 'away' : 'home'
      }, auth.user);
      setHomePlayers((players) => players.map((candidate) => (
        candidate.id === latest.playerId ? { ...candidate, fouls: result.playerStatTotal } : candidate
      )));
      setLiveEvents((entries) => result.liveEvent ? [...entries, result.liveEvent] : entries);
      setRecordedFouls((entries) => entries.slice(0, -1));
      setStatus({ tone: 'success', message: 'Last foul undone.' });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to undo the foul.' });
    } finally {
      setSavingPlayerId(null);
    }
  };

  return (
    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-3" data-testid="game-day-foul-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-[0.04em] text-amber-700">Basketball fouls</div>
          <div className="mt-1 text-sm font-semibold text-gray-950">Track personal fouls, team fouls, and the current-period bonus state from the app game hub.</div>
        </div>
        <div className={`rounded-full border px-3 py-1 text-xs font-black ${bonusState.className}`} aria-label="Team foul bonus state">
          {activePeriod} · {bonusState.label}
        </div>
      </div>
      <div className="mt-2 text-xs font-semibold text-gray-600">{bonusState.detail}</div>
      {homePlayers.length ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {homePlayers.map((player) => {
            const foulState = getFoulWarningState(player.fouls || 0);
            const label = `${player.number ? `#${player.number} ` : ''}${player.name}`;
            const busy = savingPlayerId === player.id;
            return (
              <div key={player.id} className="rounded-xl border border-amber-100 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-gray-950">{label}</div>
                    <div className="mt-1 text-xs font-semibold text-gray-500">{player.points} pts · {player.fouls} fouls</div>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[11px] font-black ${foulState.pillClass}`}>{foulState.label}</span>
                </div>
                <button
                  type="button"
                  className="primary-button mt-3 min-h-11 w-full px-4 text-sm disabled:opacity-60"
                  onClick={() => recordFoul(player)}
                  disabled={busy || Boolean(savingPlayerId)}
                  aria-label={`${label} add foul`}
                >
                  {busy ? 'Saving foul' : '+ Foul'}
                </button>
              </div>
            );
          })}
        </div>
      ) : !loading ? <div className="mt-3 text-xs font-semibold text-gray-500">No active team roster players found.</div> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-gray-500">Team fouls reset when the live clock advances to a new period.</div>
        <button
          type="button"
          className="ghost-button min-h-11 px-4 text-sm"
          onClick={undoLastFoul}
          disabled={Boolean(savingPlayerId) || !recordedFouls.length}
        >
          Undo last foul
        </button>
      </div>
      {status ? <div className="mt-3"><Status tone={status.tone} message={status.message} /></div> : null}
    </div>
  );
}

function PracticeTimelineSection({ auth, event }: { auth: AuthState; event: ParentScheduleEvent }) {
  const [sessionId, setSessionId] = useState<string | null>(event.practiceSessionId || null);
  const [blocks, setBlocks] = useState<PracticeTimelineBlock[]>([]);
  const [drillOptions, setDrillOptions] = useState<PracticeTimelineDrillOption[]>([]);
  const [selectedDrillId, setSelectedDrillId] = useState('');
  const [activeDrillIndex, setActiveDrillIndex] = useState(0);
  const [liveNote, setLiveNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const canManageTimeline = Boolean(auth.user && event.isDbGame && event.isTeamAdmin && !event.isCancelled);
  const totalMinutes = getPracticeTimelineTotalMinutes(blocks);
  const activeBlock = blocks[activeDrillIndex] || null;

  const refreshTimeline = useCallback(async () => {
    if (!auth.user || !event.isTeamAdmin) {
      setBlocks([]);
      setDrillOptions([]);
      setSessionId(event.practiceSessionId || null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      const model = await loadPracticeTimelineModel(event.teamId, event.id, auth.user);
      setSessionId(model.sessionId);
      setBlocks(model.blocks);
      setDrillOptions(model.drillOptions);
      setSelectedDrillId((current) => current || model.drillOptions[0]?.id || '');
      setActiveDrillIndex((current) => Math.min(current, Math.max(0, model.blocks.length - 1)));
    } catch (error: any) {
      setBlocks([]);
      setDrillOptions([]);
      setStatus({ tone: 'error', message: error?.message || 'Unable to load the practice timeline.' });
    } finally {
      setLoading(false);
    }
  }, [auth.user, event.id, event.isTeamAdmin, event.practiceSessionId, event.teamId]);

  useEffect(() => {
    setActiveDrillIndex(0);
    setLiveNote('');
    void refreshTimeline();
  }, [refreshTimeline]);

  const persistTimeline = async (nextBlocks: PracticeTimelineBlock[], successMessage: string) => {
    if (!auth.user) return;
    setSaving(true);
    setStatus(null);
    try {
      const nextSessionId = await savePracticeTimelineForApp({
        teamId: event.teamId,
        eventId: event.id,
        user: auth.user,
        sessionId,
        blocks: nextBlocks,
        date: event.date,
        location: event.location,
        title: event.title || 'Practice'
      });
      setSessionId(nextSessionId);
      setBlocks(nextBlocks.map((block, index) => ({ ...block, order: index })));
      setStatus({ tone: 'success', message: successMessage });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to save the practice timeline.' });
    } finally {
      setSaving(false);
    }
  };

  const addDrill = async () => {
    const option = drillOptions.find((candidate) => candidate.id === selectedDrillId) || drillOptions[0];
    if (!option) return;
    const nextBlocks = [...blocks, createPracticeTimelineBlockFromOption(option, blocks.length)];
    setActiveDrillIndex(nextBlocks.length - 1);
    await persistTimeline(nextBlocks, `${option.title} added to the practice timeline.`);
  };

  const updateBlock = (index: number, updater: (block: PracticeTimelineBlock) => PracticeTimelineBlock) => {
    setBlocks((current) => current.map((block, currentIndex) => (
      currentIndex === index ? { ...updater(block), order: currentIndex } : block
    )));
  };

  const commitBlock = async (index: number, updater: (block: PracticeTimelineBlock) => PracticeTimelineBlock, successMessage: string) => {
    const nextBlocks = blocks.map((block, currentIndex) => (
      currentIndex === index ? { ...updater(block), order: currentIndex } : block
    ));
    setBlocks(nextBlocks);
    await persistTimeline(nextBlocks, successMessage);
  };

  const moveBlock = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= blocks.length) return;
    const nextBlocks = blocks.slice();
    const [moved] = nextBlocks.splice(index, 1);
    nextBlocks.splice(targetIndex, 0, moved);
    setActiveDrillIndex(targetIndex);
    await persistTimeline(nextBlocks, 'Practice order updated.');
  };

  const removeBlock = async (index: number) => {
    const nextBlocks = blocks.filter((_, currentIndex) => currentIndex !== index);
    setActiveDrillIndex((current) => Math.min(current, Math.max(0, nextBlocks.length - 1)));
    await persistTimeline(nextBlocks, 'Practice drill removed.');
  };

  const saveLiveNote = async () => {
    if (!auth.user || !activeBlock || !liveNote.trim()) return;
    setSaving(true);
    setStatus(null);
    try {
      const result = await appendPracticeTimelineLiveNoteForApp({
        teamId: event.teamId,
        eventId: event.id,
        user: auth.user,
        sessionId,
        blocks,
        blockIndex: activeDrillIndex,
        text: liveNote,
        type: 'text',
        date: event.date,
        location: event.location,
        title: event.title || 'Practice'
      });
      setSessionId(result.sessionId);
      setBlocks(result.blocks);
      setLiveNote('');
      setStatus({ tone: 'success', message: 'Live practice note saved.' });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to save the live practice note.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="app-card overflow-hidden p-0 scroll-mt-28" data-testid="practice-timeline-panel">
      <div className="border-b border-violet-100 bg-violet-50 px-3 py-3 sm:px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-black text-violet-800">Practice timeline</div>
            <h3 className="mt-1 text-base font-black text-gray-950">Plan it on your phone, run it at the field.</h3>
            <div className="mt-0.5 text-xs font-semibold text-gray-600">
              {blocks.length ? `${blocks.length} drill${blocks.length === 1 ? '' : 's'} · ${totalMinutes} min planned` : 'Add drills, set durations, and save live notes during practice.'}
            </div>
          </div>
          {loading ? <RefreshCw className="mt-1 h-4 w-4 flex-none animate-spin text-violet-600" aria-hidden="true" /> : null}
        </div>
      </div>

      <div className="space-y-3 p-3 sm:p-4">
        {status ? <Status tone={status.tone} message={status.message} /> : null}
        {canManageTimeline ? (
          <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 text-xs font-black uppercase tracking-[0.04em] text-violet-700">
                Add drill
                <select
                  className="mt-1 min-h-11 w-full rounded-xl border border-violet-200 bg-white px-3 text-sm font-semibold text-gray-900"
                  value={selectedDrillId}
                  onChange={(changeEvent) => setSelectedDrillId(changeEvent.target.value)}
                  disabled={saving || loading || !drillOptions.length}
                >
                  {drillOptions.length ? drillOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.title} · {option.duration} min</option>
                  )) : <option value="">No drills available</option>}
                </select>
              </label>
              <button
                type="button"
                className="primary-button min-h-11 px-4 text-sm disabled:opacity-60"
                onClick={addDrill}
                disabled={saving || loading || !drillOptions.length}
              >
                {saving ? 'Saving drill' : 'Add drill'}
              </button>
            </div>
          </div>
        ) : null}

        {blocks.length ? (
          <div className="space-y-2">
            {blocks.map((block, index) => {
              const isActive = index === activeDrillIndex;
              return (
                <article key={`${block.drillId || block.drillTitle}-${index}`} className={`rounded-2xl border p-3 ${isActive ? 'border-violet-300 bg-violet-50' : 'border-gray-200 bg-white'}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setActiveDrillIndex(index)}
                    >
                      <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Drill {index + 1} · {block.type}</div>
                      <div className="mt-1 text-sm font-black text-gray-950">{block.drillTitle}</div>
                      {block.description ? <div className="mt-1 text-xs font-semibold leading-5 text-gray-600">{block.description}</div> : null}
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">
                        Minutes
                        <input
                          type="number"
                          min={1}
                          className="ml-2 min-h-9 w-20 rounded-full border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900"
                          value={block.duration}
                          onChange={(changeEvent) => updateBlock(index, (current) => ({ ...current, duration: Math.max(1, Number.parseInt(changeEvent.target.value, 10) || 1) }))}
                          onBlur={(blurEvent) => { void commitBlock(index, (current) => ({ ...current, duration: Math.max(1, Number.parseInt(blurEvent.target.value, 10) || 1) }), 'Practice duration updated.'); }}
                          disabled={!canManageTimeline || saving}
                          aria-label={`Minutes for ${block.drillTitle}`}
                        />
                      </label>
                      {canManageTimeline ? (
                        <>
                          <button type="button" className="ghost-button min-h-9 px-3 text-xs" onClick={() => { void moveBlock(index, -1); }} disabled={saving || index === 0}>Up</button>
                          <button type="button" className="ghost-button min-h-9 px-3 text-xs" onClick={() => { void moveBlock(index, 1); }} disabled={saving || index === blocks.length - 1}>Down</button>
                          <button type="button" className="ghost-button min-h-9 px-3 text-xs text-rose-700" onClick={() => { void removeBlock(index); }} disabled={saving}>Remove</button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <label className="mt-3 block text-xs font-black uppercase tracking-[0.04em] text-gray-500">
                    Coach notes
                    <textarea
                      className="mt-1 min-h-[88px] w-full rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900"
                      value={block.notes}
                      onChange={(changeEvent) => updateBlock(index, (current) => ({ ...current, notes: changeEvent.target.value }))}
                      onBlur={(blurEvent) => { if (canManageTimeline) void commitBlock(index, (current) => ({ ...current, notes: blurEvent.target.value }), 'Practice notes updated.'); }}
                      disabled={!canManageTimeline || saving}
                    />
                  </label>
                  {block.notesLog.length ? (
                    <div className="mt-3 rounded-xl border border-violet-100 bg-white p-3">
                      <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-violet-700">Live notes</div>
                      <div className="mt-2 space-y-2">
                        {block.notesLog.map((note, noteIndex) => (
                          <div key={`${note.createdAt}-${noteIndex}`} className="text-xs font-semibold text-gray-700">
                            <span className="font-black text-gray-900">{note.type === 'voice' ? 'Voice' : 'Note'}:</span> {note.text}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : !loading ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">
            No practice timeline yet. Add drills above to build this practice plan.
          </div>
        ) : null}

        {activeBlock ? (
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.04em] text-emerald-700">Run mode</div>
                <div className="mt-1 text-sm font-black text-gray-950">{activeBlock.drillTitle}</div>
                <div className="mt-1 text-xs font-semibold text-gray-600">Drill {activeDrillIndex + 1} of {blocks.length} · {activeBlock.duration} min</div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="ghost-button min-h-11 px-4 text-sm" onClick={() => setActiveDrillIndex((current) => Math.max(0, current - 1))} disabled={activeDrillIndex === 0}>Previous</button>
                <button type="button" className="primary-button min-h-11 px-4 text-sm" onClick={() => setActiveDrillIndex((current) => Math.min(blocks.length - 1, current + 1))} disabled={activeDrillIndex >= blocks.length - 1}>Next drill</button>
              </div>
            </div>
            <label className="mt-3 block text-xs font-black uppercase tracking-[0.04em] text-gray-500">
              Live note
              <textarea
                className="mt-1 min-h-[88px] w-full rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-gray-900"
                value={liveNote}
                onChange={(changeEvent) => setLiveNote(changeEvent.target.value)}
                placeholder="Capture what changed at the field."
                disabled={!canManageTimeline || saving}
              />
            </label>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-gray-500">Saved to the same practice session the web command center reads.</div>
              <button type="button" className="primary-button min-h-11 px-4 text-sm" onClick={saveLiveNote} disabled={!canManageTimeline || saving || !liveNote.trim()}>
                {saving ? 'Saving note' : 'Save live note'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StaffPracticePacketEditor({ auth, event, childEvents }: { auth: AuthState; event: ParentScheduleEvent; childEvents: ParentScheduleEvent[] }) {
  const [packet, setPacket] = useState<StaffPracticePacket | null>(null);
  const [packetTitle, setPacketTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [blocks, setBlocks] = useState<StaffPracticePacketBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!auth.user) return;
    let cancelled = false;
    setLoading(true);
    setStatus(null);
    loadStaffPracticePacket(event, childEvents, auth.user)
      .then((loaded) => {
        if (cancelled) return;
        setPacket(loaded);
        setPacketTitle(loaded.packetTitle || `${event.title || 'Practice'} home packet`);
        setDueDate(toDateInputValue(loaded.dueDate));
        setBlocks(getPracticePacketBlocks(loaded).map((block, index) => ({
          drillId: block.drillId || null,
          drillTitle: block.drillTitle || block.title || `Home Drill ${index + 1}`,
          type: block.type || 'Technical',
          duration: Number.parseInt(String(block.duration || 10), 10) || 10,
          description: block.description || '',
          notes: block.notes || ''
        })));
      })
      .catch((error: any) => {
        if (!cancelled) setStatus({ tone: 'error', message: error?.message || 'Unable to load practice packet.' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.user, childEvents, event.eventKey]);

  const updateBlock = (index: number, patch: Partial<StaffPracticePacketBlock>) => {
    setBlocks((current) => current.map((block, blockIndex) => blockIndex === index ? { ...block, ...patch } : block));
  };

  const addBlock = () => {
    setBlocks((current) => ([
      ...current,
      { drillTitle: `Home Drill ${current.length + 1}`, type: 'Technical', duration: 10, description: '', notes: '' }
    ]));
  };

  const removeBlock = (index: number) => {
    setBlocks((current) => current.filter((_block, blockIndex) => blockIndex !== index));
  };

  const savePacket = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (!auth.user) return;
    setSaving(true);
    setStatus(null);
    try {
      const saved = await saveStaffPracticePacket(event, auth.user, { packetTitle, dueDate: dueDate || null, blocks }, childEvents);
      setPacket(saved);
      setPacketTitle(saved.packetTitle);
      setDueDate(toDateInputValue(saved.dueDate));
      setBlocks(getPracticePacketBlocks(saved).map((block, index) => ({
        drillId: block.drillId || null,
        drillTitle: block.drillTitle || block.title || `Home Drill ${index + 1}`,
        type: block.type || 'Technical',
        duration: Number.parseInt(String(block.duration || 10), 10) || 10,
        description: block.description || '',
        notes: block.notes || ''
      })));
      setStatus({ tone: 'success', message: 'Practice packet saved.' });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to save practice packet.' });
    } finally {
      setSaving(false);
    }
  };

  const completedChildIds = getCompletedPacketChildIds(packet?.completions || []);
  const childCount = packet?.children.length || childEvents.length || 0;
  const totalMinutes = blocks.reduce((sum, block) => sum + (Number.parseInt(String(block.duration || 0), 10) || 0), 0);

  return (
    <section className="app-card p-3 sm:p-4" aria-label="Manage practice packet">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.04em] text-blue-700">Home packet</div>
          <h2 className="mt-1 text-base font-black text-gray-950">Assign practice packet</h2>
          <p className="mt-1 text-sm font-semibold text-gray-500">{completedChildIds.size}/{Math.max(childCount, completedChildIds.size)} completions · {totalMinutes} min</p>
        </div>
        <button type="button" className="secondary-button" onClick={addBlock}>Add packet drill</button>
      </div>
      <form className="mt-3 space-y-3" onSubmit={savePacket}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Packet title<input className="auth-input mt-1" value={packetTitle} onChange={(e) => setPacketTitle(e.target.value)} /></label>
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Due date<input type="date" className="auth-input mt-1" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        </div>
        <div className="space-y-2">
          {blocks.length ? blocks.map((block, index) => (
            <div key={`staff-packet-block-${index}`} className="rounded-2xl border border-blue-100 bg-blue-50/70 p-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                <label className="text-xs font-bold uppercase tracking-wide text-blue-700">Drill<input className="auth-input mt-1" value={block.drillTitle} onChange={(e) => updateBlock(index, { drillTitle: e.target.value })} /></label>
                <label className="text-xs font-bold uppercase tracking-wide text-blue-700">Minutes<input type="number" min="1" className="auth-input mt-1" value={block.duration} onChange={(e) => updateBlock(index, { duration: Number.parseInt(e.target.value, 10) || 1 })} /></label>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold uppercase tracking-wide text-blue-700">Type<input className="auth-input mt-1" value={block.type || ''} onChange={(e) => updateBlock(index, { type: e.target.value })} /></label>
                <label className="text-xs font-bold uppercase tracking-wide text-blue-700">Notes<input className="auth-input mt-1" value={block.notes || ''} onChange={(e) => updateBlock(index, { notes: e.target.value })} /></label>
              </div>
              <label className="mt-2 block text-xs font-bold uppercase tracking-wide text-blue-700">Description<textarea className="auth-input mt-1 min-h-16" value={block.description || ''} onChange={(e) => updateBlock(index, { description: e.target.value })} /></label>
              <button type="button" className="secondary-button mt-2" onClick={() => removeBlock(index)}>Remove drill</button>
            </div>
          )) : (
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">No home drills yet.</div>
          )}
        </div>
        <button type="submit" className="primary-button" disabled={saving || loading}>{saving ? 'Saving packet' : 'Save packet'}</button>
      </form>
      {status ? <div className="mt-3"><Status tone={status.tone} message={status.message} /></div> : null}
    </section>
  );
}

function PracticePacketSection({ auth, event, childEvents }: { auth: AuthState; event: ParentScheduleEvent; childEvents: ParentScheduleEvent[] }) {
  const [packet, setPacket] = useState<ParentPracticePacket | null>(null);
  const [attendance, setAttendance] = useState<StaffPracticeAttendance | null>(null);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [attendanceStatus, setAttendanceStatus] = useState<string | null>(null);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [savingAttendancePlayerId, setSavingAttendancePlayerId] = useState<string | null>(null);
  const [loadingPacket, setLoadingPacket] = useState(true);
  const [packetStatus, setPacketStatus] = useState<string | null>(null);
  const [packetError, setPacketError] = useState<string | null>(null);
  const [busyChildId, setBusyChildId] = useState<string | null>(null);
  const canManageAttendance = Boolean(auth.user && event.isTeamAdmin && event.type === 'practice' && event.isDbGame);

  const refreshPacket = useCallback(async (showLoading = true) => {
    if (showLoading) setLoadingPacket(true);
    setPacketError(null);
    try {
      const loaded = await loadParentPracticePacket(event, childEvents);
      setPacket(loaded);
    } catch (error: any) {
      setPacketError(error?.message || 'Unable to load the practice packet.');
      setPacket(null);
    } finally {
      if (showLoading) setLoadingPacket(false);
    }
  }, [childEvents, event.id, event.practiceHomePacketSummary, event.practiceSessionId, event.teamId]);

  useEffect(() => {
    setPacketStatus(null);
    refreshPacket();
  }, [refreshPacket]);

  const refreshAttendance = useCallback(async (showLoading = true) => {
    if (!canManageAttendance || !auth.user) {
      setAttendance(null);
      setAttendanceError(null);
      setLoadingAttendance(false);
      return;
    }
    if (showLoading) setLoadingAttendance(true);
    setAttendanceError(null);
    try {
      setAttendance(await loadStaffPracticeAttendance(event, auth.user));
    } catch (error: any) {
      setAttendance(null);
      setAttendanceError(error?.message || 'Unable to load practice attendance.');
    } finally {
      if (showLoading) setLoadingAttendance(false);
    }
  }, [auth.user, canManageAttendance, event]);

  useEffect(() => {
    setAttendanceStatus(null);
    void refreshAttendance();
  }, [refreshAttendance]);

  const selectedChild = packet?.children.find((child) => child.id === event.childId) || packet?.children[0] || null;
  const completionChildIds = getCompletedPacketChildIds(packet?.completions || []);
  const selectedComplete = Boolean(selectedChild?.id && completionChildIds.has(selectedChild.id));
  const totalMinutes = packet ? getPracticePacketTotalMinutes(packet) : 0;
  const blocks = getPracticePacketBlocks(packet);

  const markComplete = async () => {
    if (!auth.user || !packet || !selectedChild) return;
    setBusyChildId(selectedChild.id);
    setPacketStatus(null);
    setPacketError(null);
    try {
      const completion = await markParentPracticePacketComplete(packet, auth.user, selectedChild);
      setPacket((current) => current ? {
        ...current,
        completions: upsertPacketCompletion(current.completions, completion)
      } : current);
      setPacketStatus(`${selectedChild.name} marked complete.`);
    } catch (error: any) {
      setPacketError(error?.message || 'Unable to mark the packet complete.');
    } finally {
      setBusyChildId(null);
    }
  };

  const updateAttendanceStatus = async (player: PracticeAttendancePlayer, status: 'present' | 'late' | 'absent') => {
    if (!auth.user || !attendance) return;
    const nextPlayers = attendance.players.map((candidate) => (
      candidate.playerId === player.playerId
        ? {
          ...candidate,
          status,
          checkedInAt: status === 'present' || status === 'late' ? (candidate.checkedInAt || new Date()) : null
        }
        : candidate
    ));
    const nextAttendance = {
      ...attendance,
      checkedInCount: nextPlayers.filter((candidate) => candidate.status === 'present' || candidate.status === 'late').length,
      players: nextPlayers
    };
    setSavingAttendance(true);
    setSavingAttendancePlayerId(player.playerId);
    setAttendanceStatus(null);
    setAttendanceError(null);
    setAttendance(nextAttendance);
    try {
      const saved = await saveStaffPracticeAttendance(event, auth.user, nextAttendance);
      setAttendance(saved);
      setAttendanceStatus(`${player.displayName} marked ${status}.`);
    } catch (error: any) {
      setAttendance(attendance);
      setAttendanceError(error?.message || 'Unable to save practice attendance.');
    } finally {
      setSavingAttendance(false);
      setSavingAttendancePlayerId(null);
    }
  };

  return (
    <section id="practice-packet-panel" className="app-card overflow-hidden p-0 scroll-mt-28">
      <div className={`border-b px-3 py-3 sm:px-4 ${packet ? selectedComplete ? 'border-emerald-100 bg-emerald-50' : 'border-blue-100 bg-blue-50' : 'border-gray-100 bg-white'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={`flex items-center gap-2 text-sm font-black ${packet ? selectedComplete ? 'text-emerald-800' : 'text-blue-800' : 'text-gray-700'}`}>
              <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
              Practice packet
            </div>
            <h3 className="mt-1 text-base font-black text-gray-950">
              {packet ? selectedComplete ? 'Packet completed' : 'Packet ready' : 'No packet posted yet'}
            </h3>
            <div className="mt-0.5 text-xs font-semibold text-gray-600">
              {packet ? `${blocks.length} drill${blocks.length === 1 ? '' : 's'} · ${totalMinutes} min · ${packet.location}` : 'Packets appear here when coaches publish home drills for this practice.'}
            </div>
          </div>
          {loadingPacket ? <RefreshCw className="mt-1 h-4 w-4 flex-none animate-spin text-primary-600" aria-hidden="true" /> : null}
        </div>
      </div>

      <div className="p-3 sm:p-4">
        {attendanceStatus ? <Status tone="success" message={attendanceStatus} /> : null}
        {attendanceError ? <div className="mt-2"><Status tone="error" message={attendanceError} /></div> : null}
        {canManageAttendance ? (
          <PracticeAttendancePanel
            attendance={attendance}
            loading={loadingAttendance}
            saving={savingAttendance}
            savingPlayerId={savingAttendancePlayerId}
            onSelectStatus={updateAttendanceStatus}
          />
        ) : null}
        {packetStatus ? <Status tone="success" message={packetStatus} /> : null}
        {packetError ? <div className="mt-2"><Status tone="error" message={packetError} /></div> : null}
        {loadingPacket ? (
          <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">Loading packet...</div>
        ) : packet ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <DetailRow label="Drills" value={String(blocks.length)} />
              <DetailRow label="Minutes" value={String(totalMinutes)} />
              <DetailRow label="Complete" value={`${completionChildIds.size}/${packet.children.length || 1}`} />
            </div>
            {event.practiceAttendanceSummary ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-amber-700">Practice attendance</div>
                <div className="mt-1">{event.practiceAttendanceSummary}</div>
              </div>
            ) : null}
            {selectedChild ? (
              <div className={`rounded-xl border p-3 ${selectedComplete ? 'border-emerald-200 bg-emerald-50' : 'border-blue-200 bg-white'}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-black text-gray-950">{selectedChild.name}</div>
                    <div className={`mt-0.5 text-xs font-black ${selectedComplete ? 'text-emerald-700' : 'text-blue-700'}`}>
                      {selectedComplete ? 'Completed' : 'Needs completion'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`min-h-9 rounded-full border px-3 text-xs font-black ${selectedComplete ? 'border-emerald-200 bg-white text-emerald-700' : 'border-blue-200 bg-blue-50 text-blue-800'}`}
                    onClick={markComplete}
                    disabled={selectedComplete || Boolean(busyChildId)}
                  >
                    {busyChildId === selectedChild.id ? 'Saving' : selectedComplete ? 'Completed' : `Mark complete: ${selectedChild.name}`}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              {blocks.map((block, index) => (
                <article key={`${block.drillTitle || block.title || index}-${index}`} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">
                    {block.type || 'Drill'} · {formatPracticePacketDuration(block.duration)} min
                  </div>
                  <div className="mt-1 text-sm font-black text-gray-950">{block.drillTitle || block.title || `Drill ${index + 1}`}</div>
                  {block.description ? <p className="mt-1 text-xs font-semibold leading-5 text-gray-600">{block.description}</p> : null}
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">
            No home packet has been published for this practice yet.
          </div>
        )}
      </div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-black text-gray-950">{value}</div>
    </div>
  );
}

function GameHubDestinationCard({ destination, onShare }: {
  destination: ScheduleHubDestination;
  onShare: () => void;
}) {
  const Icon = hubIconComponents[destination.icon];
  const primaryShares = destination.actionKind === 'share';
  return (
    <article className="rounded-xl border border-primary-100 bg-primary-50 p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white text-primary-700">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-black text-gray-950">{destination.title}</h3>
            {destination.badge ? <span className="inline-flex min-h-5 flex-none items-center rounded-full bg-white px-2 text-[10px] font-extrabold uppercase tracking-[0.04em] text-gray-600">{destination.badge}</span> : null}
          </div>
          <p className="mt-0.5 text-xs font-semibold leading-5 text-gray-500">{destination.detail}</p>
        </div>
      </div>
      <div className={`mt-3 grid gap-2 ${destination.hideShareButton ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_auto]'}`}>
        <button
          type="button"
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-sm font-black text-white shadow-sm transition hover:bg-primary-700"
          onClick={primaryShares ? onShare : () => destination.url && openPublicUrl(destination.url)}
        >
          {destination.actionLabel}
          {primaryShares ? <Share2 className="h-4 w-4" aria-hidden="true" /> : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
        </button>
        {!destination.hideShareButton ? (
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-primary-200 bg-white text-primary-700 shadow-sm transition hover:border-primary-300 hover:bg-primary-50"
            onClick={onShare}
            aria-label={`Share ${destination.shareLabel.toLowerCase()}`}
          >
            <Share2 className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </article>
  );
}

function sortLiveGameChatMessages(messages: LiveGameChatMessage[]) {
  return [...messages].sort((left, right) => getLiveGameChatTimestampValue(left.createdAt) - getLiveGameChatTimestampValue(right.createdAt));
}

export function isLiveGameChatNearBottom(
  container: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'> | null,
  threshold = 96
) {
  if (!container) return true;
  const distanceFromBottom = Math.max(0, container.scrollHeight - container.scrollTop - container.clientHeight);
  return distanceFromBottom <= threshold;
}

function getLiveGameChatTimestampValue(value: unknown) {
  if (value && typeof value === 'object' && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  const parsed = new Date(value as any);
  const timestamp = parsed.getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatLiveGameChatTimestamp(value: unknown) {
  const timestamp = getLiveGameChatTimestampValue(value);
  if (!timestamp) return 'Now';
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });
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

  if (event.isDbGame && !event.isCancelled && !event.availabilityLocked && rsvp === 'not_responded') {
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
  return [
    event.isCancelled ? 'Cancelled' : '',
    getScoreLabel(event) ? `Final ${getScoreLabel(event)}` : '',
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

function getScoreLabel(event: ParentScheduleEvent) {
  if (event.type !== 'game') return '';
  if (event.homeScore === null || event.homeScore === undefined || event.awayScore === null || event.awayScore === undefined) return '';
  return `${event.homeScore}-${event.awayScore}`;
}
