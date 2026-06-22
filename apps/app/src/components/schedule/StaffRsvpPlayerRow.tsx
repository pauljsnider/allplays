import {
  rsvpBadgeClasses,
  rsvpLabels
} from './AvailabilityPanels';
import type { StaffScheduleRsvpRow } from '../../lib/scheduleService';
import type { RsvpResponse } from '../../lib/scheduleLogic';

type StaffRsvpOverrideStatus = {
  tone: 'success' | 'error';
  playerId: string;
  message: string;
};

export function StaffRsvpPlayerRow({ eventLocked, player, submitting, status, onOverride }: {
  eventLocked: boolean;
  player: StaffScheduleRsvpRow;
  submitting: boolean;
  status: StaffRsvpOverrideStatus | null;
  onOverride: (player: StaffScheduleRsvpRow, response: Exclude<RsvpResponse, 'not_responded'>) => Promise<void>;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3" data-testid={`staff-rsvp-row-${player.playerId}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-black text-gray-950">{player.playerNumber ? `#${player.playerNumber} ` : ''}{player.playerName}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.04em] ${rsvpBadgeClasses[player.response]}`}>
              {rsvpLabels[player.response]}
            </span>
            {player.note ? <span className="text-xs font-semibold text-gray-500">{player.note}</span> : null}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5 sm:min-w-[220px]">
          {(['going', 'maybe', 'not_going'] as const).map((response) => (
            <button
              key={response}
              type="button"
              className={`min-h-8 rounded-full border px-2 text-[11px] font-black transition ${player.response === response ? rsvpBadgeClasses[response] : 'border-gray-200 bg-white text-gray-600 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700'}`}
              disabled={submitting || eventLocked}
              onClick={() => onOverride(player, response)}
            >
              {submitting && player.response !== response ? 'Saving' : rsvpLabels[response]}
            </button>
          ))}
        </div>
      </div>
      {status ? <div className={`mt-2 text-xs font-bold ${status.tone === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{status.message}</div> : null}
    </div>
  );
}
