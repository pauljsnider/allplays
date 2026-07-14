import { useState } from 'react';
import { toAppServiceError } from '../../lib/appErrors';
import { submitParentScheduleRsvp, submitParentScheduleRsvpForChildren } from '../../lib/scheduleService';
import { useAsyncOperation } from '../../lib/useAsyncOperation';
import { canSubmitScheduleEventRsvp, normalizeRsvpResponse, type ParentScheduleEvent, type RsvpResponse } from '../../lib/scheduleLogic';
import { UX_TIMING, startInteractionTimer } from '../../lib/uxTiming';
import { useScheduleEventDetailContext } from '../../pages/schedule/ScheduleEventDetailContext';

function getRsvpErrorMessage(error: unknown) {
  const mappedError = toAppServiceError(error, 'Unable to submit availability.');
  if (mappedError.type === 'network') {
    // A timeout is classified as "network", but it usually isn't an offline
    // device — the request just took too long (and the RSVP may have saved).
    // Use a message that doesn't wrongly claim the user is offline.
    if (/timed out|timeout/i.test(mappedError.message)) {
      return 'Saving your availability is taking longer than expected. Refresh to check whether it saved.';
    }
    return 'Unable to submit availability while offline. Check your connection and try again.';
  }
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

export function useScheduleEventRsvp({ availabilityNote, applyToAllChildren = false, sharedNoteExplicitlyChosen = false }: {
  availabilityNote: string;
  applyToAllChildren?: boolean;
  sharedNoteExplicitlyChosen?: boolean;
}) {
  const { auth, event, childEvents, updateEvents } = useScheduleEventDetailContext();
  const [submitting, setSubmitting] = useState<RsvpResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { error, run } = useAsyncOperation();

  const matchingChildEvents = childEvents.filter((childEvent) => (
    childEvent.teamId === event.teamId && childEvent.id === event.id && Boolean(childEvent.childId) && childEvent.isLinkedParentChild === true
  ));
  const targetEvents = applyToAllChildren && event.isLinkedParentChild === true ? matchingChildEvents : [event];
  const canSubmit = targetEvents.length > 0 && targetEvents.every(canSubmitScheduleEventRsvp);
  const savedNotesDiffer = new Set(targetEvents.map((targetEvent) => String(targetEvent.myRsvpNote || '').trim())).size > 1;
  const requiresSharedNoteChoice = applyToAllChildren && targetEvents.length > 1 && savedNotesDiffer && !sharedNoteExplicitlyChosen;

  const submit = async (response: Exclude<RsvpResponse, 'not_responded'>) => {
    const currentUser = auth.user;
    if (!currentUser || !canSubmit || requiresSharedNoteChoice) return;

    const interaction = startInteractionTimer(UX_TIMING.rsvpTap, { response });
    const previousStateByChildId = new Map(targetEvents.map((targetEvent) => [targetEvent.childId, {
      rsvp: normalizeRsvpResponse(targetEvent.myRsvp),
      note: String(targetEvent.myRsvpNote || '').trim(),
      summary: targetEvent.rsvpSummary
    }]));
    const note = String(availabilityNote || '').trim();
    const targetChildIds = new Set(targetEvents.map((targetEvent) => targetEvent.childId));
    const optimisticSummary = targetEvents.reduce(
      (summary, targetEvent) => buildOptimisticRsvpSummary(summary, normalizeRsvpResponse(targetEvent.myRsvp), response),
      event.rsvpSummary
    );

    setSubmitting(response);
    setMessage(null);
    updateEvents((current) => current.map((currentEvent) => {
      if (currentEvent.teamId !== event.teamId || currentEvent.id !== event.id) return currentEvent;
      const sameChild = targetChildIds.has(currentEvent.childId);
      return {
        ...currentEvent,
        myRsvp: sameChild ? response : currentEvent.myRsvp,
        myRsvpNote: sameChild ? note : currentEvent.myRsvpNote,
        rsvpSummary: optimisticSummary || currentEvent.rsvpSummary
      };
    }));

    const result = await run(async () => {
      const summary = applyToAllChildren && targetEvents.length > 1
        ? await submitParentScheduleRsvpForChildren(targetEvents, currentUser, response, note)
        : await submitParentScheduleRsvp(event, currentUser, response, note);

      updateEvents((current) => current.map((currentEvent) => {
        if (currentEvent.teamId !== event.teamId || currentEvent.id !== event.id) return currentEvent;
        const sameChild = targetChildIds.has(currentEvent.childId);
        return {
          ...currentEvent,
          myRsvp: sameChild ? response : currentEvent.myRsvp,
          myRsvpNote: sameChild ? note : currentEvent.myRsvpNote,
          rsvpSummary: summary || currentEvent.rsvpSummary
        };
      }));

      const noteOnlySave = targetEvents.every((targetEvent) => normalizeRsvpResponse(targetEvent.myRsvp) === response)
        && targetEvents.some((targetEvent) => String(targetEvent.myRsvpNote || '').trim() !== note);
      setMessage(applyToAllChildren && targetEvents.length > 1
        ? noteOnlySave
          ? 'Family availability note saved.'
          : `${targetEvents.length} children marked ${response.replace('_', ' ')}.`
        : noteOnlySave
          ? `${event.childName} availability note saved.`
          : `${event.childName} marked ${response.replace('_', ' ')}.`);
      return { ok: true as const };
    }, {
      getErrorMessage: getRsvpErrorMessage,
      onError: () => {
        updateEvents((current) => current.map((currentEvent) => {
          if (currentEvent.teamId !== event.teamId || currentEvent.id !== event.id) return currentEvent;
          const sameChild = targetChildIds.has(currentEvent.childId);
          const previousState = previousStateByChildId.get(currentEvent.childId);
          const matchesFailedOptimisticState = sameChild
            && normalizeRsvpResponse(currentEvent.myRsvp) === response
            && String(currentEvent.myRsvpNote || '').trim() === note;
          if (!matchesFailedOptimisticState || !previousState) return currentEvent;
          return {
            ...currentEvent,
            myRsvp: previousState.rsvp,
            myRsvpNote: previousState.note,
            rsvpSummary: previousState.summary || currentEvent.rsvpSummary
          };
        }));
      },
      onFinally: () => setSubmitting(null),
      rethrow: false
    });

    await waitForVisibleState();
    if (result?.ok) {
      interaction.end();
      return;
    }
    interaction.end({ error: 'RSVP submit failed' });
  };

  return {
    canSubmit,
    requiresSharedNoteChoice,
    submitting,
    message,
    error,
    submit
  };
}
