import { useState } from 'react';
import { toAppServiceError } from '../../lib/appErrors';
import { submitParentScheduleRsvp } from '../../lib/scheduleService';
import { useAsyncOperation } from '../../lib/useAsyncOperation';
import { normalizeRsvpResponse, type ParentScheduleEvent, type RsvpResponse } from '../../lib/scheduleLogic';
import { UX_TIMING, startInteractionTimer } from '../../lib/uxTiming';
import { useScheduleEventDetailContext } from '../../pages/schedule/ScheduleEventDetailContext';

function getRsvpErrorMessage(error: unknown) {
  const mappedError = toAppServiceError(error, 'Unable to submit availability.');
  if (mappedError.type === 'network') return 'Unable to submit availability while offline. Check your connection and try again.';
  if (mappedError.type === 'permission') return 'You do not have permission to update availability for this event.';
  if (mappedError.type === 'not_found') return 'This event is no longer available. Refresh the page and try again.';
  if (mappedError.type === 'validation') return mappedError.message;
  return mappedError.message || 'Unable to submit availability.';
}

function buildOptimisticRsvpSummary(summary: ParentScheduleEvent['rsvpSummary'], previousRsvp: RsvpResponse, nextRsvp: Exclude<RsvpResponse, 'not_responded'>) {
  if (!summary) return summary;
  const nextSummary = { ...summary } as Record<string, number>;
  const decrementKey = previousRsvp === 'not_going' ? 'notGoing' : previousRsvp === 'not_responded' ? 'notResponded' : previousRsvp;
  const incrementKey = nextRsvp === 'not_going' ? 'notGoing' : nextRsvp;
  if (decrementKey && typeof nextSummary[decrementKey] === 'number') {
    nextSummary[decrementKey] = Math.max(0, nextSummary[decrementKey] - 1);
  }
  if (incrementKey && typeof nextSummary[incrementKey] === 'number') {
    nextSummary[incrementKey] += 1;
  }
  return nextSummary as ParentScheduleEvent['rsvpSummary'];
}

function waitForVisibleState() {
  return new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

export function useScheduleEventRsvp({ availabilityNote }: { availabilityNote: string }) {
  const { auth, event, updateEvents } = useScheduleEventDetailContext();
  const [submitting, setSubmitting] = useState<RsvpResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { error, run } = useAsyncOperation();

  const canSubmit = Boolean(event.isDbGame && !event.isCancelled && !event.availabilityLocked);

  const submit = async (response: Exclude<RsvpResponse, 'not_responded'>) => {
    const currentUser = auth.user;
    if (!currentUser || !canSubmit) return;

    const interaction = startInteractionTimer(UX_TIMING.rsvpTap, { response });
    const previousRsvp = normalizeRsvpResponse(event.myRsvp);
    const previousNote = String(event.myRsvpNote || '').trim();
    const note = String(availabilityNote || '').trim();
    const optimisticSummary = buildOptimisticRsvpSummary(event.rsvpSummary, previousRsvp, response);

    setSubmitting(response);
    setMessage(null);
    updateEvents((current) => current.map((currentEvent) => {
      if (currentEvent.teamId !== event.teamId || currentEvent.id !== event.id) return currentEvent;
      const sameChild = currentEvent.childId === event.childId;
      return {
        ...currentEvent,
        myRsvp: sameChild ? response : currentEvent.myRsvp,
        myRsvpNote: sameChild ? note : currentEvent.myRsvpNote,
        rsvpSummary: optimisticSummary || currentEvent.rsvpSummary
      };
    }));

    const result = await run(async () => {
      const summary = await submitParentScheduleRsvp(event, currentUser, response, note);

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
      return summary;
    }, {
      getErrorMessage: getRsvpErrorMessage,
      onError: () => {
        updateEvents((current) => current.map((currentEvent) => {
          if (currentEvent.teamId !== event.teamId || currentEvent.id !== event.id) return currentEvent;
          const sameChild = currentEvent.childId === event.childId;
          const matchesFailedOptimisticState = sameChild
            && normalizeRsvpResponse(currentEvent.myRsvp) === response
            && String(currentEvent.myRsvpNote || '').trim() === note;
          if (!matchesFailedOptimisticState) return currentEvent;
          return {
            ...currentEvent,
            myRsvp: previousRsvp,
            myRsvpNote: previousNote,
            rsvpSummary: event.rsvpSummary || currentEvent.rsvpSummary
          };
        }));
      },
      onFinally: () => setSubmitting(null),
      rethrow: false
    });

    await waitForVisibleState();
    if (result) {
      interaction.end();
      return;
    }
    interaction.end({ error: 'RSVP submit failed' });
  };

  return {
    canSubmit,
    submitting,
    message,
    error,
    submit
  };
}
