import { normalizeRsvpResponse, type ParentScheduleEvent } from '../../lib/scheduleLogic';
import { rsvpBadgeClasses, rsvpLabels } from './rsvpUi';

export function AvailabilityNotesList({ event }: { event: ParentScheduleEvent }) {
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
