import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, DollarSign, Loader2, RefreshCw, Shield } from 'lucide-react';
import {
  loadTeamFeeManagementModel,
  recordOfflineTeamFeePayment,
  recordTeamFeeBalanceAdjustment,
  type TeamFeeManagementModel,
  type TeamFeeRecipientSummary
} from '../lib/teamFeesService';
import type { AuthState } from '../lib/types';

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function centsToAmount(cents: number) {
  return ((Number(cents) || 0) / 100).toFixed(2);
}

export function TeamFees({ auth }: { auth: AuthState }) {
  const { teamId = '', batchId = '' } = useParams();
  const navigate = useNavigate();
  const [model, setModel] = useState<TeamFeeManagementModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formByRecipient, setFormByRecipient] = useState<Record<string, { paymentAmount: string; paymentDate: string; paymentNote: string; paymentError: string; adjustmentAmount: string; adjustmentReason: string; adjustmentError: string }>>({});

  const selectedBatchId = model?.selectedBatch?.id || '';

  const refresh = async () => {
    if (!teamId) return;
    setLoading(true);
    setError('');
    try {
      const nextModel = await loadTeamFeeManagementModel(teamId, batchId || undefined, auth.user);
      setModel(nextModel);
      setFormByRecipient((current) => seedRecipientForms(current, nextModel.recipients));
      if (nextModel.selectedBatch?.id && nextModel.selectedBatch.id !== batchId) {
        navigate(`/teams/${encodeURIComponent(teamId)}/fees/${encodeURIComponent(nextModel.selectedBatch.id)}`, { replace: true });
      }
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load team fees.');
      setModel(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, teamId, batchId]);

  const recipients = model?.recipients || [];

  const totals = useMemo(() => {
    return {
      due: recipients.reduce((sum, recipient) => sum + recipient.amountDueCents, 0),
      paid: recipients.reduce((sum, recipient) => sum + recipient.amountPaidCents, 0),
      balance: recipients.reduce((sum, recipient) => sum + recipient.remainingBalanceCents, 0)
    };
  }, [recipients]);

  const actionableRecipients = useMemo(
    () => recipients.filter((recipient) => recipient.remainingBalanceCents > 0),
    [recipients]
  );

  const paidRecipients = useMemo(
    () => recipients.filter((recipient) => recipient.remainingBalanceCents <= 0),
    [recipients]
  );

  const isRecipientSubmitting = (recipientId: string) => submittingId === `payment:${recipientId}` || submittingId === `adjustment:${recipientId}`;

  if (!teamId) return <Navigate to="/teams" replace />;

  const updateForm = (recipientId: string, patch: Partial<{ paymentAmount: string; paymentDate: string; paymentNote: string; paymentError: string; adjustmentAmount: string; adjustmentReason: string; adjustmentError: string }>) => {
    setFormByRecipient((current) => ({
      ...current,
      [recipientId]: {
        ...(current[recipientId] || {
          paymentAmount: '',
          paymentDate: todayIsoDate(),
          paymentNote: '',
          paymentError: '',
          adjustmentAmount: '',
          adjustmentReason: '',
          adjustmentError: ''
        }),
        ...patch
      }
    }));
  };

  const submitPayment = async (event: FormEvent<HTMLFormElement>, recipient: TeamFeeRecipientSummary) => {
    event.preventDefault();
    const form = formByRecipient[recipient.id] || {
      paymentAmount: centsToAmount(recipient.remainingBalanceCents),
      paymentDate: todayIsoDate(),
      paymentNote: '',
      paymentError: '',
      adjustmentAmount: '',
      adjustmentReason: '',
      adjustmentError: ''
    };
    updateForm(recipient.id, { paymentError: '' });
    setSuccess('');
    setSubmittingId(`payment:${recipient.id}`);
    try {
      await recordOfflineTeamFeePayment({
        teamId,
        batchId: selectedBatchId,
        recipient,
        amount: form.paymentAmount,
        date: form.paymentDate,
        note: form.paymentNote,
        user: auth.user
      });
      setSuccess(`Recorded ${formatMoney(Number(form.paymentAmount) * 100)} for ${recipient.playerName}.`);
      await refresh();
    } catch (submitError: any) {
      updateForm(recipient.id, { paymentError: submitError?.message || 'Unable to record payment.' });
    } finally {
      setSubmittingId('');
    }
  };

  const submitAdjustment = async (event: FormEvent<HTMLFormElement>, recipient: TeamFeeRecipientSummary) => {
    event.preventDefault();
    const form = formByRecipient[recipient.id] || {
      paymentAmount: centsToAmount(recipient.remainingBalanceCents),
      paymentDate: todayIsoDate(),
      paymentNote: '',
      paymentError: '',
      adjustmentAmount: '',
      adjustmentReason: '',
      adjustmentError: ''
    };
    updateForm(recipient.id, { adjustmentError: '' });
    setSuccess('');
    setSubmittingId(`adjustment:${recipient.id}`);
    try {
      await recordTeamFeeBalanceAdjustment({
        teamId,
        batchId: selectedBatchId,
        recipient,
        amount: form.adjustmentAmount,
        note: form.adjustmentReason,
        user: auth.user
      });
      setSuccess(`Adjusted ${recipient.playerName} by ${formatSignedMoney(form.adjustmentAmount)}.`);
      await refresh();
    } catch (submitError: any) {
      updateForm(recipient.id, { adjustmentError: submitError?.message || 'Unable to save adjustment.' });
    } finally {
      setSubmittingId('');
    }
  };

  if (loading) {
    return (
      <section className="app-card p-5 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
        <div className="mt-3 text-sm font-black text-gray-950">Loading team fees</div>
        <div className="mt-1 text-xs font-semibold text-gray-500">Getting fee batches and recipients.</div>
      </section>
    );
  }

  if (error || !model) {
    return <StatusCard title="Team fees unavailable" message={error || 'Team fees could not be loaded.'} backTo={`/teams/${encodeURIComponent(teamId)}`} />;
  }

  if (!model.canManageFees) {
    return <StatusCard title="Admin access required" message="Only team owners, team admins, and global admins can record offline team fee payments or adjust balances." backTo={`/teams/${encodeURIComponent(teamId)}`} />;
  }

  return (
    <div className="space-y-4">
      <section className="app-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.06em] text-primary-700"><DollarSign className="h-4 w-4" aria-hidden="true" /> Team fees</div>
            <h1 className="mt-1 text-2xl font-black text-gray-950">Manage fee balances</h1>
            <p className="mt-1 text-sm font-semibold text-gray-600">{model.team.name}: record offline payments and apply one signed balance adjustment with a required reason for each recipient.</p>
          </div>
          <button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
          </button>
        </div>

        {model.batches.length ? (
          <label className="mt-4 block text-xs font-black uppercase tracking-[0.06em] text-gray-500">
            Fee batch
            <select
              className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900"
              value={selectedBatchId}
              onChange={(event) => navigate(`/teams/${encodeURIComponent(teamId)}/fees/${encodeURIComponent(event.target.value)}`)}
            >
              {model.batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.title}</option>)}
            </select>
          </label>
        ) : null}

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Metric label="Due" value={formatMoney(totals.due)} />
          <Metric label="Paid" value={formatMoney(totals.paid)} />
          <Metric label="Outstanding" value={formatMoney(totals.balance)} urgent={totals.balance > 0} />
        </div>
      </section>

      {success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800"><CheckCircle2 className="mr-2 inline h-4 w-4" aria-hidden="true" />{success}</div> : null}

      <section className="space-y-3" aria-labelledby="actionable-recipients-heading">
        <div>
          <h2 id="actionable-recipients-heading" className="text-sm font-black uppercase tracking-[0.06em] text-gray-500">Actionable recipients</h2>
          <p className="mt-1 text-xs font-semibold text-gray-500">Only recipients with an outstanding balance appear in the payment queue.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {actionableRecipients.length ? actionableRecipients.map((recipient) => {
            const form = formByRecipient[recipient.id] || {
              paymentAmount: centsToAmount(recipient.remainingBalanceCents),
              paymentDate: todayIsoDate(),
              paymentNote: '',
              paymentError: '',
              adjustmentAmount: '',
              adjustmentReason: '',
              adjustmentError: ''
            };
            const recipientSubmitting = isRecipientSubmitting(recipient.id);
            return (
              <section key={recipient.id} className="app-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black text-gray-950">{recipient.playerName}</h3>
                    <p className="mt-1 text-xs font-semibold text-gray-500">{[recipient.parentName, recipient.parentEmail].filter(Boolean).join(' · ') || 'Fee recipient'}</p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black uppercase text-gray-700">{recipient.status}</span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                  <Metric label="Status" value={recipient.status} />
                  <Metric label="Amount due" value={formatMoney(recipient.amountDueCents)} />
                  <Metric label="Paid" value={formatMoney(recipient.amountPaidCents)} />
                  <Metric label="Outstanding" value={formatMoney(recipient.remainingBalanceCents)} urgent={recipient.remainingBalanceCents > 0} />
                </div>

                <form className="mt-4 space-y-3" onSubmit={(event) => submitPayment(event, recipient)}>
                  <div className="text-xs font-black uppercase tracking-[0.06em] text-gray-500">Record offline payment</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-black uppercase tracking-[0.06em] text-gray-500">Payment amount
                      <input className="mt-1 w-full rounded-2xl border border-gray-200 px-3 py-3 text-sm font-bold text-gray-900" inputMode="decimal" value={form.paymentAmount} onChange={(event) => updateForm(recipient.id, { paymentAmount: event.target.value })} disabled={recipientSubmitting} />
                    </label>
                    <label className="text-xs font-black uppercase tracking-[0.06em] text-gray-500">Payment date
                      <input className="mt-1 w-full rounded-2xl border border-gray-200 px-3 py-3 text-sm font-bold text-gray-900" type="date" value={form.paymentDate} onChange={(event) => updateForm(recipient.id, { paymentDate: event.target.value })} disabled={recipientSubmitting} />
                    </label>
                  </div>
                  <label className="block text-xs font-black uppercase tracking-[0.06em] text-gray-500">Payment note
                    <input className="mt-1 w-full rounded-2xl border border-gray-200 px-3 py-3 text-sm font-bold text-gray-900" placeholder="Cash, check #, Venmo note..." value={form.paymentNote} onChange={(event) => updateForm(recipient.id, { paymentNote: event.target.value })} disabled={recipientSubmitting} />
                  </label>
                  {form.paymentError ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs font-bold text-rose-700">{form.paymentError}</div> : null}
                  <button type="submit" className="primary-button w-full" disabled={recipientSubmitting}>{submittingId === `payment:${recipient.id}` ? 'Recording...' : 'Record payment'}</button>
                </form>

                <form className="mt-4 space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-3" onSubmit={(event) => submitAdjustment(event, recipient)}>
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.06em] text-gray-500">Adjust balance</div>
                    <p className="mt-1 text-xs font-semibold text-gray-500">Positive credits reduce what is owed. Negative charges increase it.</p>
                  </div>
                  <label className="block text-xs font-black uppercase tracking-[0.06em] text-gray-500">Signed amount
                    <input className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900" inputMode="decimal" placeholder="25.00 or -10.00" value={form.adjustmentAmount} onChange={(event) => updateForm(recipient.id, { adjustmentAmount: event.target.value })} disabled={recipientSubmitting} />
                  </label>
                  <label className="block text-xs font-black uppercase tracking-[0.06em] text-gray-500">Reason
                    <input className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900" placeholder="Scholarship credit, late fee, correction..." value={form.adjustmentReason} onChange={(event) => updateForm(recipient.id, { adjustmentReason: event.target.value })} disabled={recipientSubmitting} />
                  </label>
                  {form.adjustmentError ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs font-bold text-rose-700">{form.adjustmentError}</div> : null}
                  <button type="submit" className="secondary-button w-full justify-center" disabled={recipientSubmitting}>{submittingId === `adjustment:${recipient.id}` ? 'Saving...' : 'Save adjustment'}</button>
                </form>
              </section>
            );
          }) : recipients.length ? (
            <section className="app-card p-5 text-center lg:col-span-2">
              <DollarSign className="mx-auto h-8 w-8 text-gray-400" aria-hidden="true" />
              <div className="mt-3 text-sm font-black text-gray-950">No outstanding balances</div>
              <p className="mt-1 text-xs font-semibold text-gray-500">Everyone in this fee batch is fully paid. Review paid recipients below.</p>
            </section>
          ) : null}
        </div>
      </section>

      {paidRecipients.length ? (
        <details className="app-card p-4">
          <summary className="cursor-pointer list-none text-sm font-black text-gray-950">
            Paid recipients ({paidRecipients.length})
          </summary>
          <p className="mt-2 text-xs font-semibold text-gray-500">Fully paid recipients stay available for review without editable payment controls.</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {paidRecipients.map((recipient) => {
              const form = formByRecipient[recipient.id] || {
                paymentAmount: centsToAmount(recipient.remainingBalanceCents),
                paymentDate: todayIsoDate(),
                paymentNote: '',
                paymentError: '',
                adjustmentAmount: '',
                adjustmentReason: '',
                adjustmentError: ''
              };
              const recipientSubmitting = isRecipientSubmitting(recipient.id);
              return (
              <section key={recipient.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black text-gray-950">{recipient.playerName}</h3>
                    <p className="mt-1 text-xs font-semibold text-gray-500">{[recipient.parentName, recipient.parentEmail].filter(Boolean).join(' · ') || 'Fee recipient'}</p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black uppercase text-emerald-700">{recipient.status}</span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                  <Metric label="Status" value={recipient.status} />
                  <Metric label="Amount due" value={formatMoney(recipient.amountDueCents)} />
                  <Metric label="Paid" value={formatMoney(recipient.amountPaidCents)} />
                  <Metric label="Outstanding" value={formatMoney(recipient.remainingBalanceCents)} />
                </div>

                <form className="mt-4 space-y-3 rounded-2xl border border-gray-200 bg-white p-3" onSubmit={(event) => submitAdjustment(event, recipient)}>
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.06em] text-gray-500">Adjust balance</div>
                    <p className="mt-1 text-xs font-semibold text-gray-500">Positive credits reduce what is owed. Negative charges increase it.</p>
                  </div>
                  <label className="block text-xs font-black uppercase tracking-[0.06em] text-gray-500">Signed amount
                    <input className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900" inputMode="decimal" placeholder="25.00 or -10.00" value={form.adjustmentAmount} onChange={(event) => updateForm(recipient.id, { adjustmentAmount: event.target.value })} disabled={recipientSubmitting} />
                  </label>
                  <label className="block text-xs font-black uppercase tracking-[0.06em] text-gray-500">Reason
                    <input className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900" placeholder="Scholarship credit, late fee, correction..." value={form.adjustmentReason} onChange={(event) => updateForm(recipient.id, { adjustmentReason: event.target.value })} disabled={recipientSubmitting} />
                  </label>
                  {form.adjustmentError ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs font-bold text-rose-700">{form.adjustmentError}</div> : null}
                  <button type="submit" className="secondary-button w-full justify-center" disabled={recipientSubmitting}>{submittingId === `adjustment:${recipient.id}` ? 'Saving...' : 'Save adjustment'}</button>
                </form>
              </section>
              );
            })}
          </div>
        </details>
      ) : null}

      {!recipients.length ? (
        <section className="app-card p-5 text-center">
          <DollarSign className="mx-auto h-8 w-8 text-gray-400" aria-hidden="true" />
          <div className="mt-3 text-sm font-black text-gray-950">No fee recipients</div>
          <p className="mt-1 text-xs font-semibold text-gray-500">Create fee batches in the full website manager, then record offline payments or adjustments here.</p>
        </section>
      ) : null}
    </div>
  );
}

function seedRecipientForms(current: Record<string, { paymentAmount: string; paymentDate: string; paymentNote: string; paymentError: string; adjustmentAmount: string; adjustmentReason: string; adjustmentError: string }>, recipients: TeamFeeRecipientSummary[]) {
  return recipients.reduce<Record<string, { paymentAmount: string; paymentDate: string; paymentNote: string; paymentError: string; adjustmentAmount: string; adjustmentReason: string; adjustmentError: string }>>((next, recipient) => {
    next[recipient.id] = current[recipient.id] || {
      paymentAmount: centsToAmount(recipient.remainingBalanceCents),
      paymentDate: todayIsoDate(),
      paymentNote: '',
      paymentError: '',
      adjustmentAmount: '',
      adjustmentReason: '',
      adjustmentError: ''
    };
    return next;
  }, {});
}

function formatSignedMoney(value: string) {
  const amount = Number(String(value || '').replace(/[$,]/g, '').trim());
  if (!Number.isFinite(amount)) return String(value || '').trim();
  return `${amount >= 0 ? '+' : '-'}${formatMoney(Math.round(Math.abs(amount) * 100))}`;
}

function Metric({ label, value, urgent = false }: { label: string; value: string; urgent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 ${urgent ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      <div className="text-[11px] font-black uppercase tracking-[0.06em] text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-black text-gray-950">{value}</div>
    </div>
  );
}

function StatusCard({ title, message, backTo }: { title: string; message: string; backTo: string }) {
  return (
    <section className="app-card p-5">
      <div className="flex items-start gap-3">
        <Shield className="mt-0.5 h-5 w-5 flex-none text-rose-600" aria-hidden="true" />
        <div>
          <div className="text-sm font-black text-gray-950">{title}</div>
          <div className="mt-1 text-sm font-semibold text-gray-600">{message}</div>
          <Link to={backTo} className="secondary-button mt-3 !min-h-9 text-xs">Back to team</Link>
        </div>
      </div>
    </section>
  );
}
