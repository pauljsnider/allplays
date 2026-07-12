import {
  getScheduleAssignmentStatus,
  isScheduleAssignmentClaimedByUser,
  isScheduleAssignmentOpen,
  type ScheduleAssignment
} from '../../lib/scheduleLogic';
import { Pencil, Trash2 } from 'lucide-react';

export function AssignmentCard({ assignment, userId, busy, disabled, canManage = false, onClaim, onRelease, onEdit, onRemove }: {
  assignment: ScheduleAssignment;
  userId: string;
  busy: boolean;
  disabled: boolean;
  canManage?: boolean;
  onClaim: () => void | Promise<void>;
  onRelease: () => void | Promise<void>;
  onEdit?: () => void;
  onRemove?: () => void | Promise<void>;
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
        <div className="flex flex-none flex-wrap items-center justify-end gap-2">
          {canManage ? (
            <>
              <button
                type="button"
                className="inline-flex min-h-8 items-center gap-1 rounded-full border border-gray-200 bg-white px-3 text-xs font-black text-gray-700 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
                onClick={onEdit}
                disabled={disabled}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Edit
              </button>
              <button
                type="button"
                className="inline-flex min-h-8 items-center gap-1 rounded-full border border-rose-200 bg-white px-3 text-xs font-black text-rose-700 transition hover:border-rose-300 hover:bg-rose-50"
                onClick={onRemove}
                disabled={disabled}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Remove
              </button>
            </>
          ) : null}
          {myOwn ? (
            <button
              type="button"
              className="min-h-8 rounded-full border border-emerald-200 bg-white px-3 text-xs font-black text-emerald-700"
              onClick={onRelease}
              disabled={disabled}
            >
              {busy ? 'Releasing' : 'Release'}
            </button>
          ) : open ? (
            <button
              type="button"
              className="min-h-8 rounded-full border border-amber-200 bg-white px-3 text-xs font-black text-amber-800"
              onClick={onClaim}
              disabled={disabled}
            >
              {busy ? 'Signing up' : 'Sign up'}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
