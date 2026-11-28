import { useState } from 'react';
import { Modal } from '../Modal';
import { formatEventDateLabel, getScheduleTitle, type ParentScheduleEvent } from '../../lib/scheduleLogic';
import {
  cancelPracticeOccurrenceForApp,
  deleteScheduledGameForApp,
  deleteScheduledPracticeForApp,
  deleteScheduledPracticeSeriesForApp,
  type DeleteScheduledEventResult
} from '../../lib/scheduleService';
import type { AuthState } from '../../lib/types';

/**
 * Client-side mirror of the delete permission gates in scheduleService.ts.
 * The service re-checks every gate, so this only decides visibility.
 */
export function canDeleteScheduledEvent(event: ParentScheduleEvent, user: AuthState['user']) {
  if (!user?.uid || !event?.isDbGame) return false;
  if (event.type === 'game') {
    const isDiamondGame = event.trackingEngine === 'diamond-v2';
    return event.canUpdateScore === true && (!isDiamondGame || event.isTeamAdmin === true);
  }
  if (event.type === 'practice') {
    return event.isTeamAdmin === true;
  }
  return false;
}

export type ScheduleEventDeleteScope = 'game' | 'practice' | 'practice-occurrence' | 'practice-series';

/**
 * Delete control for a scheduled game or practice (#5314). This is a hard
 * delete — the document is permanently removed — unlike Cancel, which only
 * marks it cancelled and leaves it listed. Recurring practices offer the
 * legacy occurrence-vs-series choice: delete just this date (soft-cancel via
 * exDates) or delete the whole series permanently.
 */
export function EventDeleteControl({ event, auth, onDeleted, buttonClassName }: {
  event: ParentScheduleEvent;
  auth: AuthState;
  onDeleted?: (result: DeleteScheduledEventResult | { deleted: true; scope: 'practice-occurrence' }) => void;
  buttonClassName?: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canDeleteScheduledEvent(event, auth.user)) return null;

  const isRecurringPractice = event.type === 'practice' && event.id.includes('__');
  const eventLabel = event.type === 'game'
    ? `the game vs ${event.opponent || 'TBD'}`
    : getScheduleTitle(event);
  const dateLabel = formatEventDateLabel(event.date);

  const runDelete = async (scope: ScheduleEventDeleteScope) => {
    if (!auth.user) return;
    setDeleting(true);
    setError(null);
    try {
      let result: DeleteScheduledEventResult | { deleted: true; scope: 'practice-occurrence' };
      if (scope === 'game') {
        result = await deleteScheduledGameForApp(event, auth.user);
      } else if (scope === 'practice') {
        result = await deleteScheduledPracticeForApp(event, auth.user);
      } else if (scope === 'practice-series') {
        result = await deleteScheduledPracticeSeriesForApp(event, auth.user);
      } else {
        await cancelPracticeOccurrenceForApp(event, auth.user);
        result = { deleted: true, scope: 'practice-occurrence' };
      }
      setConfirmOpen(false);
      onDeleted?.(result);
    } catch (deleteError: any) {
      setError(deleteError?.message || 'Unable to delete this event.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={buttonClassName || 'secondary-button !border-rose-200 !text-rose-700 hover:!bg-rose-50'}
        disabled={deleting}
        onClick={() => { setError(null); setConfirmOpen(true); }}
      >
        {deleting ? 'Deleting…' : event.type === 'game' ? 'Delete game' : 'Delete practice'}
      </button>
      {error ? <div className="mt-2 text-xs font-bold text-rose-700">{error}</div> : null}
      {confirmOpen ? (
        <Modal onClose={() => { if (!deleting) setConfirmOpen(false); }} ariaLabelledBy="delete-scheduled-event-title">
          <section className="app-card w-full max-w-md p-5">
            <h2 id="delete-scheduled-event-title" className="text-xl font-black text-gray-950">
              {event.type === 'game' ? 'Delete this game?' : 'Delete this practice?'}
            </h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
              {event.type === 'game'
                ? `This permanently deletes ${eventLabel} on ${dateLabel}. It will be removed from the schedule, not just marked cancelled.${event.sharedScheduleOpponentTeamId ? ' The linked game on the other team will also be deleted.' : ''}`
                : isRecurringPractice
                  ? `Choose what to delete for ${eventLabel} on ${dateLabel}.`
                  : `This permanently deletes ${eventLabel} on ${dateLabel}. It will be removed from the schedule.`}
            </p>
            {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</div> : null}
            <div className="mt-5 grid gap-2">
              {event.type === 'game' ? (
                <button type="button" className="min-h-11 rounded-full bg-rose-600 px-4 text-sm font-black text-white transition hover:bg-rose-700 disabled:opacity-60" disabled={deleting} onClick={() => void runDelete('game')}>
                  {deleting ? 'Deleting…' : 'Delete game permanently'}
                </button>
              ) : isRecurringPractice ? (
                <>
                  <button type="button" className="min-h-11 rounded-full bg-rose-600 px-4 text-sm font-black text-white transition hover:bg-rose-700 disabled:opacity-60" disabled={deleting} onClick={() => void runDelete('practice-occurrence')}>
                    {deleting ? 'Deleting…' : 'Delete only this date'}
                  </button>
                  <button type="button" className="min-h-11 rounded-full bg-rose-600 px-4 text-sm font-black text-white transition hover:bg-rose-700 disabled:opacity-60" disabled={deleting} onClick={() => void runDelete('practice-series')}>
                    {deleting ? 'Deleting…' : 'Delete the entire series'}
                  </button>
                </>
              ) : (
                <button type="button" className="min-h-11 rounded-full bg-rose-600 px-4 text-sm font-black text-white transition hover:bg-rose-700 disabled:opacity-60" disabled={deleting} onClick={() => void runDelete('practice')}>
                  {deleting ? 'Deleting…' : 'Delete practice permanently'}
                </button>
              )}
              <button type="button" className="ghost-button justify-center" disabled={deleting} onClick={() => setConfirmOpen(false)}>
                Keep it
              </button>
            </div>
          </section>
        </Modal>
      ) : null}
    </>
  );
}
