import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardCheck, RefreshCw } from 'lucide-react';
import {
  claimParentScheduleAssignmentSlot,
  loadParentScheduleAssignments,
  releaseParentScheduleAssignmentClaim
} from '../../lib/scheduleService';
import {
  isScheduleAssignmentOpen,
  type ScheduleAssignment
} from '../../lib/scheduleLogic';
import { useScheduleEventDetailContext } from '../../pages/schedule/ScheduleEventDetailContext';
import { AssignmentCard } from './AssignmentCard';

function cloneScheduleAssignments(assignments: ScheduleAssignment[] = []) {
  return assignments.map((assignment) => ({
    ...assignment,
    claim: assignment.claim ? { ...assignment.claim } : null
  }));
}

export function AssignmentsSection() {
  const { auth, event, updateEvents } = useScheduleEventDetailContext();
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>(() => cloneScheduleAssignments(event.assignments));
  const [loading, setLoading] = useState(true);
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [assignmentStatus, setAssignmentStatus] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  const handleAssignmentsChanged = useCallback((nextAssignments: ScheduleAssignment[]) => {
    updateEvents((current) => current.map((entry) => (
      entry.teamId === event.teamId && entry.id === event.id
        ? { ...entry, assignments: nextAssignments }
        : entry
    )));
  }, [event.id, event.teamId, updateEvents]);

  const refreshAssignments = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setAssignmentError(null);
    try {
      const loaded = cloneScheduleAssignments(await loadParentScheduleAssignments(event));
      setAssignments(loaded);
      handleAssignmentsChanged(loaded);
    } catch (error: any) {
      setAssignmentError(error?.message || 'Unable to load assignments.');
      setAssignments(cloneScheduleAssignments(event.assignments));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [event.id, event.isCancelled, event.isDbGame, event.teamId, handleAssignmentsChanged]);

  useEffect(() => {
    setAssignmentStatus(null);
    refreshAssignments();
  }, [refreshAssignments]);

  const runAssignmentAction = async (role: string, action: () => Promise<void>, successMessage: string) => {
    setBusyRole(role);
    setAssignmentStatus(null);
    setAssignmentError(null);
    try {
      await action();
      await refreshAssignments(false);
      setAssignmentStatus(successMessage);
    } catch (error: any) {
      setAssignmentError(error?.message || 'Unable to update assignment.');
    } finally {
      setBusyRole(null);
    }
  };

  const claimSlot = (assignment: ScheduleAssignment) => {
    const role = String(assignment.role || '').trim();
    if (!auth.user || !role) return;
    return runAssignmentAction(
      role,
      () => claimParentScheduleAssignmentSlot(event, auth.user!, role),
      `${role} claimed.`
    );
  };

  const releaseSlot = (assignment: ScheduleAssignment) => {
    const role = String(assignment.role || '').trim();
    if (!role) return;
    return runAssignmentAction(
      role,
      () => releaseParentScheduleAssignmentClaim(event, role),
      `${role} released.`
    );
  };

  const openCount = assignments.filter(isScheduleAssignmentOpen).length;

  return (
    <section className="app-card overflow-hidden p-0">
      <div className="border-b border-gray-100 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-black text-primary-800">
              <ClipboardCheck className="h-5 w-5 text-primary-600" aria-hidden="true" />
              Assignments
            </div>
            <h2 className="mt-1 app-section-title">Assignments</h2>
            <div className="mt-0.5 text-xs font-semibold text-gray-500">
              {assignments.length ? `${assignments.length} posted · ${openCount} open` : 'None posted'}
            </div>
          </div>
          {loading ? <RefreshCw className="mt-1 h-4 w-4 animate-spin text-primary-600" aria-hidden="true" /> : null}
        </div>
      </div>

      <div className="p-3 sm:p-4">
        {assignmentStatus ? <Status tone="success" message={assignmentStatus} /> : null}
        {assignmentError ? <div className="mt-2"><Status tone="error" message={assignmentError} /></div> : null}
        <div className="mt-2 space-y-2">
          {assignments.length ? assignments.map((assignment, index) => (
            <AssignmentCard
              key={`${assignment.role || 'assignment'}-${index}`}
              assignment={assignment}
              userId={auth.user?.uid || ''}
              busy={busyRole === String(assignment.role || '').trim()}
              disabled={Boolean(busyRole) || !event.isDbGame || event.isCancelled}
              onClaim={() => claimSlot(assignment)}
              onRelease={() => releaseSlot(assignment)}
            />
          )) : (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">None posted</div>
          )}
        </div>
        {!event.isDbGame || event.isCancelled ? (
          <div className="mt-2 text-xs font-semibold text-gray-500">Assignment sign-up is available for active tracked schedule events.</div>
        ) : null}
      </div>
    </section>
  );
}

function Status({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  const isError = tone === 'error';
  return (
    <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold ${isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      {isError ? <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />}
      {message}
    </div>
  );
}
