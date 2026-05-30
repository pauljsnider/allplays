import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle, CalendarDays, Car, CheckCircle2, ChevronDown, ChevronLeft, ClipboardCheck, Clock, ExternalLink, FileText, MapPin, Radio, RefreshCw, Share2, Users, Video, type LucideIcon } from 'lucide-react';
import {
  cancelParentScheduleRideRequest,
  cancelScheduledGameForApp,
  claimParentScheduleAssignmentSlot,
  createParentScheduleRideOffer,
  loadParentPracticePacket,
  loadParentSchedule,
  loadParentScheduleAssignments,
  loadParentScheduleRideOffers,
  loadStaffRsvpReminderPreview,
  markParentPracticePacketComplete,
  publishGamePlanForApp,
  releaseParentScheduleAssignmentClaim,
  requestParentScheduleRideSpot,
  sendStaffRsvpReminder,
  setParentScheduleRideOfferStatus,
  submitParentScheduleRsvp,
  summarizeParentScheduleRideOffers,
  publishLiveScoreUpdateEvent,
  updateGameScore,
  updateParentScheduleRideRequestStatus,
  type RideOfferInput,
  type ParentPracticePacket,
  type ParentPracticePacketChild,
  type StaffRsvpReminderSendResult,
  type RideRequestChildInput
} from '../lib/scheduleService';
import { getLineupPublishStatus, hasLineupDraft } from '../lib/gameDayLineupPublish';
import { loadGameReportSections, type GameReportData, type GameReportInsight, type GameReportPlay, type GameReportPlayerRow } from '../lib/gameReportService';
import { openPublicUrl, sharePublicUrl } from '../lib/publicActions';
import {
  buildGameHubDestinations,
  buildPracticeHubDestinations,
  getPublicPlayerHref,
  type ScheduleHubDestination,
  type ScheduleHubIcon
} from '../lib/scheduleHub';
import {
  canRequestScheduleRide,
  findScheduleRideRequestForChild,
  formatRideDirection,
  formatEventDateLabel,
  formatEventTimeLabel,
  getScheduleMapHref,
  getScheduleAssignmentStatus,
  getScheduleRideRequestCounts,
  getScheduleRideSeatInfo,
  isScheduleAssignmentClaimedByUser,
  isScheduleAssignmentOpen,
  getScheduleTitle,
  normalizeRsvpResponse,
  type RideOfferDirection,
  type RideRequestStatus,
  type ParentScheduleEvent,
  type PracticePacketCompletion,
  type RsvpResponse,
  type ScheduleAssignment,
  type StaffRsvpReminderPreview,
  type ScheduleRideOffer
} from '../lib/scheduleLogic';
import type { AuthState } from '../lib/types';

type EventDetailSectionId = 'availability' | 'rideshare' | 'assignments' | 'game';
type GameReportSectionId = 'summary' | 'players' | 'plays' | 'opponent' | 'insights' | 'media';

const gameReportSections: Array<{ id: GameReportSectionId; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'players', label: 'Players' },
  { id: 'plays', label: 'Plays' },
  { id: 'opponent', label: 'Opponent' },
  { id: 'insights', label: 'Insights' },
  { id: 'media', label: 'Media' }
];

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

const rsvpLabels: Record<RsvpResponse, string> = {
  going: 'Going',
  maybe: 'Maybe',
  not_going: "Can't go",
  not_responded: 'RSVP needed'
};

const rsvpBadgeClasses: Record<RsvpResponse, string> = {
  going: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  maybe: 'border-amber-200 bg-amber-50 text-amber-700',
  not_going: 'border-rose-200 bg-rose-50 text-rose-700',
  not_responded: 'border-primary-200 bg-primary-50 text-primary-700'
};

type AttentionItem = {
  title: string;
  detail: string;
  section: EventDetailSectionId;
};

