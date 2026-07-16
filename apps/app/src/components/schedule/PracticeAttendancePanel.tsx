import type { PracticeAttendancePlayer, StaffPracticeAttendance } from '../../lib/scheduleService';

type PracticeAttendanceStatus = 'present' | 'late' | 'absent';

interface PracticeAttendancePanelProps {
  attendance: StaffPracticeAttendance | null;
  loading: boolean;
  saving: boolean;
  savingPlayerId: string | null;
  onSelectStatus: (player: PracticeAttendancePlayer, status: PracticeAttendanceStatus) => Promise<void>;
}

export function PracticeAttendancePanel({ attendance, loading, saving, savingPlayerId, onSelectStatus }: PracticeAttendancePanelProps) {
  if (loading && !attendance) {
    return <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">Loading practice attendance...</div>;
  }
  if (!attendance) return null;

  return (
    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-amber-700">Practice attendance</div>
          <div className="mt-1 text-sm font-black text-gray-950">Mark each player present, late, or absent.</div>
        </div>
        <span className="inline-flex min-h-8 items-center rounded-full border border-amber-200 bg-white px-3 text-xs font-black text-amber-900">
          {attendance.checkedInCount}/{attendance.rosterSize} checked in
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {attendance.players.map((player) => {
          const busy = savingPlayerId === player.playerId;
          return (
            <div key={player.playerId} className="rounded-xl border border-amber-100 bg-white p-3" data-testid={`practice-attendance-row-${player.playerId}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-black text-gray-950">{player.playerNumber ? `#${player.playerNumber} ` : ''}{player.displayName}</div>
                  <div className="mt-1 text-xs font-bold text-gray-500">{player.status === 'not_marked' ? 'Not marked' : player.status === 'absent' ? 'Absent' : player.status === 'late' ? 'Late' : 'Present'}</div>
                </div>
                <div className="grid grid-cols-3 gap-1.5 sm:min-w-[220px]">
                  {(['present', 'late', 'absent'] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={`min-h-8 rounded-full border px-2 text-[11px] font-black transition ${player.status === status ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-gray-200 bg-white text-gray-600 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-900'}`}
                      disabled={saving}
                      onClick={() => onSelectStatus(player, status)}
                    >
                      {busy && player.status !== status ? 'Saving' : status === 'present' ? 'Present' : status === 'late' ? 'Late' : 'Absent'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
