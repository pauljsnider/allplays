import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { type ParentScheduleEvent, type RsvpResponse } from '../../lib/scheduleLogic';
import { rsvpBadgeClasses, rsvpLabels } from './AvailabilityNotesList';
import { PlayerInitials } from './PlayerInitials';

export { AvailabilityNotesList, rsvpBadgeClasses, rsvpLabels } from './AvailabilityNotesList';
export { AttentionPanel, type AttentionItem, type ScheduleEventDetailSectionId } from './AttentionPanel';

export function getAvailabilityNoteSaveState(rsvp: RsvpResponse, availabilityNote: string, savedAvailabilityNote: string) {
  const trimmedAvailabilityNote = String(availabilityNote || '').trim();
  const trimmedSavedAvailabilityNote = String(savedAvailabilityNote || '').trim();
  const isDirty = trimmedAvailabilityNote !== trimmedSavedAvailabilityNote;
  const canSaveNote = rsvp !== 'not_responded' && isDirty;

  return {
    isDirty,
    canSaveNote,
    trimmedAvailabilityNote,
    trimmedSavedAvailabilityNote
  };
}

export function formatRsvpSummary(summary?: { going?: number; maybe?: number; notGoing?: number; notResponded?: number } | null) {
  if (!summary) return 'No RSVPs yet';
  return `${summary.going || 0} going · ${summary.maybe || 0} maybe · ${summary.notGoing || 0} out · ${summary.notResponded || 0} missing`;
}

function getReadOnlyAvailabilityMessage(event: ParentScheduleEvent) {
  if (event.isCancelled) {
    return 'This event was cancelled, so availability can no longer be changed.';
  }
  if (!event.isDbGame) {
    return 'This event is not tracked in the team schedule, so availability is unavailable.';
  }
  if (event.availabilityLocked) {
    const cutoffLabel = String(event.availabilityCutoffLabel || '').trim().toLowerCase();
    return cutoffLabel
      ? `The team availability cutoff (${cutoffLabel}) has passed, so responses can no longer be changed.`
      : 'The team availability cutoff has passed, so responses can no longer be changed.';
  }
  return 'Availability is closed for this event.';
}

export function ReadOnlyAvailabilityPanel({ event, rsvp }: {
  event: ParentScheduleEvent;
  rsvp: RsvpResponse;
}) {
  const savedNote = String(event.myRsvpNote || '').trim();
  const responseLabel = rsvp === 'not_responded' ? 'No response recorded' : rsvpLabels[rsvp];

  return (
    <div className="border-b border-gray-200 bg-gray-50 px-3 py-3 sm:px-4">
      <div className="flex items-start gap-2.5 sm:gap-3">
        <PlayerInitials name={event.childName} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black uppercase tracking-[0.06em] text-gray-500">Availability unavailable</div>
          <div className="mt-1 text-sm font-semibold leading-5 text-gray-700">{getReadOnlyAvailabilityMessage(event)}</div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
            <span className="text-xs font-bold text-gray-600">Current response for {event.childName}</span>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${rsvpBadgeClasses[rsvp]}`}>{responseLabel}</span>
          </div>
          {savedNote ? (
            <div className="mt-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Saved note</div>
              <div className="mt-1 text-sm font-semibold leading-5 text-gray-700">{savedNote}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function TeamRsvpToolsDisclosure({ summary, children }: {
  summary?: ParentScheduleEvent['rsvpSummary'];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const summaryLabel = formatRsvpSummary(summary);

  return (
    <div className="mt-3">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-left transition hover:border-primary-200 hover:bg-primary-50"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0">
          <span className="block text-sm font-black text-gray-950">Team RSVP tools</span>
          <span className="mt-0.5 block text-xs font-semibold text-gray-600">{summaryLabel}</span>
        </span>
        <ChevronDown className={`h-4 w-4 flex-none text-gray-500 transition ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open ? <div id={contentId}>{children}</div> : null}
    </div>
  );
}