export function ScheduleEventDetail({ auth }: { auth: AuthState }) {
  const { teamId = '', eventId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [events, setEvents] = useState<ParentScheduleEvent[]>([]);
  const [selectedChildId, setSelectedChildId] = useState(searchParams.get('childId') || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<RsvpResponse | null>(null);
  const [activeSection, setActiveSection] = useState<EventDetailSectionId>('availability');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [availabilityNote, setAvailabilityNote] = useState('');

  const decodedTeamId = decodeURIComponent(teamId);
  const decodedEventId = decodeURIComponent(eventId);

  const selectSection = (sectionId: EventDetailSectionId) => {
    setActiveSection(sectionId);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const loadEvent = async () => {
    if (!auth.user) return;
    setLoading(true);
    setError(null);
    setStatusMessage(null);
    try {
      const result = await loadParentSchedule(auth.user);
      const matching = result.events.filter((event) => event.teamId === decodedTeamId && event.id === decodedEventId);
      setEvents(matching);
      if (!selectedChildId && matching[0]?.childId) {
        setSelectedChildId(matching[0].childId);
      }
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load event details.');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, decodedTeamId, decodedEventId]);

  const selectedEvent = useMemo(() => {
    if (!events.length) return null;
    return events.find((event) => event.childId === selectedChildId) || events[0];
  }, [events, selectedChildId]);

  useEffect(() => {
    setAvailabilityNote(selectedEvent?.myRsvpNote || '');
  }, [selectedEvent?.eventKey, selectedEvent?.myRsvpNote]);

  const handleRideOffersChanged = useCallback((offers: ScheduleRideOffer[]) => {
    const rideshareSummary = summarizeParentScheduleRideOffers(offers);
    setEvents((current) => current.map((event) => (
      event.teamId === decodedTeamId && event.id === decodedEventId
        ? { ...event, rideshareSummary }
      : event
    )));
  }, [decodedEventId, decodedTeamId]);

  const handleAssignmentsChanged = useCallback((assignments: ScheduleAssignment[]) => {
    setEvents((current) => current.map((event) => (
      event.teamId === decodedTeamId && event.id === decodedEventId
        ? { ...event, assignments }
        : event
    )));
  }, [decodedEventId, decodedTeamId]);

  const handleScoreUpdated = useCallback((homeScore: number, awayScore: number) => {
    setEvents((current) => current.map((event) => (
      event.teamId === decodedTeamId && event.id === decodedEventId
        ? { ...event, homeScore, awayScore }
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

  const handleGamePlanPublished = useCallback((gamePlan: Record<string, any>) => {
    setEvents((current) => current.map((event) => (
      event.teamId === decodedTeamId && event.id === decodedEventId
        ? { ...event, gamePlan }
        : event
    )));
  }, [decodedEventId, decodedTeamId]);

  const canSubmitRsvp = Boolean(selectedEvent?.isDbGame && !selectedEvent.isCancelled && !selectedEvent.availabilityLocked);

  const submitRsvp = async (response: Exclude<RsvpResponse, 'not_responded'>) => {
    if (!auth.user || !selectedEvent) return;
    setSubmitting(response);
    setError(null);
    setStatusMessage(null);
    try {
      const note = availabilityNote.trim();
      const summary = await submitParentScheduleRsvp(selectedEvent, auth.user, response, note);
      setEvents((current) => current.map((event) => {
        if (event.teamId !== selectedEvent.teamId || event.id !== selectedEvent.id) return event;
        const sameChild = event.childId === selectedEvent.childId;
        return {
          ...event,
          myRsvp: sameChild ? response : event.myRsvp,
          myRsvpNote: sameChild ? note : event.myRsvpNote,
          rsvpSummary: summary || event.rsvpSummary
        };
      }));
      setStatusMessage(`${selectedEvent.childName} marked ${rsvpLabels[response].toLowerCase()}.`);
    } catch (submitError: any) {
      setError(submitError?.message || 'Unable to submit availability.');
    } finally {
      setSubmitting(null);
    }
  };

  if (loading) {
    return (
      <div className="app-card p-6 text-center">
        <RefreshCw className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
        <div className="mt-3 text-sm font-black text-gray-900">Loading event</div>
        <div className="mt-1 text-xs font-semibold text-gray-500">Pulling parent actions and game-day details.</div>
      </div>
    );
  }

  if (!selectedEvent) {
    return (
      <div className="space-y-3">
        <Link to="/schedule" className="ghost-button min-h-9 px-3 text-xs">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Schedule
        </Link>
        <Status tone="error" message={error || 'This event is not available for your account.'} />
      </div>
    );
  }

  const rsvp = normalizeRsvpResponse(selectedEvent.myRsvp);
  const title = getScheduleTitle(selectedEvent);
  const hasPracticePacket = selectedEvent.type === 'practice' && Boolean(selectedEvent.practiceHomePacketSummary);
  const attentionItems = getAttentionItems(selectedEvent, rsvp).filter((item) => item.section !== 'availability' && item.title !== 'Practice packet ready');
  const sections = getEventDetailSections(selectedEvent);

  return (
    <div className="event-detail-page space-y-3">
      <aside className="event-detail-rail space-y-3">
        <section className="event-summary-card app-card overflow-hidden p-0">
          <div className="p-3 sm:p-4">
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

            <div className="mt-2 flex items-start gap-2.5 sm:gap-3">
              <DateTile date={selectedEvent.date} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-xs font-black uppercase tracking-[0.04em] text-gray-500">{selectedEvent.teamName}</span>
                  <span className={`inline-flex min-h-5 flex-none items-center rounded-full px-2 text-[10px] font-extrabold uppercase tracking-[0.04em] ${selectedEvent.type === 'practice' ? 'bg-amber-100 text-amber-800' : 'bg-primary-100 text-primary-800'}`}>
                    {selectedEvent.type}
                  </span>
                </div>
                <h1 className="mt-0.5 text-lg font-black leading-tight text-gray-950 sm:text-2xl">{title}</h1>
                <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-xs font-bold leading-5 text-gray-600 sm:text-sm">
                  <span>{formatHeroTime(selectedEvent)}</span>
                  <span className="min-w-0 truncate">{selectedEvent.location || 'Location TBD'}</span>
                </div>
              </div>
            </div>

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
              <CompactMeta icon={Users} value={`${selectedEvent.childName} · ${selectedEvent.teamName}`} />
              <span className={`inline-flex min-h-6 flex-none items-center rounded-full border px-2 text-[10px] font-extrabold uppercase tracking-[0.04em] ${rsvpBadgeClasses[rsvp]}`}>
                {rsvpLabels[rsvp]}
              </span>
            </div>

            <EventBrief event={selectedEvent} />
            {events.length > 1 ? <PlayerSwitcher events={events} selectedChildId={selectedEvent.childId} onSelect={setSelectedChildId} /> : null}
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
            auth={auth}
            event={selectedEvent}
            rsvp={rsvp}
            canSubmitRsvp={canSubmitRsvp}
            submitting={submitting}
            availabilityNote={availabilityNote}
            onAvailabilityNoteChange={setAvailabilityNote}
            onSubmit={submitRsvp}
            attentionItems={attentionItems}
            onSelectSection={selectSection}
          />
        ) : null}
        {activeSection === 'rideshare' ? (
          <RideshareSection
            auth={auth}
            event={selectedEvent}
            childEvents={events}
            onOffersChanged={handleRideOffersChanged}
          />
        ) : null}
        {activeSection === 'assignments' ? (
          <AssignmentsSection
            auth={auth}
            event={selectedEvent}
            onAssignmentsChanged={handleAssignmentsChanged}
          />
        ) : null}
        {activeSection === 'game' ? <GameHubSection auth={auth} event={selectedEvent} childEvents={events} onScoreUpdated={handleScoreUpdated} onGameCancelled={handleGameCancelled} onGamePlanPublished={handleGamePlanPublished} /> : null}
      </div>
    </div>
  );
}

function EventSectionNav({ className = '', includeBaseClass = true, sections, activeSection, hasPracticePacket, onSelect }: {
  className?: string;
  includeBaseClass?: boolean;
  sections: Array<{ id: EventDetailSectionId; label: string; shortLabel?: string }>;
  activeSection: EventDetailSectionId;
  hasPracticePacket: boolean;
  onSelect: (sectionId: EventDetailSectionId) => void;
}) {
  return (
    <div className={`${includeBaseClass ? 'event-section-nav ' : ''}${className}`}>
      <div className="grid w-full grid-cols-4 gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
        {sections.map((section) => {
          const active = activeSection === section.id;
          const sectionHasPacket = section.id === 'game' && hasPracticePacket;
          return (
            <button
              key={section.id}
              type="button"
              className={`relative min-h-9 min-w-0 rounded-xl px-1 text-[11px] font-black leading-tight transition sm:px-3 sm:text-xs ${
                active ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950'
              }`}
              onClick={() => onSelect(section.id)}
              aria-label={sectionHasPacket ? `${section.label}, packet ready` : section.label}
            >
              <span className="block truncate">{section.shortLabel || section.label}</span>
              {sectionHasPacket ? (
                <span className={`absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full ${active ? 'bg-white' : 'bg-blue-500'}`} aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DateTile({ date }: { date: Date }) {
  return (
    <div className="flex h-12 w-12 flex-none flex-col items-center justify-center rounded-xl bg-gray-50 shadow-inner ring-1 ring-gray-200 sm:h-16 sm:w-16 sm:rounded-2xl">
      <div className="text-[10px] font-black uppercase leading-none tracking-[0.06em] text-gray-500 sm:text-[11px]">{date.toLocaleDateString('en-US', { month: 'short' })}</div>
      <div className="mt-0.5 text-lg font-black leading-none text-gray-950 sm:text-2xl">{date.getDate()}</div>
      <div className="mt-0.5 text-[10px] font-black uppercase leading-none tracking-[0.06em] text-gray-500 sm:mt-1 sm:tracking-[0.08em]">{date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
    </div>
  );
}

function PlayerInitials({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'P';

  return (
    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gradient-to-br from-gray-700 to-gray-950 text-sm font-black text-white shadow-sm sm:h-11 sm:w-11">
      {initials}
    </div>
  );
}

function QuickAvailabilityPanel({ event, rsvp, canSubmitRsvp, submitting, availabilityNote, onAvailabilityNoteChange, onSubmit }: {
  event: ParentScheduleEvent;
  rsvp: RsvpResponse;
  canSubmitRsvp: boolean;
  submitting: RsvpResponse | null;
  availabilityNote: string;
  onAvailabilityNoteChange: (note: string) => void;
  onSubmit: (response: Exclude<RsvpResponse, 'not_responded'>) => Promise<void>;
}) {
  const needsResponse = rsvp === 'not_responded';
  return (
    <div className={`border-b px-3 py-2.5 sm:px-4 sm:py-3 ${needsResponse ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center gap-2.5 sm:items-start sm:gap-3">
        <PlayerInitials name={event.childName} />
        <div className="min-w-0 flex-1">
          <div className={`text-[11px] font-black uppercase tracking-[0.06em] ${needsResponse ? 'text-amber-800' : 'text-gray-500'}`}>
            {needsResponse ? 'Availability needed' : 'Availability saved'}
          </div>
          <div className="mt-0.5 text-sm font-black leading-tight text-gray-950 sm:mt-1 sm:text-base">Is {event.childName} going?</div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {(['going', 'maybe', 'not_going'] as const).map((response) => (
              <button
                key={response}
                type="button"
                className={`min-h-8 rounded-full border px-2 text-[11px] font-black transition sm:min-h-9 ${
                  rsvp === response ? rsvpBadgeClasses[response] : 'border-gray-200 bg-white text-gray-600 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700'
                } ${!canSubmitRsvp ? 'cursor-not-allowed opacity-60' : ''}`}
                disabled={!canSubmitRsvp || submitting === response}
                onClick={() => onSubmit(response)}
              >
                {submitting === response ? 'Saving' : rsvpLabels[response]}
              </button>
            ))}
          </div>
          <label className="mt-2 block">
            <span className="sr-only">Availability note</span>
            <textarea
              aria-label="Availability note"
              className="auth-input min-h-16 resize-none !px-3 !py-2 text-xs font-semibold"
              value={availabilityNote}
              onChange={(changeEvent) => onAvailabilityNoteChange(changeEvent.target.value)}
              disabled={!canSubmitRsvp}
              placeholder="Optional note for coaches, rides, or arrival details"
              rows={2}
              maxLength={280}
            />
          </label>
          <div className="mt-1 text-[11px] font-semibold text-gray-500">
            {event.availabilityNotesVisible ? 'Team note sharing is on for this team.' : 'Notes are visible to team staff unless sharing is enabled.'}
          </div>
          {!canSubmitRsvp ? <div className="mt-2 text-xs font-semibold text-gray-500">Availability is not open for this event.</div> : null}
        </div>
      </div>
    </div>
  );
}

function AvailabilityNotesList({ event }: { event: ParentScheduleEvent }) {
  const notes = Array.isArray(event.availabilityNotes) ? event.availabilityNotes : [];
  if (!event.availabilityNotesVisible || !notes.length) return null;

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Availability notes</div>
      <div className="mt-2 space-y-2">
        {notes.map((note, index) => {
          const response = normalizeRsvpResponse(note.response);
          return (
            <div key={`${note.displayName}-${index}`} className="rounded-lg bg-gray-50 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-sm font-black text-gray-950">{note.displayName}</div>
                <span className={`flex-none rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.04em] ${rsvpBadgeClasses[response]}`}>
                  {rsvpLabels[response]}
                </span>
              </div>
              <div className="mt-1 text-sm font-semibold leading-5 text-gray-700">{note.note}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompactMeta({ icon: Icon, value }: { icon: LucideIcon; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-gray-800">
      <Icon className="h-4 w-4 flex-none text-primary-600" aria-hidden="true" />
      <span className="min-w-0 truncate">{value}</span>
    </div>
  );
}

function EventBrief({ event }: { event: ParentScheduleEvent }) {
  const pieces = getEventBriefPieces(event);
  if (!pieces.length) return null;

  return (
    <div className="event-brief mt-2 flex-wrap gap-1.5 sm:mt-3">
      {pieces.map((piece) => (
        <span key={piece} className="inline-flex min-h-7 items-center rounded-full border border-gray-200 bg-white px-2.5 text-xs font-extrabold text-gray-700">
          {piece}
        </span>
      ))}
    </div>
  );
}

function AttentionPanel({ items, onSelectSection }: { items: AttentionItem[]; onSelectSection: (sectionId: EventDetailSectionId) => void }) {
  if (!items.length) {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
        <div>
          <div className="font-black">All caught up</div>
          <div className="mt-0.5 text-xs font-semibold text-emerald-700">No parent actions need attention right now.</div>
        </div>
      </div>
    );
  }

  const [primary, ...secondary] = items;

  return (
    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 sm:mt-3 sm:p-3">
      <div className="flex items-center gap-2 text-sm font-black text-amber-900">
        <AlertCircle className="h-4 w-4 flex-none" aria-hidden="true" />
        Needs attention
      </div>
      <button
        type="button"
        className="mt-2 flex w-full items-start justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-left transition hover:border-amber-300 hover:bg-amber-50 sm:py-2"
        onClick={() => onSelectSection(primary.section)}
      >
        <span>
          <span className="block text-sm font-black text-gray-950">{primary.title}</span>
          <span className="mt-0.5 block text-xs font-semibold leading-4 text-gray-600 sm:leading-5">{primary.detail}</span>
        </span>
        <span className="mt-0.5 flex-none text-xs font-black text-primary-700">Go</span>
      </button>
      {secondary.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {secondary.map((item) => (
            <button
              key={`${item.section}-${item.title}`}
              type="button"
              className="min-h-8 rounded-full border border-amber-200 bg-white px-3 text-xs font-black text-amber-900"
              onClick={() => onSelectSection(item.section)}
            >
              {item.title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PlayerSwitcher({ events, selectedChildId, onSelect }: {
  events: ParentScheduleEvent[];
  selectedChildId: string;
  onSelect: (childId: string) => void;
}) {
  return (
    <div className="mt-2 inline-flex max-w-full gap-1 rounded-full border border-gray-200 bg-gray-50 p-0.5 sm:mt-3">
      {events.map((event) => {
        const selected = event.childId === selectedChildId;
        return (
          <button
            key={event.childId}
            type="button"
            className={`min-h-7 min-w-16 rounded-full px-3 text-xs font-black transition ${
              selected ? 'bg-white text-primary-700 shadow-sm ring-1 ring-primary-100' : 'text-gray-600 hover:bg-white'
            }`}
            onClick={() => onSelect(event.childId)}
            aria-pressed={selected}
          >
            <span className="block truncate">{event.childName}</span>
          </button>
        );
      })}
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

function EventDetailsPanel({ event, open }: { event: ParentScheduleEvent; open: boolean }) {
  if (!open) return null;
  const rows = getEventDetailRows(event);
  const mapHref = getScheduleMapHref(event.location);

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white">
      <dl className="divide-y divide-gray-200 px-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start gap-3 py-3">
            <div className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary-50 text-primary-600">
              <row.icon className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <dt className="text-sm font-black text-gray-950">{row.value}</dt>
              <dd className="mt-0.5 text-xs font-semibold text-gray-500">{row.label}</dd>
            </div>
          </div>
        ))}
      </dl>
      {mapHref ? (
        <div className="border-t border-gray-100 p-3">
          <a href={mapHref} target="_blank" rel="noreferrer" className="secondary-button min-h-9 w-full px-3 py-2 text-xs">
            <MapPin className="h-4 w-4" aria-hidden="true" />
            Open map
          </a>
        </div>
      ) : null}
    </div>
  );
}

function AvailabilitySection({ auth, event, rsvp, canSubmitRsvp, submitting, availabilityNote, onAvailabilityNoteChange, onSubmit, attentionItems, onSelectSection }: {
  auth: AuthState;
  event: ParentScheduleEvent;
  rsvp: RsvpResponse;
  canSubmitRsvp: boolean;
  submitting: RsvpResponse | null;
  availabilityNote: string;
  onAvailabilityNoteChange: (note: string) => void;
  onSubmit: (response: Exclude<RsvpResponse, 'not_responded'>) => Promise<void>;
  attentionItems: AttentionItem[];
  onSelectSection: (sectionId: EventDetailSectionId) => void;
}) {
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
        canSubmitRsvp={canSubmitRsvp}
        submitting={submitting}
        availabilityNote={availabilityNote}
        onAvailabilityNoteChange={onAvailabilityNoteChange}
        onSubmit={onSubmit}
      />
      <div className="px-3 pb-3 sm:px-4">
        <AttentionPanel items={attentionItems} onSelectSection={onSelectSection} />
        <StaffRsvpReminderPanel auth={auth} event={event} />
        <AvailabilityNotesList event={event} />
        {!event.isDbGame ? <div className="mt-2 text-xs font-semibold text-gray-500">Availability opens after this event is tracked in the schedule.</div> : null}
        {event.availabilityLocked ? <div className="mt-2 text-xs font-semibold text-amber-700">Availability locked {String(event.availabilityCutoffLabel || '').toLowerCase()}.</div> : null}
      </div>
    </section>
  );
}

function StaffRsvpReminderPanel({ auth, event }: { auth: AuthState; event: ParentScheduleEvent }) {
  const [preview, setPreview] = useState<StaffRsvpReminderPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canLoad = Boolean(auth.user && event.isTeamRsvpReminderManager && event.isDbGame && !event.isCancelled);

  const refreshPreview = useCallback(async () => {
    if (!auth.user || !canLoad) return;
    setLoading(true);
    setError(null);
    try {
      setPreview(await loadStaffRsvpReminderPreview(event, auth.user));
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load RSVP reminder preview.');
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [auth.user, canLoad, event.eventKey, event.teamId, event.id]);

  useEffect(() => {
    setStatus(null);
    if (canLoad) {
      refreshPreview();
    } else {
      setPreview(null);
    }
  }, [canLoad, refreshPreview]);

  if (!event.isTeamRsvpReminderManager || !event.isDbGame || event.isCancelled) return null;
  if (loading && !preview) {
    return <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3 text-sm font-semibold text-gray-600">Loading staff RSVP reminder preview…</div>;
  }
  if (!preview || preview.missingPlayerCount <= 0) return null;

  const sendReminder = async () => {
    if (!auth.user || sending) return;
    const confirmed = window.confirm(`Send an RSVP reminder to ${preview.missingPlayerCount} no-response ${preview.missingPlayerCount === 1 ? 'player' : 'players'}? ${preview.eligibleEmailCount} eligible parent/guardian ${preview.eligibleEmailCount === 1 ? 'email' : 'emails'} will be targeted.`);
    if (!confirmed) return;
    setSending(true);
    setError(null);
    setStatus(null);
    try {
      const result: StaffRsvpReminderSendResult = await sendStaffRsvpReminder(event, auth.user, auth.profile || {});
      setPreview(result);
      setStatus(`RSVP reminder sent to team chat and ${result.emailSentCount} parent/guardian ${result.emailSentCount === 1 ? 'email' : 'emails'}.`);
    } catch (sendError: any) {
      setError(sendError?.message || 'Unable to send RSVP reminder.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-primary-200 bg-primary-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-gray-950">Staff RSVP reminder</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-600">
            {preview.missingPlayerCount} no-response {preview.missingPlayerCount === 1 ? 'player' : 'players'} · {preview.eligibleEmailCount} eligible parent/guardian {preview.eligibleEmailCount === 1 ? 'email' : 'emails'}.
          </div>
        </div>
        <button
          type="button"
          className="primary-button min-h-9 flex-none px-3 text-xs"
          disabled={sending || loading}
          onClick={sendReminder}
        >
          {sending ? 'Sending…' : 'Send reminder'}
        </button>
      </div>
      {status ? <div className="mt-2 text-xs font-bold text-emerald-700">{status}</div> : null}
      {error ? <div className="mt-2 text-xs font-bold text-rose-700">{error}</div> : null}
    </div>
  );
}

type RideChildChoice = {
  childId: string;
  childName: string;
};

const rideDirectionOptions: Array<{ value: RideOfferDirection; label: string }> = [
  { value: 'to', label: 'To event' },
  { value: 'from', label: 'From event' },
  { value: 'round-trip', label: 'Round trip' }
];

function RideshareSection({ auth, event, childEvents, onOffersChanged }: {
  auth: AuthState;
  event: ParentScheduleEvent;
  childEvents: ParentScheduleEvent[];
  onOffersChanged: (offers: ScheduleRideOffer[]) => void;
}) {
  const [offers, setOffers] = useState<ScheduleRideOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [seatCapacity, setSeatCapacity] = useState('3');
  const [direction, setDirection] = useState<RideOfferDirection>('to');
  const [note, setNote] = useState('');
  const [selectedChildByOffer, setSelectedChildByOffer] = useState<Record<string, string>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [rideStatus, setRideStatus] = useState<string | null>(null);
  const [rideError, setRideError] = useState<string | null>(null);

  const childChoices = useMemo(() => getRideChildChoices(childEvents), [childEvents]);
  const summary = loading && !offers.length ? event.rideshareSummary : summarizeParentScheduleRideOffers(offers);

  const refreshOffers = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setRideError(null);
    try {
      const loaded = await loadParentScheduleRideOffers(event);
      setOffers(loaded);
      onOffersChanged(loaded);
    } catch (error: any) {
      setRideError(error?.message || 'Unable to load rideshare offers.');
      setOffers([]);
      onOffersChanged([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [event.id, event.isCancelled, event.isDbGame, event.teamId, onOffersChanged]);

  useEffect(() => {
    setSelectedChildByOffer({});
    setRideStatus(null);
    refreshOffers();
  }, [refreshOffers]);

  const runRideAction = async (actionKey: string, action: () => Promise<void>, successMessage: string) => {
    setBusyAction(actionKey);
    setRideStatus(null);
    setRideError(null);
    try {
      await action();
      await refreshOffers(false);
      setRideStatus(successMessage);
    } catch (error: any) {
      setRideError(error?.message || 'Unable to update rideshare.');
    } finally {
      setBusyAction(null);
    }
  };

  const submitRideOffer = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!auth.user) return;
    const input: RideOfferInput = {
      seatCapacity: Number.parseInt(seatCapacity, 10) || 0,
      direction,
      note
    };
    await runRideAction('create-offer', async () => {
      await createParentScheduleRideOffer(event, auth.user!, input);
      setFormOpen(false);
      setSeatCapacity('3');
      setDirection('to');
      setNote('');
    }, 'Ride offer saved.');
  };

  const updateOfferChild = (offerId: string, childId: string) => {
    setSelectedChildByOffer((current) => ({
      ...current,
      [offerId]: childId
    }));
  };

  const requestSpot = (offer: ScheduleRideOffer, child: RideRequestChildInput) => runRideAction(
    `request-${offer.id}`,
    () => requestParentScheduleRideSpot(event, offer, auth.user!, child),
    `Ride requested for ${child.childName}.`
  );

  const cancelRequest = (offer: ScheduleRideOffer, requestId: string) => runRideAction(
    `cancel-${offer.id}-${requestId}`,
    () => cancelParentScheduleRideRequest(event, offer, requestId),
    'Ride request cancelled.'
  );

  const updateRequestStatus = (offer: ScheduleRideOffer, requestId: string, status: RideRequestStatus) => runRideAction(
    `decision-${offer.id}-${requestId}-${status}`,
    () => updateParentScheduleRideRequestStatus(event, offer, requestId, status),
    `Ride request ${status}.`
  );

  const toggleOfferStatus = (offer: ScheduleRideOffer) => {
    const nextStatus = offer.status === 'open' ? 'closed' : 'open';
    return runRideAction(
      `offer-status-${offer.id}`,
      () => setParentScheduleRideOfferStatus(event, offer, nextStatus),
      nextStatus === 'open' ? 'Ride offer reopened.' : 'Ride offer closed.'
    );
  };

  return (
    <section className="app-card overflow-hidden p-0">
      <div className="border-b border-gray-100 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-black text-primary-800">
              <Car className="h-5 w-5 text-primary-600" aria-hidden="true" />
              Rideshare
            </div>
            <h2 className="mt-1 app-section-title">Rideshare</h2>
            <div className="mt-0.5 text-xs font-semibold text-gray-500">Coordinate seats for this event.</div>
          </div>
          <button
            type="button"
            className="secondary-button !min-h-9 flex-none !px-3 !py-2 text-xs"
            onClick={() => setFormOpen((current) => !current)}
            disabled={!event.isDbGame || event.isCancelled || busyAction === 'create-offer'}
          >
            Offer Ride
          </button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <DetailRow label="Seats open" value={summary ? String(summary.seatsLeft) : '0'} />
          <DetailRow label="Requests" value={summary ? String(summary.requests) : '0'} />
          <DetailRow label="Offers" value={summary ? String(summary.offerCount) : '0'} />
        </div>
      </div>

      {formOpen ? (
        <form className="border-b border-primary-100 bg-primary-50 p-3 sm:p-4" onSubmit={submitRideOffer}>
          <div className="grid grid-cols-[0.75fr_1.25fr] gap-2 sm:grid-cols-[0.6fr_1fr_2fr_auto]">
            <label className="min-w-0">
              <span className="app-label">Seats</span>
              <input
                className="auth-input mt-1 min-h-10 !px-3 !py-2 text-sm"
                type="number"
                min="1"
                max="12"
                value={seatCapacity}
                onChange={(inputEvent) => setSeatCapacity(inputEvent.target.value)}
              />
            </label>
            <label className="min-w-0">
              <span className="app-label">Direction</span>
              <select
                className="auth-input mt-1 min-h-10 !px-3 !py-2 text-sm"
                value={direction}
                onChange={(inputEvent) => setDirection(inputEvent.target.value as RideOfferDirection)}
              >
                {rideDirectionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="col-span-2 min-w-0 sm:col-span-1">
              <span className="app-label">Note</span>
              <input
                className="auth-input mt-1 min-h-10 !px-3 !py-2 text-sm"
                value={note}
                maxLength={160}
                onChange={(inputEvent) => setNote(inputEvent.target.value)}
                placeholder="Optional"
              />
            </label>
            <button type="submit" className="primary-button col-span-2 !min-h-10 !py-2 text-sm sm:col-span-1 sm:self-end" disabled={busyAction === 'create-offer'}>
              {busyAction === 'create-offer' ? 'Saving' : 'Save'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="p-3 sm:p-4">
        {rideStatus ? <Status tone="success" message={rideStatus} /> : null}
        {rideError ? <div className="mt-2"><Status tone="error" message={rideError} /></div> : null}
        {!event.isDbGame || event.isCancelled ? (
          <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">Rideshare is available for active tracked schedule events.</div>
        ) : loading ? (
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-bold text-gray-600">
            <RefreshCw className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
            Loading rideshare offers
          </div>
        ) : offers.length ? (
          <div className="mt-2 space-y-3">
            {offers.map((offer) => (
              <RideOfferCard
                key={offer.id}
                offer={offer}
                event={event}
                userId={auth.user?.uid || ''}
                canManage={canManageRideOffer(offer, auth)}
                childChoices={childChoices}
                selectedChildId={resolveRideChildIdForOffer(offer, event, childChoices, selectedChildByOffer[offer.id], auth.user?.uid || '')}
                busyAction={busyAction}
                onChildChange={(childId) => updateOfferChild(offer.id, childId)}
                onRequest={(child) => requestSpot(offer, child)}
                onCancel={(requestId) => cancelRequest(offer, requestId)}
                onDecision={(requestId, status) => updateRequestStatus(offer, requestId, status)}
                onToggleStatus={() => toggleOfferStatus(offer)}
              />
            ))}
          </div>
        ) : (
          <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">No ride offers yet for this event.</div>
        )}
      </div>
    </section>
  );
}

function RideOfferCard({ offer, event, userId, canManage, childChoices, selectedChildId, busyAction, onChildChange, onRequest, onCancel, onDecision, onToggleStatus }: {
  offer: ScheduleRideOffer;
  event: ParentScheduleEvent;
  userId: string;
  canManage: boolean;
  childChoices: RideChildChoice[];
  selectedChildId: string;
  busyAction: string | null;
  onChildChange: (childId: string) => void;
  onRequest: (child: RideRequestChildInput) => Promise<void>;
  onCancel: (requestId: string) => Promise<void>;
  onDecision: (requestId: string, status: RideRequestStatus) => Promise<void>;
  onToggleStatus: () => Promise<void>;
}) {
  const seatInfo = getScheduleRideSeatInfo(offer);
  const requestCounts = getScheduleRideRequestCounts(offer);
  const selectedChild = childChoices.find((child) => child.childId === selectedChildId) || null;
  const myRequest = selectedChild ? findScheduleRideRequestForChild(offer, userId, selectedChild.childId) : null;
  const canRequest = selectedChild ? canRequestScheduleRide(offer, userId, selectedChild.childId) : false;
  const isDriver = offer.driverUserId === userId;
  const requestBusy = busyAction === `request-${offer.id}`;
  const cancelBusy = myRequest ? busyAction === `cancel-${offer.id}-${myRequest.id}` : false;
  const toggleBusy = busyAction === `offer-status-${offer.id}`;

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-black text-gray-950">{offer.driverName || 'Driver'}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-xs font-semibold text-gray-500">
            <span>{formatRideDirection(offer.direction)}</span>
            <span>{seatInfo.seatCountConfirmed}/{seatInfo.seatCapacity} confirmed</span>
            <span>{seatInfo.seatsLeft} left</span>
            {offer.status !== 'open' ? <span className="font-black text-orange-700">Closed</span> : null}
          </div>
          {offer.note ? <div className="mt-1 text-xs font-semibold italic text-gray-500">{offer.note}</div> : null}
        </div>
        {canManage ? (
          <button
            type="button"
            className={`min-h-8 flex-none rounded-full border px-3 text-xs font-black ${
              offer.status === 'open'
                ? 'border-orange-200 bg-orange-50 text-orange-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
            onClick={onToggleStatus}
            disabled={Boolean(busyAction)}
          >
            {toggleBusy ? 'Saving' : offer.status === 'open' ? 'Close' : 'Reopen'}
          </button>
        ) : null}
      </div>

      <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Ride request</div>
            {childChoices.length > 1 ? (
              <select
                className="auth-input mt-1 min-h-9 !px-3 !py-1.5 text-sm"
                value={selectedChildId}
                onChange={(selectEvent) => onChildChange(selectEvent.target.value)}
              >
                {childChoices.map((child) => <option key={child.childId} value={child.childId}>{child.childName}</option>)}
              </select>
            ) : (
              <div className="mt-1 text-sm font-black text-gray-950">{selectedChild?.childName || event.childName}</div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {isDriver ? (
              <span className="inline-flex min-h-8 items-center rounded-full border border-primary-100 bg-primary-50 px-3 text-xs font-black text-primary-700">Your offer</span>
            ) : null}
            {canRequest && selectedChild ? (
              <button
                type="button"
                className="min-h-8 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-emerald-700"
                onClick={() => onRequest(selectedChild)}
                disabled={Boolean(busyAction)}
              >
                {requestBusy ? 'Requesting' : 'Request spot'}
              </button>
            ) : null}
            {myRequest ? (
              <button
                type="button"
                className="min-h-8 rounded-full border border-gray-200 bg-white px-3 text-xs font-black text-gray-700"
                onClick={() => onCancel(myRequest.id)}
                disabled={Boolean(busyAction)}
              >
                {cancelBusy ? 'Cancelling' : 'Cancel'}
              </button>
            ) : null}
          </div>
        </div>
        {myRequest ? (
          <div className={`mt-2 text-xs font-black ${getRideRequestStatusClass(myRequest.status)}`}>
            Your request for {myRequest.childName || selectedChild?.childName || 'Player'}: {formatRideRequestStatus(myRequest.status)}
          </div>
        ) : !isDriver && !canRequest ? (
          <div className="mt-2 text-xs font-semibold text-gray-500">{getRideUnavailableText(offer, selectedChildId, userId)}</div>
        ) : null}
      </div>

      {canManage && offer.requests.length ? (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Requests</div>
            <div className="text-[11px] font-bold text-gray-500">
              {requestCounts.pending} pending · {requestCounts.confirmed} confirmed
            </div>
          </div>
          <div className="space-y-2">
            {offer.requests.map((request) => (
              <div key={request.id} className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-black text-gray-900">{request.childName || 'Player'}</div>
                    <div className={`mt-0.5 text-xs font-black ${getRideRequestStatusClass(request.status)}`}>{formatRideRequestStatus(request.status)}</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    {(['confirmed', 'waitlisted', 'declined'] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={`min-h-7 rounded-full border px-2 text-[11px] font-black ${getRideDecisionButtonClass(status, request.status)}`}
                        onClick={() => onDecision(request.id, status)}
                        disabled={Boolean(busyAction)}
                      >
                        {busyAction === `decision-${offer.id}-${request.id}-${status}` ? 'Saving' : getRideDecisionLabel(status)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function getRideChildChoices(events: ParentScheduleEvent[]): RideChildChoice[] {
  const byId = new Map<string, RideChildChoice>();
  events.forEach((event) => {
    if (!event.childId || byId.has(event.childId)) return;
    byId.set(event.childId, {
      childId: event.childId,
      childName: event.childName || 'Player'
    });
  });
  return [...byId.values()];
}

function resolveRideChildIdForOffer(offer: ScheduleRideOffer, event: ParentScheduleEvent, childChoices: RideChildChoice[], selectedChildId: string | undefined, userId: string) {
  const validChildIds = new Set(childChoices.map((child) => child.childId));
  if (selectedChildId && validChildIds.has(selectedChildId)) return selectedChildId;
  if (event.childId && validChildIds.has(event.childId)) return event.childId;
  const ownRequest = offer.requests.find((request) => request.parentUserId === userId && request.childId && validChildIds.has(request.childId));
  if (ownRequest?.childId) return ownRequest.childId;
  return childChoices[0]?.childId || '';
}

function canManageRideOffer(offer: ScheduleRideOffer, auth: AuthState) {
  if (!auth.user?.uid) return false;
  return offer.driverUserId === auth.user.uid || auth.isAdmin || auth.isPlatformAdmin;
}

function formatRideRequestStatus(status: unknown) {
  const normalized = String(status || 'pending').toLowerCase();
  if (normalized === 'confirmed') return 'confirmed';
  if (normalized === 'waitlisted') return 'waitlisted';
  if (normalized === 'declined') return 'declined';
  return 'pending';
}

function getRideRequestStatusClass(status: unknown) {
  const normalized = formatRideRequestStatus(status);
  if (normalized === 'confirmed') return 'text-emerald-700';
  if (normalized === 'waitlisted') return 'text-amber-700';
  if (normalized === 'declined') return 'text-rose-700';
  return 'text-gray-600';
}

function getRideDecisionLabel(status: RideRequestStatus) {
  if (status === 'confirmed') return 'Confirm';
  if (status === 'waitlisted') return 'Waitlist';
  return 'Decline';
}

function getRideDecisionButtonClass(status: RideRequestStatus, currentStatus: unknown) {
  const active = formatRideRequestStatus(currentStatus) === status;
  if (status === 'confirmed') return active ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-emerald-200 bg-white text-emerald-700';
  if (status === 'waitlisted') return active ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-amber-200 bg-white text-amber-700';
  return active ? 'border-rose-300 bg-rose-100 text-rose-800' : 'border-rose-200 bg-white text-rose-700';
}

function getRideUnavailableText(offer: ScheduleRideOffer, selectedChildId: string, userId: string) {
  if (!selectedChildId) return 'Select a child first.';
  if (offer.status !== 'open') return 'This ride offer is closed.';
  if (getScheduleRideSeatInfo(offer).seatsLeft <= 0) return 'This ride is full.';
  const existing = findScheduleRideRequestForChild(offer, userId, selectedChildId);
  if (existing) return `Request is ${formatRideRequestStatus(existing.status)}.`;
  return 'Request unavailable.';
}

function AssignmentsSection({ auth, event, onAssignmentsChanged }: {
  auth: AuthState;
  event: ParentScheduleEvent;
  onAssignmentsChanged: (assignments: ScheduleAssignment[]) => void;
}) {
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>(event.assignments);
  const [loading, setLoading] = useState(true);
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [assignmentStatus, setAssignmentStatus] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  const refreshAssignments = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setAssignmentError(null);
    try {
      const loaded = await loadParentScheduleAssignments(event);
      setAssignments(loaded);
      onAssignmentsChanged(loaded);
    } catch (error: any) {
      setAssignmentError(error?.message || 'Unable to load assignments.');
      setAssignments(event.assignments);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [event.id, event.isCancelled, event.isDbGame, event.teamId, onAssignmentsChanged]);

  useEffect(() => {
    setAssignmentStatus(null);
    refreshAssignments();
  }, [refreshAssignments]);

  const runAssignmentAction = async (role: string, action: () => Promise<void>, successMessage: string) => {
    setBusyRole(role);
    setAssignmentStatus(null);
    setAssignmentError(null);
    try {
      await action();
      await refreshAssignments(false);
      setAssignmentStatus(successMessage);
    } catch (error: any) {
      setAssignmentError(error?.message || 'Unable to update assignment.');
    } finally {
      setBusyRole(null);
    }
  };

  const claimSlot = (assignment: ScheduleAssignment) => {
    const role = String(assignment.role || '').trim();
    if (!auth.user || !role) return;
    return runAssignmentAction(
      role,
      () => claimParentScheduleAssignmentSlot(event, auth.user!, role),
      `${role} claimed.`
    );
  };

  const releaseSlot = (assignment: ScheduleAssignment) => {
    const role = String(assignment.role || '').trim();
    if (!role) return;
    return runAssignmentAction(
      role,
      () => releaseParentScheduleAssignmentClaim(event, role),
      `${role} released.`
    );
  };

  const openCount = assignments.filter(isScheduleAssignmentOpen).length;

  return (
    <section className="app-card overflow-hidden p-0">
      <div className="border-b border-gray-100 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-black text-primary-800">
              <ClipboardCheck className="h-5 w-5 text-primary-600" aria-hidden="true" />
              Assignments
            </div>
            <h2 className="mt-1 app-section-title">Assignments</h2>
            <div className="mt-0.5 text-xs font-semibold text-gray-500">
              {assignments.length ? `${assignments.length} posted · ${openCount} open` : 'None posted'}
            </div>
          </div>
          {loading ? <RefreshCw className="mt-1 h-4 w-4 animate-spin text-primary-600" aria-hidden="true" /> : null}
        </div>
      </div>

      <div className="p-3 sm:p-4">
        {assignmentStatus ? <Status tone="success" message={assignmentStatus} /> : null}
        {assignmentError ? <div className="mt-2"><Status tone="error" message={assignmentError} /></div> : null}
        <div className="mt-2 space-y-2">
          {assignments.length ? assignments.map((assignment, index) => (
            <AssignmentCard
              key={`${assignment.role || 'assignment'}-${index}`}
              assignment={assignment}
              userId={auth.user?.uid || ''}
              busy={busyRole === String(assignment.role || '').trim()}
              disabled={Boolean(busyRole) || !event.isDbGame || event.isCancelled}
              onClaim={() => claimSlot(assignment)}
              onRelease={() => releaseSlot(assignment)}
            />
          )) : (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">None posted</div>
          )}
        </div>
        {!event.isDbGame || event.isCancelled ? (
          <div className="mt-2 text-xs font-semibold text-gray-500">Assignment sign-up is available for active tracked schedule events.</div>
        ) : null}
      </div>
    </section>
  );
}

function AssignmentCard({ assignment, userId, busy, disabled, onClaim, onRelease }: {
  assignment: ScheduleAssignment;
  userId: string;
  busy: boolean;
  disabled: boolean;
  onClaim: () => void | Promise<void>;
  onRelease: () => void | Promise<void>;
}) {
  const role = String(assignment.role || 'Assignment').trim();
  const myOwn = isScheduleAssignmentClaimedByUser(assignment, userId);
  const open = isScheduleAssignmentOpen(assignment);
  const status = getScheduleAssignmentStatus(assignment, userId);

  return (
    <article className={`rounded-xl border p-3 ${myOwn ? 'border-emerald-200 bg-emerald-50' : open ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-black text-gray-950">{role}</div>
          <div className={`mt-1 text-xs font-black ${myOwn ? 'text-emerald-700' : open ? 'text-amber-800' : 'text-gray-600'}`}>
            {assignment.claimable ? status : `${role}: ${status}`}
          </div>
          {assignment.claimable ? (
            <div className="mt-1 text-[11px] font-semibold text-gray-500">Parent sign-up slot</div>
          ) : null}
        </div>
        {myOwn ? (
          <button
            type="button"
            className="min-h-8 flex-none rounded-full border border-emerald-200 bg-white px-3 text-xs font-black text-emerald-700"
            onClick={onRelease}
            disabled={disabled}
          >
            {busy ? 'Releasing' : 'Release'}
          </button>
        ) : open ? (
          <button
            type="button"
            className="min-h-8 flex-none rounded-full border border-amber-200 bg-white px-3 text-xs font-black text-amber-800"
            onClick={onClaim}
            disabled={disabled}
          >
            {busy ? 'Signing up' : 'Sign up'}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function GameHubSection({ auth, event, childEvents, onScoreUpdated, onGameCancelled, onGamePlanPublished }: { auth: AuthState; event: ParentScheduleEvent; childEvents: ParentScheduleEvent[]; onScoreUpdated: (homeScore: number, awayScore: number) => void; onGameCancelled: () => void; onGamePlanPublished: (gamePlan: Record<string, any>) => void }) {
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [cancelStatus, setCancelStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const statusLabel = getEventStatusLabel(event);
  const scoreLabel = getScoreLabel(event);
  const isPractice = event.type === 'practice';
  const canUpdateScore = Boolean(!isPractice && event.isDbGame && !event.isCancelled && event.canUpdateScore && auth.user);
  const canCancelGame = Boolean(!isPractice && event.isDbGame && !event.isCancelled && event.canUpdateScore && auth.user);
  const canPublishLineup = Boolean(!isPractice && event.isDbGame && event.isTeamStaff);
  const hubDestinations = isPractice ? buildPracticeHubDestinations(event) : buildGameHubDestinations(event);

  const cancelGame = async () => {
    if (!auth.user) return;
    const opponentLabel = event.opponent || event.title || 'this game';
    const confirmed = window.confirm(`Cancel ${opponentLabel} on ${formatEventDateLabel(event.date)}? This marks the game cancelled and notifies the team in chat.`);
    if (!confirmed) return;

    setCancelling(true);
    setCancelStatus(null);
    try {
      const result = await cancelScheduledGameForApp(event, auth.user);
      onGameCancelled();
      setCancelStatus(result.notificationError
        ? { tone: 'error', message: `Game cancelled, but team chat notification failed: ${result.notificationError}` }
        : { tone: 'success', message: 'Game cancelled and team chat notified.' });
    } catch (error: any) {
      setCancelStatus({ tone: 'error', message: error?.message || 'Unable to cancel game.' });
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
      {isPractice ? <PracticePacketSection auth={auth} event={event} childEvents={childEvents} /> : null}
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
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-black text-gray-950">{isPractice ? event.title || 'Practice' : getScheduleTitle(event)}</div>
              <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs font-semibold text-gray-500">
                <span>{formatEventDateLabel(event.date)} · {formatEventTimeLabel(event.date)}</span>
                <span className="min-w-0 truncate">{event.location || 'Location TBD'}</span>
              </div>
            </div>
            {scoreLabel ? <div className="flex-none text-right text-2xl font-black tabular-nums text-gray-950">{scoreLabel}</div> : null}
          </div>

          {canUpdateScore ? <LiveScoreEditor auth={auth} event={event} onScoreUpdated={onScoreUpdated} /> : null}

          {canPublishLineup ? (
            <GameHubLineupPublishPanel auth={auth} event={event} onGamePlanPublished={onGamePlanPublished} />
          ) : null}

          {canCancelGame ? (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-black uppercase tracking-[0.04em] text-rose-700">Schedule management</div>
                  <div className="mt-1 text-sm font-semibold text-rose-900">Cancel this game and notify the team chat.</div>
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
      {!isPractice ? <GameReportSections event={event} /> : null}
    </section>
  );
}

function GameHubLineupPublishPanel({ auth, event, onGamePlanPublished }: { auth: AuthState; event: ParentScheduleEvent; onGamePlanPublished: (gamePlan: Record<string, any>) => void }) {
  const [publishing, setPublishing] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const hasDraft = hasLineupDraft(event.gamePlan);
  const canPublish = Boolean(auth.user && hasDraft && !event.isCancelled);
  const statusCopy = getLineupPublishStatus(event.gamePlan);
  const disabledCopy = !auth.user
    ? 'Sign in as a coach or admin to publish the lineup.'
    : event.isCancelled
      ? 'Cancelled games cannot publish lineup changes.'
      : !hasDraft
        ? 'Save a lineup draft before publishing.'
        : null;

  const publishLineup = async () => {
    if (!auth.user || !canPublish) return;
    setPublishing(true);
    setStatus(null);
    try {
      const result = await publishGamePlanForApp(event, auth.user);
      onGamePlanPublished(result.gamePlan);
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
    <div className="mt-3 rounded-2xl border border-primary-100 bg-primary-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-[0.04em] text-primary-700">Lineup publish</div>
          <div className="mt-1 text-sm font-semibold text-gray-950">{statusCopy}</div>
          {disabledCopy ? <div className="mt-1 text-xs font-semibold text-gray-500">{disabledCopy}</div> : null}
        </div>
        <button
          type="button"
          className="min-h-11 rounded-full bg-primary-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60"
          onClick={publishLineup}
          disabled={!canPublish || publishing}
        >
          {publishing ? 'Publishing lineup' : 'Publish lineup'}
        </button>
      </div>
      {status ? <div className={`mt-3 text-sm font-semibold ${status.tone === 'success' ? 'text-emerald-700' : 'text-amber-800'}`}>{status.message}</div> : null}
    </div>
  );
}

type ScoreSnapshot = {
  homeScore: number;
  awayScore: number;
};

function LiveScoreEditor({ auth, event, onScoreUpdated }: { auth: AuthState; event: ParentScheduleEvent; onScoreUpdated: (homeScore: number, awayScore: number) => void }) {
  const savedHomeScore = Math.max(0, Number(event.homeScore ?? 0));
  const savedAwayScore = Math.max(0, Number(event.awayScore ?? 0));
  const [homeScore, setHomeScore] = useState(savedHomeScore);
  const [awayScore, setAwayScore] = useState(savedAwayScore);
  const [previousScoreSnapshots, setPreviousScoreSnapshots] = useState<ScoreSnapshot[]>([]);
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

  return (
    <div className={`mt-3 rounded-2xl border p-3 ${dirty ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-gray-50'}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Live score</div>
          <div className="mt-0.5 text-xs font-semibold text-gray-600">{dirty ? 'Unsaved score changes' : 'Saved score controls'}</div>
        </div>
        <div className="rounded-full bg-white px-3 py-1 text-xl font-black tabular-nums text-gray-950 shadow-sm">{homeScore}-{awayScore}</div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <ScoreStepper label="Home" value={homeScore} onDecrease={() => adjust('home', -1)} onIncrease={() => adjust('home', 1)} disabled={saving} />
        <ScoreStepper label="Away" value={awayScore} onDecrease={() => adjust('away', -1)} onIncrease={() => adjust('away', 1)} disabled={saving} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="primary-button min-h-11 px-4 text-sm"
            onClick={saveScore}
            disabled={saving || !dirty}
          >
            {saving ? 'Saving score' : 'Save score'}
          </button>
          {previousScoreSnapshots.length ? (
            <button
              type="button"
              className="ghost-button min-h-11 px-4 text-sm"
              onClick={undoLastScoreChange}
              disabled={saving || !previousScoreSnapshots.length}
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

function ScoreStepper({ label, value, onDecrease, onIncrease, disabled }: { label: string; value: number; onDecrease: () => void; onIncrease: () => void; disabled: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-2">
      <div className="mb-2 text-center text-xs font-black uppercase tracking-[0.04em] text-gray-500">{label}</div>
      <div className="flex items-center justify-center gap-3">
        <button type="button" className="min-h-11 min-w-11 rounded-full border border-gray-200 text-xl font-black text-gray-700 disabled:opacity-40" onClick={onDecrease} disabled={disabled || value <= 0} aria-label={`${label} score down`}>−</button>
        <div className="min-w-12 text-center text-3xl font-black tabular-nums text-gray-950">{value}</div>
        <button type="button" className="min-h-11 min-w-11 rounded-full border border-gray-200 text-xl font-black text-gray-700 disabled:opacity-40" onClick={onIncrease} disabled={disabled} aria-label={`${label} score up`}>+</button>
      </div>
    </div>
  );
}

function PracticePacketSection({ auth, event, childEvents }: { auth: AuthState; event: ParentScheduleEvent; childEvents: ParentScheduleEvent[] }) {
  const [packet, setPacket] = useState<ParentPracticePacket | null>(null);
  const [loadingPacket, setLoadingPacket] = useState(true);
  const [packetStatus, setPacketStatus] = useState<string | null>(null);
  const [packetError, setPacketError] = useState<string | null>(null);
  const [busyChildId, setBusyChildId] = useState<string | null>(null);

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

function GameReportSections({ event }: { event: ParentScheduleEvent }) {
  const [activeReportSection, setActiveReportSection] = useState<GameReportSectionId>('summary');
  const [report, setReport] = useState<GameReportData | null>(null);
  const [loadingReport, setLoadingReport] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingReport(true);
    setReportError(null);
    setReport(null);
    setActiveReportSection('summary');

    loadGameReportSections(event.teamId, event.id)
      .then((loaded) => {
        if (cancelled) return;
        setReport(loaded);
      })
      .catch((error: any) => {
        if (cancelled) return;
        setReportError(error?.message || 'Unable to load game report.');
      })
      .finally(() => {
        if (!cancelled) setLoadingReport(false);
      });

    return () => {
      cancelled = true;
    };
  }, [event.id, event.teamId]);

  return (
    <div className="app-card overflow-hidden p-0">
      <div className="border-b border-gray-100 px-3 py-3 sm:px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-black text-gray-950">Report sections</h3>
            <div className="mt-0.5 text-xs font-semibold text-gray-500">Loaded from the same report data as game.html.</div>
          </div>
          {loadingReport ? <RefreshCw className="mt-0.5 h-4 w-4 flex-none animate-spin text-primary-600" aria-hidden="true" /> : null}
        </div>
      </div>

      <div className="border-b border-gray-100 px-2 py-2">
        <div className="flex gap-1 overflow-x-auto pb-0.5">
          {gameReportSections.map((section) => {
            const active = section.id === activeReportSection;
            return (
              <button
                key={section.id}
                type="button"
                className={`min-h-8 flex-none rounded-full px-3 text-xs font-black transition ${
                  active ? 'bg-primary-600 text-white shadow-sm' : 'bg-gray-50 text-gray-600 hover:bg-primary-50 hover:text-primary-700'
                }`}
                onClick={() => setActiveReportSection(section.id)}
              >
                {section.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-3 sm:p-4">
        {loadingReport ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">Loading report sections...</div>
        ) : reportError ? (
          <Status tone="error" message={reportError} />
        ) : report ? (
          <GameReportSectionContent report={report} activeSection={activeReportSection} />
        ) : null}
      </div>
    </div>
  );
}

function GameReportSectionContent({ report, activeSection }: { report: GameReportData; activeSection: GameReportSectionId }) {
  if (activeSection === 'players') return <PlayerPerformanceSection report={report} />;
  if (activeSection === 'plays') return <PlayByPlaySection plays={report.plays} />;
  if (activeSection === 'opponent') return <OpponentStatsSection report={report} />;
  if (activeSection === 'insights') return <ReportInsightsSection report={report} />;
  if (activeSection === 'media') return <ReportMediaSection report={report} />;
  return <MatchSummarySection report={report} />;
}

function MatchSummarySection({ report }: { report: GameReportData }) {
  const score = getReportScoreLabel(report.game);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <DetailRow label="Result" value={getReportResultLabel(report.game)} />
        <DetailRow label="Score" value={score || 'TBD'} />
        <DetailRow label="Plays" value={String(report.plays.length)} />
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Match Summary</div>
        {report.summary ? (
          <ReportMarkdownText text={report.summary} />
        ) : (
          <p className="mt-2 text-sm font-semibold text-gray-500">No summary available yet.</p>
        )}
      </div>
    </div>
  );
}

function PlayerPerformanceSection({ report }: { report: GameReportData }) {
  const statKeys = report.statKeys.slice(0, 4);
  if (!report.playerRows.length) {
    return <EmptyReportState title="No players found" detail="Player performance will appear after roster and stats load." />;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-1 text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">
        <span>Player</span>
        <span>Stats</span>
      </div>
      {report.playerRows.map((player) => (
        <PlayerPerformanceRow
          key={player.playerId}
          player={player}
          statKeys={statKeys}
          statLabels={report.statLabels}
          hasPlayingTime={report.hasPlayingTime}
          teamId={report.team.id || ''}
          gameId={report.game.id || ''}
        />
      ))}
    </div>
  );
}

function PlayerPerformanceRow({ player, statKeys, statLabels, hasPlayingTime, teamId, gameId }: {
  player: GameReportPlayerRow;
  statKeys: string[];
  statLabels: Record<string, string>;
  hasPlayingTime: boolean;
  teamId: string;
  gameId: string;
}) {
  return (
    <a href={getPublicPlayerHref(teamId, gameId, player.playerId)} className="block rounded-xl border border-gray-200 bg-white p-3 transition hover:border-primary-200 hover:bg-primary-50">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-full bg-gray-100 text-sm font-black text-gray-500">
            {player.photoUrl ? <img src={player.photoUrl} alt="" className="h-full w-full object-cover" /> : player.playerName.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-gray-950">#{player.number} {player.playerName}</div>
            <div className="mt-0.5 flex items-center gap-2 text-xs font-semibold text-gray-500">
              {player.didNotPlay ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-800">DNP</span> : null}
              {hasPlayingTime && !player.didNotPlay ? <span>{formatDuration(player.timeMs)} min</span> : null}
            </div>
          </div>
        </div>
        <div className="flex flex-none flex-wrap justify-end gap-1.5">
          {statKeys.map((key) => (
            <span key={key} className="min-w-11 rounded-lg bg-gray-50 px-2 py-1 text-center">
              <span className="block text-[10px] font-black uppercase text-gray-400">{statLabels[key] || key.toUpperCase()}</span>
              <span className="block text-sm font-black tabular-nums text-gray-900">{player.didNotPlay ? '-' : String(player.stats[key] || 0)}</span>
            </span>
          ))}
        </div>
      </div>
    </a>
  );
}

function PlayByPlaySection({ plays }: { plays: GameReportPlay[] }) {
  if (!plays.length) {
    return <EmptyReportState title="No events logged" detail="Play-by-play will appear here during or after the game." />;
  }

  return (
    <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
      {plays.map((play) => (
        <div key={play.id || `${play.period}-${play.clock}-${play.text}`} className="rounded-r-xl border-l-4 border-primary-500 bg-gray-50 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex min-h-6 flex-none items-center rounded-md bg-primary-600 px-2 text-[11px] font-black text-white">{play.period}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-5 text-gray-900">{play.text}</div>
              <div className="mt-1 flex gap-2 text-xs font-semibold text-gray-500">
                {play.clock ? <span className="font-mono">{play.clock}</span> : null}
                {play.timestamp ? <span>{formatReportTime(play.timestamp)}</span> : null}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OpponentStatsSection({ report }: { report: GameReportData }) {
  if (!report.opponentRows.length || !report.opponentStatKeys.length) {
    return <EmptyReportState title="No opponent stats" detail="Opponent stats will appear after they are tracked or imported." />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="bg-gray-50 text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">
          <tr>
            <th className="px-3 py-3 text-left">#</th>
            <th className="px-3 py-3 text-left">Player</th>
            {report.opponentStatKeys.map((key) => (
              <th key={key} className="px-3 py-3 text-center">{report.opponentStatLabels[key] || key.toUpperCase()}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {report.opponentRows.map((row) => (
            <tr key={row.id}>
              <td className="px-3 py-3 font-mono font-bold text-gray-500">{row.number}</td>
              <td className="px-3 py-3 font-bold text-gray-900">{row.name}</td>
              {report.opponentStatKeys.map((key) => (
                <td key={key} className="px-3 py-3 text-center font-mono font-bold text-gray-700">{String(row.stats[key] || 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportMediaSection({ report }: { report: GameReportData }) {
  const highlightClips = report.highlightClips || [];
  const teamStatKeys = report.teamStatKeys || [];
  const hasTeamStats = teamStatKeys.length > 0;
  const hasMedia = highlightClips.length > 0 || Boolean(report.statSheetPhotoUrl) || hasTeamStats;
  if (!hasMedia) {
    return <EmptyReportState title="No report media yet" detail="Highlights, stat sheet photos, and team totals appear after the game is finalized." />;
  }

  return (
    <div className="space-y-3">
      {highlightClips.length ? (
        <div className="space-y-2">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Highlights</div>
          {highlightClips.map((clip, index) => (
            <a key={`${clip.url}-${index}`} href={clip.url} target="_blank" rel="noreferrer" className="block rounded-xl border border-gray-200 bg-white p-3 transition hover:border-primary-200 hover:bg-primary-50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-gray-950">{clip.description || clip.title}</div>
                  <div className="mt-1 text-xs font-semibold text-gray-500">{[clip.period, clip.gameTime].filter(Boolean).join(' · ') || 'Replay clip'}</div>
                </div>
                <ExternalLink className="mt-0.5 h-4 w-4 flex-none text-primary-600" aria-hidden="true" />
              </div>
            </a>
          ))}
        </div>
      ) : null}

      {report.statSheetPhotoUrl ? (
        <a href={report.statSheetPhotoUrl} target="_blank" rel="noreferrer" className="block rounded-xl border border-gray-200 bg-white p-3 transition hover:border-primary-200 hover:bg-primary-50">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-gray-950">Score sheet photo</div>
              <div className="mt-0.5 text-xs font-semibold text-gray-500">Open the uploaded stat sheet from game.html.</div>
            </div>
            <ExternalLink className="h-4 w-4 flex-none text-primary-600" aria-hidden="true" />
          </div>
        </a>
      ) : null}

      {hasTeamStats ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Team stats</div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {teamStatKeys.slice(0, 8).map((key) => (
              <div key={key} className="rounded-lg bg-gray-50 p-2 text-center">
                <div className="text-[10px] font-black uppercase text-gray-500">{report.teamStatLabels[key] || key.toUpperCase()}</div>
                <div className="mt-1 text-lg font-black tabular-nums text-gray-950">{String(report.teamStats[key] || 0)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReportInsightsSection({ report }: { report: GameReportData }) {
  const hasInsights = report.teamInsights.length || report.playerInsightRows.length;
  if (!hasInsights) {
    return <EmptyReportState title="No insights yet" detail={report.emptyInsightsMessage || 'Insights populate after the game is finalized.'} />;
  }

  return (
    <div className="space-y-3">
      {report.teamInsights.length ? (
        <div className="space-y-2">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Team insights</div>
          {report.teamInsights.map((insight) => <InsightCard key={`${insight.title}-${insight.body}`} insight={insight} />)}
        </div>
      ) : null}
      {report.playerInsightRows.length ? (
        <div className="space-y-2">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Player insights</div>
          {report.playerInsightRows.map((entry) => (
            <div key={entry.playerId} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="text-sm font-black text-gray-950">{entry.playerName}</div>
              <div className="mt-2 space-y-2">
                {entry.insights.map((insight) => <InsightCard key={`${entry.playerId}-${insight.title}-${insight.body}`} insight={insight} compact />)}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InsightCard({ insight, compact = false }: { insight: GameReportInsight; compact?: boolean }) {
  const toneClass = insight.tone === 'positive'
    ? 'border-emerald-200 bg-emerald-50'
    : insight.tone === 'warning'
      ? 'border-amber-200 bg-amber-50'
      : 'border-gray-200 bg-gray-50';
  return (
    <div className={`rounded-xl border px-3 ${compact ? 'py-2' : 'py-3'} ${toneClass}`}>
      <div className="text-sm font-black text-gray-950">{insight.title || 'Insight'}</div>
      <ReportMarkdownText text={insight.body} compact />
    </div>
  );
}

function ReportMarkdownText({ text, compact = false }: { text: string; compact?: boolean }) {
  const lines = String(text || '').split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push(
        <div key={`heading-${index}`} className="pt-1 text-sm font-black text-gray-950">
          {renderReportInlineMarkdown(headingMatch[2], `heading-${index}`)}
        </div>
      );
      index += 1;
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        const item = lines[index].trim().replace(/^\d+\.\s+/, '');
        items.push(<li key={`ordered-${index}`}>{renderReportInlineMarkdown(item, `ordered-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ordered-list-${index}`} className="list-decimal space-y-1 pl-5">{items}</ol>);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        const item = lines[index].trim().replace(/^[-*]\s+/, '');
        items.push(<li key={`bullet-${index}`}>{renderReportInlineMarkdown(item, `bullet-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ul key={`bullet-list-${index}`} className="list-disc space-y-1 pl-5">{items}</ul>);
      continue;
    }

    blocks.push(
      <p key={`paragraph-${index}`} className="whitespace-pre-wrap">
        {renderReportInlineMarkdown(line, `paragraph-${index}`)}
      </p>
    );
    index += 1;
  }

  return (
    <div className={`${compact ? 'mt-1 space-y-1 text-sm leading-5' : 'mt-2 space-y-2 text-sm leading-6'} font-semibold text-gray-700`}>
      {blocks}
    </div>
  );
}

function renderReportInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+?\*\*|__[^_]+?__|`[^`]+?`|https?:\/\/[^\s)]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<Fragment key={`${keyPrefix}-text-${lastIndex}`}>{text.slice(lastIndex, match.index)}</Fragment>);
    }

    const token = match[0];
    const key = `${keyPrefix}-token-${match.index}`;
    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
      nodes.push(<strong key={key} className="font-black text-gray-950">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(<code key={key} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.82em] text-gray-800">{token.slice(1, -1)}</code>);
    } else {
      nodes.push(
        <a key={key} href={token} target="_blank" rel="noreferrer" className="break-all font-black text-primary-700 underline decoration-primary-200 underline-offset-2">
          {token}
        </a>
      );
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(<Fragment key={`${keyPrefix}-text-tail`}>{text.slice(lastIndex)}</Fragment>);
  }

  return nodes;
}

function EmptyReportState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center">
      <div className="text-sm font-black text-gray-700">{title}</div>
      <div className="mt-1 text-xs font-semibold text-gray-500">{detail}</div>
    </div>
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

function Status({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  const isError = tone === 'error';
  return (
    <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold ${isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      {isError ? <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />}
      {message}
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

function formatAssignment(assignment?: { role?: string; value?: string; claim?: { claimedByName?: string } | null }) {
  if (!assignment) return 'None posted';
  if (assignment.claim?.claimedByName) return `${assignment.role || 'Role'}: ${assignment.claim.claimedByName}`;
  if (assignment.value) return `${assignment.role || 'Role'}: ${assignment.value}`;
  if (assignment.role) return `${assignment.role}: Open`;
  return 'None posted';
}

function formatRsvpSummary(summary?: { going?: number; maybe?: number; notGoing?: number; notResponded?: number } | null) {
  if (!summary) return 'No RSVPs yet';
  return `${summary.going || 0} going · ${summary.maybe || 0} maybe · ${summary.notGoing || 0} out · ${summary.notResponded || 0} missing`;
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

function getEventDetailRows(event: ParentScheduleEvent) {
  return [
    { label: 'Date', value: formatEventDateLabel(event.date), icon: CalendarDays },
    { label: 'Start time', value: formatEventTimeLabel(event.date), icon: Clock },
    event.endDate ? { label: 'End time', value: formatEventTimeLabel(event.endDate), icon: Clock } : null,
    event.arrivalTime ? { label: 'Arrival time', value: formatEventTimeLabel(event.arrivalTime), icon: Clock } : null,
    { label: 'Location', value: event.location || 'TBD', icon: MapPin },
    { label: 'Game info', value: formatGameInfo(event), icon: ClipboardCheck },
    event.seasonLabel ? { label: 'Season', value: event.seasonLabel, icon: CalendarDays } : null,
    event.competitionType ? { label: 'Competition', value: event.competitionType, icon: ClipboardCheck } : null,
    event.sourceLabel ? { label: 'Source', value: event.sourceLabel, icon: ExternalLink } : null,
    event.kitColor ? { label: 'Kit', value: event.kitColor, icon: Users } : null,
    event.practiceAttendanceSummary ? { label: 'Practice', value: event.practiceAttendanceSummary, icon: ClipboardCheck } : null,
    event.practiceHomePacketSummary ? { label: 'Home packet', value: event.practiceHomePacketSummary, icon: FileText } : null,
    event.notes ? { label: 'Notes', value: event.notes, icon: FileText } : null
  ].filter((row): row is { label: string; value: string; icon: LucideIcon } => Boolean(row));
}

function formatHeroTime(event: ParentScheduleEvent) {
  if (event.arrivalTime) {
    return `Arrive ${formatEventTimeLabel(event.arrivalTime)} · Starts ${formatEventTimeLabel(event.date)}`;
  }
  return `Starts ${formatEventTimeLabel(event.date)}`;
}

function formatGameInfo(event: ParentScheduleEvent) {
  const pieces = [
    event.isHome === true ? 'Home' : event.isHome === false ? 'Away' : '',
    event.kitColor ? `${event.kitColor} kit` : '',
    event.countsTowardSeasonRecord === false ? 'Exhibition' : '',
    event.isCancelled ? 'Cancelled' : ''
  ].filter(Boolean);
  return pieces.length ? pieces.join(' · ') : 'Game-day details';
}

function getReportScoreLabel(game: Record<string, any>) {
  if (game.homeScore === null || game.homeScore === undefined || game.awayScore === null || game.awayScore === undefined) return '';
  return `${game.homeScore}-${game.awayScore}`;
}

function getReportResultLabel(game: Record<string, any>) {
  const homeScore = Number(game.homeScore || 0);
  const awayScore = Number(game.awayScore || 0);
  const completed = String(game.status || '').toLowerCase() === 'completed' || String(game.liveStatus || '').toLowerCase() === 'completed';
  if (homeScore > awayScore) return 'Victory';
  if (homeScore < awayScore) return 'Defeat';
  if (completed) return 'Tie';
  return 'Report';
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatReportTime(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
