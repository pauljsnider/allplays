import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, DollarSign, Loader2, RefreshCw, Shield } from 'lucide-react';
import {
  loadTeamFeeManagementModel,
  recordOfflineTeamFeePayment,
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
  const [formByRecipient, setFormByRecipient] = useState<Record<string, { amount: string; date: string; note: string; error: string }>>({});

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

  if (!teamId) return <Navigate to="/teams" replace />;

  const updateForm = (recipientId: string, patch: Partial<{ amount: string; date: string; note: string; error: string }>) => {
    setFormByRecipient((current) => ({
      ...current,
      [recipientId]: { ...(current[recipientId] || { amount: '', date: todayIsoDate(), note: '', error: '' }), ...patch }
    }));
  };

  const submitPayment = async (event: FormEvent<HTMLFormElement>, recipient: TeamFeeRecipientSummary) => {
    event.preventDefault();
    const form = formByRecipient[recipient.id] || { amount: centsToAmount(recipient.remainingBalanceCents), date: todayIsoDate(), note: '', error: '' };
    updateForm(recipient.id, { error: '' });
    setSuccess('');
    setSubmittingId(recipient.id);
    try {
      await recordOfflineTeamFeePayment({
        teamId,
        batchId: selectedBatchId,
        recipient,
        amount: form.amount,
        date: form.date,
        note: form.note,
        user: auth.user
      });
      setSuccess(`Recorded ${formatMoney(Number(form.amount) * 100)} for ${recipient.playerName}.`);
      await refresh();
    } catch (submitError: any) {
      updateForm(recipient.id, { error: submitError?.message || 'Unable to record payment.' });
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
    return <StatusCard title="Admin access required" message="Only team owners, team admins, and global admins can record offline team fee payments." backTo={`/teams/${encodeURIComponent(teamId)}`} />;
  }

  return (
    <div className="space-y-4">
      <section className="app-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.06em] text-primary-700"><DollarSign className="h-4 w-4" aria-hidden="true" /> Team fees</div>
            <h1 className="mt-1 text-2xl font-black text-gray-950">Record offline payment</h1>
            <p className="mt-1 text-sm font-semibold text-gray-600">{model.team.name}: record cash, check, or other offline payments against existing fee recipients.</p>
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
            const form = formByRecipient[recipient.id] || { amount: centsToAmount(recipient.remainingBalanceCents), date: todayIsoDate(), note: '', error: '' };
            return (
              <section key={recipient.id} className="app-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black text-gray-950">{recipient.playerName}</h3>
                    <p className="mt-1 text-xs font-semibold text-gray-500">{[recipient.parentName, recipient.parentEmail].filter(Boolean).join(' · ') || 'Fee recipient'}</p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black uppercase text-gray-700">{recipient.status}</span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Metric label="Paid" value={formatMoney(recipient.amountPaidCents)} />
                  <Metric label="Balance" value={formatMoney(recipient.remainingBalanceCents)} urgent={recipient.remainingBalanceCents > 0} />
                  <Metric label="Ledger" value={String(recipient.paymentLedger.length)} />
                </div>

                <form className="mt-4 space-y-3" onSubmit={(event) => submitPayment(event, recipient)}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-black uppercase tracking-[0.06em] text-gray-500">Payment amount
                      <input className="mt-1 w-full rounded-2xl border border-gray-200 px-3 py-3 text-sm font-bold text-gray-900" inputMode="decimal" value={form.amount} onChange={(event) => updateForm(recipient.id, { amount: event.target.value })} />
                    </label>
                    <label className="text-xs font-black uppercase tracking-[0.06em] text-gray-500">Payment date
                      <input className="mt-1 w-full rounded-2xl border border-gray-200 px-3 py-3 text-sm font-bold text-gray-900" type="date" value={form.date} onChange={(event) => updateForm(recipient.id, { date: event.target.value })} />
                    </label>
                  </div>
                  <label className="block text-xs font-black uppercase tracking-[0.06em] text-gray-500">Note
                    <input className="mt-1 w-full rounded-2xl border border-gray-200 px-3 py-3 text-sm font-bold text-gray-900" placeholder="Cash, check #, Venmo note..." value={form.note} onChange={(event) => updateForm(recipient.id, { note: event.target.value })} />
                  </label>
                  {form.error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs font-bold text-rose-700">{form.error}</div> : null}
                  <button type="submit" className="primary-button w-full" disabled={submittingId === recipient.id}>{submittingId === recipient.id ? 'Recording...' : 'Record payment'}</button>
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
            {paidRecipients.map((recipient) => (
              <section key={recipient.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black text-gray-950">{recipient.playerName}</h3>
                    <p className="mt-1 text-xs font-semibold text-gray-500">{[recipient.parentName, recipient.parentEmail].filter(Boolean).join(' · ') || 'Fee recipient'}</p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black uppercase text-emerald-700">{recipient.status}</span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Metric label="Paid" value={formatMoney(recipient.amountPaidCents)} />
                  <Metric label="Balance" value={formatMoney(recipient.remainingBalanceCents)} />
                  <Metric label="Ledger" value={String(recipient.paymentLedger.length)} />
                </div>
              </section>
            ))}
          </div>
        </details>
      ) : null}

      {!recipients.length ? (
        <section className="app-card p-5 text-center">
          <DollarSign className="mx-auto h-8 w-8 text-gray-400" aria-hidden="true" />
          <div className="mt-3 text-sm font-black text-gray-950">No fee recipients</div>
          <p className="mt-1 text-xs font-semibold text-gray-500">Create fee batches in the full website manager, then record offline payments here.</p>
        </section>
      ) : null}
    </div>
  );
}

function seedRecipientForms(current: Record<string, { amount: string; date: string; note: string; error: string }>, recipients: TeamFeeRecipientSummary[]) {
  return recipients.reduce<Record<string, { amount: string; date: string; note: string; error: string }>>((next, recipient) => {
    next[recipient.id] = current[recipient.id] || {
      amount: centsToAmount(recipient.remainingBalanceCents),
      date: todayIsoDate(),
      note: '',
      error: ''
    };
    return next;
  }, {});
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
