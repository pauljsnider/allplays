import { normalizeRsvpResponse, type ParentScheduleEvent, type RsvpResponse } from '../../lib/scheduleLogic';

export const rsvpLabels: Record<RsvpResponse, string> = {
  going: 'Going',
  maybe: 'Maybe',
  not_going: "Can't go",
  not_responded: 'RSVP needed'
};

export const rsvpBadgeClasses: Record<RsvpResponse, string> = {
  going: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  maybe: 'border-amber-200 bg-amber-50 text-amber-700',
  not_going: 'border-rose-200 bg-rose-50 text-rose-700',
  not_responded: 'border-primary-200 bg-primary-50 text-primary-700'
};

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