export function QuickAvailabilityPanel({ event, rsvp, canSubmitRsvp, canEditAvailabilityNote = canSubmitRsvp, submitting, availabilityNote, onAvailabilityNoteChange, onSubmit, question }: {
  event: ParentScheduleEvent;
  rsvp: RsvpResponse;
  canSubmitRsvp: boolean;
  canEditAvailabilityNote?: boolean;
  submitting: RsvpResponse | null;
  availabilityNote: string;
  onAvailabilityNoteChange: (note: string) => void;
  onSubmit: (response: Exclude<RsvpResponse, 'not_responded'>) => Promise<void>;
  question?: string;
}) {
  const needsResponse = rsvp === 'not_responded';
  const noteSaveState = getAvailabilityNoteSaveState(rsvp, availabilityNote, event.myRsvpNote || '');
  const hasSavedNote = Boolean(String(event.myRsvpNote || '').trim());
  const [isNoteEditorOpen, setIsNoteEditorOpen] = useState(() => hasSavedNote || noteSaveState.isDirty);
  const showDirtyState = rsvp !== 'not_responded' && noteSaveState.isDirty;

  useEffect(() => {
    setIsNoteEditorOpen(hasSavedNote || noteSaveState.isDirty);
  }, [event.childId, event.eventKey, hasSavedNote, noteSaveState.isDirty]);

  return (
    <div className={`border-b px-3 py-2.5 sm:px-4 sm:py-3 ${needsResponse ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center gap-2.5 sm:items-start sm:gap-3">
        <PlayerInitials name={event.childName} />
        <div className="min-w-0 flex-1">
          <div className={`text-[11px] font-black uppercase tracking-[0.06em] ${needsResponse ? 'text-amber-800' : showDirtyState ? 'text-amber-800' : 'text-gray-500'}`}>
            {needsResponse ? 'Availability needed' : showDirtyState ? 'Unsaved note changes' : 'Availability saved'}
          </div>
          <div className="mt-0.5 text-sm font-black leading-tight text-gray-950 sm:mt-1 sm:text-base">{question || `Is ${event.childName} going?`}</div>
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
          <button
            type="button"
            className="mt-2 min-h-8 rounded-full border border-gray-200 bg-white px-3 text-xs font-black text-gray-700 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            aria-expanded={isNoteEditorOpen}
            aria-controls={`availability-note-${event.eventKey}-${event.childId}`}
            disabled={!canEditAvailabilityNote || (isNoteEditorOpen && noteSaveState.isDirty)}
            onClick={() => setIsNoteEditorOpen((current) => !current)}
          >
            {isNoteEditorOpen ? 'Hide note' : hasSavedNote ? 'Edit note' : 'Add note'}
          </button>
          {isNoteEditorOpen ? (
            <div id={`availability-note-${event.eventKey}-${event.childId}`}>
              <label className="mt-2 block">
                <span className="sr-only">Availability note</span>
                <textarea
                  aria-label="Availability note"
                  className="auth-input min-h-16 resize-none !px-3 !py-2 text-xs font-semibold"
                  value={availabilityNote}
                  onChange={(changeEvent) => onAvailabilityNoteChange(changeEvent.target.value)}
                  disabled={!canEditAvailabilityNote}
                  placeholder="Optional note for coaches, rides, or arrival details"
                  rows={2}
                  maxLength={280}
                />
              </label>
              <div className="mt-1 text-[11px] font-semibold text-gray-500">
                {event.availabilityNotesVisible ? 'Team note sharing is on for this team.' : 'Notes are visible to team staff unless sharing is enabled.'}
              </div>
            </div>
          ) : null}
          {noteSaveState.canSaveNote ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="text-xs font-black text-amber-900">Note edited but not saved yet.</div>
              <button
                type="button"
                className="min-h-8 rounded-full border border-primary-200 bg-white px-3 text-xs font-black text-primary-700 transition hover:border-primary-300 hover:bg-primary-50"
                disabled={!canSubmitRsvp || submitting === rsvp}
                onClick={() => onSubmit(rsvp as Exclude<RsvpResponse, 'not_responded'>)}
              >
                {submitting === rsvp ? 'Saving' : 'Save note'}
              </button>
            </div>
          ) : null}
          {!canSubmitRsvp ? <div className="mt-2 text-xs font-semibold text-gray-500">Availability is not open for this event.</div> : null}
        </div>
      </div>
    </div>
  );
}
