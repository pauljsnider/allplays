import { useState } from 'react';
import { toAppServiceError } from '../../lib/appErrors';
import { submitParentScheduleRsvp } from '../../lib/scheduleService';
import { useAsyncOperation } from '../../lib/useAsyncOperation';
import { normalizeRsvpResponse, type RsvpResponse } from '../../lib/scheduleLogic';
import { useScheduleEventDetailContext } from '../../pages/schedule/ScheduleEventDetailContext';

function getRsvpErrorMessage(error: unknown) {
  const mappedError = toAppServiceError(error, 'Unable to submit availability.');
  if (mappedError.type === 'network') return 'Unable to submit availability while offline. Check your connection and try again.';
  if (mappedError.type === 'permission') return 'You do not have permission to update availability for this event.';
  if (mappedError.type === 'not_found') return 'This event is no longer available. Refresh the page and try again.';
  if (mappedError.type === 'validation') return mappedError.message;
  return mappedError.message || 'Unable to submit availability.';
}

export function useScheduleEventRsvp({ availabilityNote }: { availabilityNote: string }) {
  const { auth, event, updateEvents } = useScheduleEventDetailContext();
  const [submitting, setSubmitting] = useState<RsvpResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { error, run } = useAsyncOperation();

  const canSubmit = Boolean(event.isDbGame && !event.isCancelled && !event.availabilityLocked);

  const submit = async (response: Exclude<RsvpResponse, 'not_responded'>) => {
    if (!auth.user || !canSubmit) return;

    setSubmitting(response);
    setMessage(null);

    await run(async () => {
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
    }, {
      getErrorMessage: getRsvpErrorMessage,
      onFinally: () => setSubmitting(null),
      rethrow: false
    });
  };

  return {
    canSubmit,
    submitting,
    message,
    error,
    submit
  };
}
