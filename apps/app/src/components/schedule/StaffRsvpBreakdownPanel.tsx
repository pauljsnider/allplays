import { StaffRsvpPlayerRow } from './StaffRsvpPlayerRow';
import {
  formatRsvpSummary,
  rsvpBadgeClasses,
  rsvpLabels
} from './AvailabilityPanels';
import { useScheduleEventDetailContext } from '../../pages/schedule/ScheduleEventDetailContext';
import type { StaffRsvpOverrideStatus } from '../../hooks/schedule/useStaffRsvpBreakdown';
import type { StaffScheduleRsvpBreakdown, StaffScheduleRsvpRow } from '../../lib/scheduleService';
import type { RsvpResponse } from '../../lib/scheduleLogic';

export function StaffRsvpBreakdownPanel({ breakdown, loading, error, submittingPlayerId, status, onOverride }: {
  breakdown: StaffScheduleRsvpBreakdown | null;
  loading: boolean;
  error: string | null;
  submittingPlayerId: string | null;
  status: StaffRsvpOverrideStatus | null;
  onOverride: (player: StaffScheduleRsvpRow, response: Exclude<RsvpResponse, 'not_responded'>) => Promise<void>;
}) {
  const { event } = useScheduleEventDetailContext();

  if (!event.isTeamAdmin || !event.isDbGame) return null;
  if (loading && !breakdown) {
    return <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3 text-sm font-semibold text-gray-600">Loading team RSVP breakdown…</div>;
  }
  if (error && !breakdown) {
    return <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>;
  }
  if (!breakdown) return null;

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-gray-950">Staff RSVP overrides</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-600">Review every player, including no response, and update availability inline.</div>
        </div>
        <span className="inline-flex min-h-8 items-center rounded-full border border-primary-100 bg-primary-50 px-3 text-xs font-black text-primary-700">
          {formatRsvpSummary(breakdown.counts)}
        </span>
      </div>
      <div className="mt-3 space-y-3">
        {(['not_responded', 'going', 'maybe', 'not_going'] as const).map((responseKey) => {
          const rows = breakdown.grouped[responseKey];
          if (!rows.length) return null;
          return (
            <div key={responseKey}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">{rsvpLabels[responseKey]}</div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.04em] ${rsvpBadgeClasses[responseKey]}`}>
                  {rows.length}
                </span>
              </div>
              <div className="space-y-2">
                {rows.map((player) => {
                  const inlineStatus = status?.playerId === player.playerId ? status : null;
                  const busy = submittingPlayerId === player.playerId;
                  return (
                    <StaffRsvpPlayerRow
                      key={player.playerId}
                      eventLocked={event.isCancelled || event.availabilityLocked === true}
                      player={player}
                      submitting={busy}
                      status={inlineStatus}
                      onOverride={onOverride}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {error && breakdown ? <div className="mt-3 text-xs font-bold text-rose-700">{error}</div> : null}
      {event.isCancelled ? <div className="mt-3 text-xs font-semibold text-gray-500">Cancelled events cannot be updated.</div> : null}
      {event.availabilityLocked ? <div className="mt-3 text-xs font-semibold text-amber-700">Availability is locked for this event.</div> : null}
    </div>
  );
}
