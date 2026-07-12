import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, ClipboardCheck, Plus, RefreshCw, X } from 'lucide-react';
import {
  claimParentScheduleAssignmentSlot,
  createScheduleAssignment,
  loadParentScheduleAssignments,
  releaseParentScheduleAssignmentClaim,
  removeScheduleAssignment,
  updateScheduleAssignment,
  type ScheduleAssignmentInput
} from '../../lib/scheduleService';
import {
  isScheduleAssignmentClaimedByUser,
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

const assignmentFormBusyKey = '__assignment-form__';

function createEmptyAssignmentForm(): ScheduleAssignmentInput {
  return {
    role: '',
    value: '',
    claimable: true
  };
}

function createAssignmentFormFromAssignment(assignment: ScheduleAssignment): ScheduleAssignmentInput {
  return {
    role: String(assignment.role || '').trim(),
    value: String(assignment.value || '').trim(),
    claimable: assignment.claimable === true
  };
}

export function AssignmentsSection() {
  const { auth, event, updateEvents } = useScheduleEventDetailContext();
  const eventRef = useRef(event);
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>(() => cloneScheduleAssignments(event.assignments));
  const [loading, setLoading] = useState(true);
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [assignmentStatus, setAssignmentStatus] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [showFilledAssignments, setShowFilledAssignments] = useState(false);
  const [assignmentForm, setAssignmentForm] = useState<ScheduleAssignmentInput>(() => createEmptyAssignmentForm());
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);

  const handleAssignmentsChanged = useCallback((nextAssignments: ScheduleAssignment[]) => {
    updateEvents((current) => current.map((entry) => (
      entry.teamId === event.teamId && entry.id === event.id
        ? { ...entry, assignments: nextAssignments }
        : entry
    )));
  }, [event.id, event.teamId, updateEvents]);

  const syncAssignments = useCallback((nextAssignments: ScheduleAssignment[]) => {
    const cloned = cloneScheduleAssignments(nextAssignments);
    setAssignments(cloned);
    handleAssignmentsChanged(cloned);
    return cloned;
  }, [handleAssignmentsChanged]);

  useEffect(() => {
    eventRef.current = event;
  });

  const refreshAssignments = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setAssignmentError(null);
    const event = eventRef.current;
    try {
      syncAssignments(await loadParentScheduleAssignments(event));
    } catch (error: any) {
      setAssignmentError(error?.message || 'Unable to load assignments.');
      setAssignments(cloneScheduleAssignments(event.assignments));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [syncAssignments]);

  useEffect(() => {
    setAssignmentStatus(null);
    refreshAssignments();
  }, [refreshAssignments]);

  const runAssignmentAction = async (role: string, action: () => Promise<void>, successMessage: string, options: { refresh?: boolean } = {}) => {
    setBusyRole(role);
    setAssignmentStatus(null);
    setAssignmentError(null);
    try {
      await action();
      if (options.refresh !== false) {
        await refreshAssignments(false);
      }
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

  const resetAssignmentForm = () => {
    setAssignmentForm(createEmptyAssignmentForm());
    setEditingRole(null);
    setShowAssignmentForm(false);
  };

  const startCreateAssignment = () => {
    setAssignmentStatus(null);
    setAssignmentError(null);
    setAssignmentForm(createEmptyAssignmentForm());
    setEditingRole(null);
    setShowAssignmentForm(true);
  };

  const startEditAssignment = (assignment: ScheduleAssignment) => {
    setAssignmentStatus(null);
    setAssignmentError(null);
    setAssignmentForm(createAssignmentFormFromAssignment(assignment));
    setEditingRole(String(assignment.role || '').trim());
    setShowAssignmentForm(true);
  };

  const submitAssignmentForm = (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    const currentUser = auth.user;
    if (!currentUser) return;
    const role = String(assignmentForm.role || '').trim();
    if (!role) {
      setAssignmentError('Role is required.');
      return;
    }
    const isEditing = Boolean(editingRole);
    void runAssignmentAction(
      assignmentFormBusyKey,
      async () => {
        const nextAssignments = isEditing
          ? await updateScheduleAssignment(event, currentUser, editingRole!, assignmentForm)
          : await createScheduleAssignment(event, currentUser, assignmentForm);
        syncAssignments(nextAssignments);
        resetAssignmentForm();
      },
      isEditing ? `${role} updated.` : `${role} added.`,
      { refresh: false }
    );
  };

  const removeAssignment = (assignment: ScheduleAssignment) => {
    const role = String(assignment.role || '').trim();
    const currentUser = auth.user;
    if (!currentUser || !role) return;
    return runAssignmentAction(
      role,
      async () => {
        const nextAssignments = await removeScheduleAssignment(event, currentUser, role);
        syncAssignments(nextAssignments);
        if (editingRole && editingRole === role) resetAssignmentForm();
      },
      `${role} removed.`,
      { refresh: false }
    );
  };

  const openCount = assignments.filter(isScheduleAssignmentOpen).length;
  const userId = auth.user?.uid || '';
  const canManageAssignments = Boolean(auth.user && event.isTeamAdmin && event.isDbGame && !event.isCancelled);
  const formBusy = busyRole === assignmentFormBusyKey;
  const actionableAssignments = assignments.filter((assignment) => (
    isScheduleAssignmentOpen(assignment) || isScheduleAssignmentClaimedByUser(assignment, userId)
  ));
  const filledAssignments = assignments.filter((assignment) => !actionableAssignments.includes(assignment));
  const shouldShowFilledAssignments = !actionableAssignments.length || showFilledAssignments;

  useEffect(() => {
    if (!filledAssignments.length) {
      setShowFilledAssignments(false);
      return;
    }
    if (!actionableAssignments.length) {
      setShowFilledAssignments(true);
    }
  }, [actionableAssignments.length, filledAssignments.length]);

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
          <div className="flex flex-none items-center gap-2">
            {canManageAssignments ? (
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 text-xs font-black text-primary-700 transition hover:border-primary-300 hover:bg-primary-100"
                onClick={startCreateAssignment}
                disabled={Boolean(busyRole)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add assignment
              </button>
            ) : null}
            {loading ? <RefreshCw className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" /> : null}
          </div>
        </div>
      </div>

      <div className="p-3 sm:p-4">
        {assignmentStatus ? <Status tone="success" message={assignmentStatus} /> : null}
        {assignmentError ? <div className="mt-2"><Status tone="error" message={assignmentError} /></div> : null}
        {showAssignmentForm && canManageAssignments ? (
          <div className="mt-2">
            <AssignmentForm
              form={assignmentForm}
              editingRole={editingRole}
              busy={formBusy}
              onChange={setAssignmentForm}
              onSubmit={submitAssignmentForm}
              onCancel={resetAssignmentForm}
            />
          </div>
        ) : null}
        <div className="mt-2 space-y-2">
          {assignments.length ? (
            <>
              {(actionableAssignments.length ? actionableAssignments : filledAssignments).map((assignment, index) => (
                <AssignmentCard
                  key={`${assignment.role || 'assignment'}-${index}`}
                  assignment={assignment}
                  userId={userId}
                  busy={busyRole === String(assignment.role || '').trim()}
                  disabled={Boolean(busyRole) || !event.isDbGame || event.isCancelled}
                  canManage={canManageAssignments}
                  onClaim={() => claimSlot(assignment)}
                  onRelease={() => releaseSlot(assignment)}
                  onEdit={() => startEditAssignment(assignment)}
                  onRemove={() => removeAssignment(assignment)}
                />
              ))}
              {filledAssignments.length && actionableAssignments.length ? (
                <div className="pt-2">
                  <button
                    type="button"
                    className="inline-flex min-h-9 items-center gap-2 rounded-full border border-gray-200 bg-white px-3 text-xs font-black text-gray-700 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
                    aria-expanded={shouldShowFilledAssignments}
                    onClick={() => setShowFilledAssignments((current) => !current)}
                  >
                    {shouldShowFilledAssignments ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                    {shouldShowFilledAssignments ? 'Hide filled assignments' : `Show filled assignments (${filledAssignments.length})`}
                  </button>
                  {shouldShowFilledAssignments ? (
                    <div className="mt-3 space-y-2">
                      {filledAssignments.map((assignment, index) => (
                        <AssignmentCard
                          key={`${assignment.role || 'filled-assignment'}-filled-${index}`}
                          assignment={assignment}
                          userId={userId}
                          busy={busyRole === String(assignment.role || '').trim()}
                          disabled={Boolean(busyRole) || !event.isDbGame || event.isCancelled}
                          canManage={canManageAssignments}
                          onClaim={() => claimSlot(assignment)}
                          onRelease={() => releaseSlot(assignment)}
                          onEdit={() => startEditAssignment(assignment)}
                          onRemove={() => removeAssignment(assignment)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
              <div className="text-sm font-black text-gray-700">No assignments yet</div>
              {canManageAssignments ? (
                <button
                  type="button"
                  className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-full border border-primary-200 bg-white px-3 text-xs font-black text-primary-700 transition hover:border-primary-300 hover:bg-primary-50"
                  onClick={startCreateAssignment}
                  disabled={Boolean(busyRole)}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add assignment
                </button>
              ) : null}
            </div>
          )}
        </div>
        {!event.isDbGame || event.isCancelled ? (
          <div className="mt-2 text-xs font-semibold text-gray-500">Assignments are available for active tracked schedule events.</div>
        ) : null}
      </div>
    </section>
  );
}

function AssignmentForm({
  form,
  editingRole,
  busy,
  onChange,
  onSubmit,
  onCancel
}: {
  form: ScheduleAssignmentInput;
  editingRole: string | null;
  busy: boolean;
  onChange: (form: ScheduleAssignmentInput) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const claimable = form.claimable === true;
  const role = String(form.role || '');
  const value = String(form.value || '');

  return (
    <form
      aria-label={editingRole ? `Edit assignment ${editingRole}` : 'Add assignment'}
      className="rounded-xl border border-primary-100 bg-primary-50/70 p-3"
      onSubmit={onSubmit}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <label className="text-xs font-black uppercase text-gray-500">
          Task
          <input
            type="text"
            className="mt-1 min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
            value={role}
            onChange={(event) => onChange({ ...form, role: event.target.value })}
            disabled={busy}
            placeholder="Snack table"
          />
        </label>
        {!claimable ? (
          <label className="text-xs font-black uppercase text-gray-500">
            Assigned to
            <input
              type="text"
              className="mt-1 min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              value={value}
              onChange={(event) => onChange({ ...form, value: event.target.value })}
              disabled={busy}
              placeholder="Jamie"
            />
          </label>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex min-h-9 items-center gap-2 rounded-full border border-gray-200 bg-white px-3 text-xs font-black text-gray-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            checked={claimable}
            onChange={(event) => onChange({ ...form, claimable: event.target.checked, value: event.target.checked ? '' : form.value })}
            disabled={busy}
          />
          Let parents sign up
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-1 rounded-full border border-gray-200 bg-white px-3 text-xs font-black text-gray-700"
            onClick={onCancel}
            disabled={busy}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button min-h-9 px-4 text-xs"
            disabled={busy || !role.trim()}
          >
            {busy ? 'Saving' : editingRole ? 'Save assignment' : 'Add assignment'}
          </button>
        </div>
      </div>
    </form>
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
