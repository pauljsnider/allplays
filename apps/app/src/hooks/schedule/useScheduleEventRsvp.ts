import { useState } from 'react';
import { submitParentScheduleRsvp } from '../../lib/scheduleService';
import { normalizeRsvpResponse, type RsvpResponse } from '../../lib/scheduleLogic';
import { useScheduleEventDetailContext } from '../../pages/schedule/ScheduleEventDetailContext';

export function useScheduleEventRsvp({ availabilityNote }: { availabilityNote: string }) {
  const { auth, event, updateEvents } = useScheduleEventDetailContext();
  const [submitting, setSubmitting] = useState<RsvpResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = Boolean(event.isDbGame && !event.isCancelled && !event.availabilityLocked);

  const submit = async (response: Exclude<RsvpResponse, 'not_responded'>) => {
    if (!auth.user || !canSubmit) return;

    setSubmitting(response);
    setMessage(null);
    setError(null);

    try {
      const previousRsvp = normalizeRsvpResponse(event.myRsvp);
      const previousNote = String(event.myRsvpNote || '').trim();
      const note = String(availabilityNote || '').trim();
      const summary = await submitParentScheduleRsvp(event, auth.user, response, note);

      updateEvents((current) => current.map((currentEvent) => {
        if (currentEvent.teamId !== event.teamId || currentEvent.id !== event.id) return currentEvent;
        const sameChild = currentEvent.childId === event.childId;
        return {
          ...currentEvent,
          myRsvp: sameChild ? response : currentEvent.myRsvp,
          myRsvpNote: sameChild ? note : currentEvent.myRsvpNote,
          rsvpSummary: summary || currentEvent.rsvpSummary
        };
      }));

      const noteOnlySave = previousRsvp === response && previousNote !== note;
      setMessage(noteOnlySave
        ? `${event.childName} availability note saved.`
        : `${event.childName} marked ${response.replace('_', ' ')}.`);
    } catch (submitError: any) {
      setError(submitError?.message || 'Unable to submit availability.');
    } finally {
      setSubmitting(null);
    }
  };

  return {
    canSubmit,
    submitting,
    message,
    error,
    submit
  };
}
