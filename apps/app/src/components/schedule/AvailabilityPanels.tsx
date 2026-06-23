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

export function QuickAvailabilityPanel({ event, rsvp, canSubmitRsvp, submitting, availabilityNote, onAvailabilityNoteChange, onSubmit }: {
  event: ParentScheduleEvent;
  rsvp: RsvpResponse;
  canSubmitRsvp: boolean;
  submitting: RsvpResponse | null;
  availabilityNote: string;
  onAvailabilityNoteChange: (note: string) => void;
  onSubmit: (response: Exclude<RsvpResponse, 'not_responded'>) => Promise<void>;
}) {
  const needsResponse = rsvp === 'not_responded';
  const noteSaveState = getAvailabilityNoteSaveState(rsvp, availabilityNote, event.myRsvpNote || '');
  const showDirtyState = rsvp !== 'not_responded' && noteSaveState.isDirty;
  return (
    <div className={`border-b px-3 py-2.5 sm:px-4 sm:py-3 ${needsResponse ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center gap-2.5 sm:items-start sm:gap-3">
        <PlayerInitials name={event.childName} />
        <div className="min-w-0 flex-1">
          <div className={`text-[11px] font-black uppercase tracking-[0.06em] ${needsResponse ? 'text-amber-800' : showDirtyState ? 'text-amber-800' : 'text-gray-500'}`}>
            {needsResponse ? 'Availability needed' : showDirtyState ? 'Unsaved note changes' : 'Availability saved'}
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
