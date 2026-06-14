import type { RsvpResponse } from '../../lib/scheduleLogic';

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
