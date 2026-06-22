import {
  getScheduleAssignmentStatus,
  isScheduleAssignmentClaimedByUser,
  isScheduleAssignmentOpen,
  type ScheduleAssignment
} from '../../lib/scheduleLogic';

export function AssignmentCard({ assignment, userId, busy, disabled, onClaim, onRelease }: {
  assignment: ScheduleAssignment;
  userId: string;
  busy: boolean;
  disabled: boolean;
  onClaim: () => void | Promise<void>;
  onRelease: () => void | Promise<void>;
}) {
  const role = String(assignment.role || 'Assignment').trim();
  const myOwn = isScheduleAssignmentClaimedByUser(assignment, userId);
  const open = isScheduleAssignmentOpen(assignment);
  const status = getScheduleAssignmentStatus(assignment, userId);

  return (
    <article className={`rounded-xl border p-3 ${myOwn ? 'border-emerald-200 bg-emerald-50' : open ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-black text-gray-950">{role}</div>
          <div className={`mt-1 text-xs font-black ${myOwn ? 'text-emerald-700' : open ? 'text-amber-800' : 'text-gray-600'}`}>
            {assignment.claimable ? status : `${role}: ${status}`}
          </div>
          {assignment.claimable ? (
            <div className="mt-1 text-[11px] font-semibold text-gray-500">Parent sign-up slot</div>
          ) : null}
        </div>
        {myOwn ? (
          <button
            type="button"
            className="min-h-8 flex-none rounded-full border border-emerald-200 bg-white px-3 text-xs font-black text-emerald-700"
            onClick={onRelease}
            disabled={disabled}
          >
            {busy ? 'Releasing' : 'Release'}
          </button>
        ) : open ? (
          <button
            type="button"
            className="min-h-8 flex-none rounded-full border border-amber-200 bg-white px-3 text-xs font-black text-amber-800"
            onClick={onClaim}
            disabled={disabled}
          >
            {busy ? 'Signing up' : 'Sign up'}
          </button>
        ) : null}
      </div>
    </article>
  );
}
