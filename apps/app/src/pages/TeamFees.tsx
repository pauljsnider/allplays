import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, DollarSign, Loader2, RefreshCw, Shield } from 'lucide-react';
import {
  buildTeamFeeInstallmentSchedule,
  createTeamFeeBatchForApp,
  initiateStaffTeamFeeCheckout,
  loadTeamFeeManagementModel,
  recordOfflineTeamFeePayment,
  recordOfflineTeamFeeRefund,
  recordTeamFeeBalanceAdjustment,
  type TeamFeeManagementModel,
  type TeamFeeRecipientSummary
} from '../lib/teamFeesService';
import { isRetryableAppServiceError, toAppServiceError } from '../lib/appErrors';
import { copyPublicText, sharePublicUrl } from '../lib/publicActions';
import { useAppAsyncOperation } from '../lib/useAsyncOperation';
import type { AuthState } from '../lib/types';

type RecipientFormState = {
  paymentAmount: string;
  paymentDate: string;
  paymentNote: string;
  paymentError: string;
  adjustmentAmount: string;
  adjustmentReason: string;
  adjustmentError: string;
  checkoutError: string;
  refundOpen: boolean;
  refundType: 'full' | 'partial';
  refundAmount: string;
  refundMethod: string;
  refundNote: string;
  refundError: string;
};

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
  const [success, setSuccess] = useState('');
  const [createTitle, setCreateTitle] = useState('');
  const [createAmount, setCreateAmount] = useState('');
  const [createDueDate, setCreateDueDate] = useState(todayIsoDate());
  const [createInstallmentPlanEnabled, setCreateInstallmentPlanEnabled] = useState(false);
  const [createInstallmentCount, setCreateInstallmentCount] = useState('3');
  const [createInstallmentFirstDueDate, setCreateInstallmentFirstDueDate] = useState(todayIsoDate());
  const [createInstallmentIntervalDays, setCreateInstallmentIntervalDays] = useState('30');
  const [createForWholeRoster, setCreateForWholeRoster] = useState(true);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [createError, setCreateError] = useState('');
  const [formByRecipient, setFormByRecipient] = useState<Record<string, RecipientFormState>>({});
  const { error: loadError, clearError: clearLoadError, run: runLoadOperation } = useAppAsyncOperation();
  const { run: runMutationOperation } = useAppAsyncOperation();

  const selectedBatchId = model?.selectedBatch?.id || '';

  const refresh = async () => {
    if (!teamId) return;
    setLoading(true);
    await runLoadOperation(
      () => loadTeamFeeManagementModel(teamId, batchId || undefined, auth.user),
      {
        fallbackMessage: 'Unable to load team fees.',
        onSuccess: (nextModel) => {
          setModel(nextModel);
          setFormByRecipient((current) => seedRecipientForms(current, nextModel.recipients));
          if (nextModel.selectedBatch?.id && nextModel.selectedBatch.id !== batchId) {
            navigate(`/teams/${encodeURIComponent(teamId)}/fees/${encodeURIComponent(nextModel.selectedBatch.id)}`, { replace: true });
          }
        },
        onError: () => {
          setModel(null);
        },
        onFinally: () => {
          setLoading(false);
        }
      }
    );
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, teamId, batchId]);

  const recipients = model?.recipients || [];
  const rosterPlayers = model?.rosterPlayers || [];

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

  const installmentPreview = useMemo(() => {
    if (!createInstallmentPlanEnabled) return { installments: [], error: '' };
    if (!String(createAmount || '').trim() || !String(createInstallmentFirstDueDate || '').trim()) {
      return { installments: [], error: '' };
    }

    try {
      return {
        installments: buildTeamFeeInstallmentSchedule({
          amount: createAmount,
          installmentCount: createInstallmentCount,
          firstDueDate: createInstallmentFirstDueDate,
          intervalDays: createInstallmentIntervalDays
        }).installments,
        error: ''
      };
    } catch (previewError: any) {
      return { installments: [], error: previewError?.message || 'Unable to preview installment schedule.' };
    }
  }, [createAmount, createInstallmentCount, createInstallmentFirstDueDate, createInstallmentIntervalDays, createInstallmentPlanEnabled]);

  const isRecipientSubmitting = (recipientId: string) => {
    return submittingId === `payment:${recipientId}`
      || submittingId === `adjustment:${recipientId}`
      || submittingId === `refund:${recipientId}`
      || submittingId === `checkout-share:${recipientId}`
      || submittingId === `checkout-copy:${recipientId}`;
  };
  const isCreateSubmitting = submittingId === 'create-batch';

  if (!teamId) return <Navigate to="/teams" replace />;

  const updateForm = (recipientId: string, patch: Partial<RecipientFormState>) => {
    setFormByRecipient((current) => ({
      ...current,
      [recipientId]: {
        ...(current[recipientId] || buildRecipientFormState()),
        ...patch
      }
    }));
  };

  const toggleRecipient = (recipientId: string, checked: boolean) => {
    setSelectedRecipientIds((current) => checked
      ? Array.from(new Set([...current, recipientId]))
      : current.filter((id) => id !== recipientId));
  };

  const updateCreateDueDate = (nextDueDate: string) => {
    setCreateDueDate(nextDueDate);
    setCreateInstallmentFirstDueDate((current) => current && current !== createDueDate ? current : nextDueDate);
  };

  const submitCreateBatch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError('');
    setSuccess('');
    setSubmittingId('create-batch');
    try {
      const batch = await runMutationOperation(
        () => createTeamFeeBatchForApp({
          teamId,
          title: createTitle,
          amount: createAmount,
          dueDate: createDueDate,
          installmentPlan: createInstallmentPlanEnabled ? {
            installmentCount: createInstallmentCount,
            firstDueDate: createInstallmentFirstDueDate,
            intervalDays: createInstallmentIntervalDays
          } : null,
          recipientIds: selectedRecipientIds,
          applyToWholeRoster: createForWholeRoster,
          user: auth.user
        }),
        {
          fallbackMessage: 'Unable to create fee batch.',
          onError: (submitError) => {
            setCreateError(submitError.message);
          }
        }
      );
      if (!batch) return;
      setCreateTitle('');
      setCreateAmount('');
      setCreateDueDate(todayIsoDate());
      setCreateInstallmentPlanEnabled(false);
      setCreateInstallmentCount('3');
      setCreateInstallmentFirstDueDate(todayIsoDate());
      setCreateInstallmentIntervalDays('30');
      setCreateForWholeRoster(true);
      setSelectedRecipientIds([]);
      setSuccess(`Created fee batch ${createTitle.trim() || 'Team fee'}.`);
      navigate(`/teams/${encodeURIComponent(teamId)}/fees/${encodeURIComponent(batch.id)}`);
    } finally {
      setSubmittingId('');
    }
  };

  const submitPayment = async (event: FormEvent<HTMLFormElement>, recipient: TeamFeeRecipientSummary) => {
    event.preventDefault();
    const form = formByRecipient[recipient.id] || buildRecipientFormState(recipient);
    updateForm(recipient.id, { paymentError: '' });
    setSuccess('');
    setSubmittingId(`payment:${recipient.id}`);
    try {
      const result = await runMutationOperation(
        () => recordOfflineTeamFeePayment({
          teamId,
          batchId: selectedBatchId,
          recipient,
          amount: form.paymentAmount,
          date: form.paymentDate,
          note: form.paymentNote,
          user: auth.user
        }),
        {
          fallbackMessage: 'Unable to record payment.',
          onError: (submitError) => {
            updateForm(recipient.id, { paymentError: submitError.message });
          }
        }
      );
      if (!result && result !== undefined) return;
      setSuccess(`Recorded ${formatMoney(Number(form.paymentAmount) * 100)} for ${recipient.playerName}.`);
      await refresh();
    } finally {
      setSubmittingId('');
    }
  };

  const submitAdjustment = async (event: FormEvent<HTMLFormElement>, recipient: TeamFeeRecipientSummary) => {
    event.preventDefault();
    const form = formByRecipient[recipient.id] || buildRecipientFormState(recipient);
    updateForm(recipient.id, { adjustmentError: '' });
    setSuccess('');
    setSubmittingId(`adjustment:${recipient.id}`);
    try {
      const result = await runMutationOperation(
        () => recordTeamFeeBalanceAdjustment({
          teamId,
          batchId: selectedBatchId,
          recipient,
          amount: form.adjustmentAmount,
          note: form.adjustmentReason,
          user: auth.user
        }),
        {
          fallbackMessage: 'Unable to save adjustment.',
          onError: (submitError) => {
            updateForm(recipient.id, { adjustmentError: submitError.message });
          }
        }
      );
      if (!result && result !== undefined) return;
      setSuccess(`Adjusted ${recipient.playerName} by ${formatSignedMoney(form.adjustmentAmount)}.`);
      await refresh();
    } finally {
      setSubmittingId('');
    }
  };

  const submitRefund = async (event: FormEvent<HTMLFormElement>, recipient: TeamFeeRecipientSummary) => {
    event.preventDefault();
    const form = formByRecipient[recipient.id] || buildRecipientFormState(recipient);
    updateForm(recipient.id, { refundError: '' });
    setSuccess('');
    setSubmittingId(`refund:${recipient.id}`);
    try {
      const refundAmount = form.refundType === 'full' ? centsToAmount(recipient.amountPaidCents) : form.refundAmount;
      const result = await runMutationOperation(
        () => recordOfflineTeamFeeRefund({
          teamId,
          batchId: selectedBatchId,
          recipient,
          refundType: form.refundType,
          amount: refundAmount,
          method: form.refundMethod,
          note: form.refundNote,
          user: auth.user
        }),
        {
          fallbackMessage: 'Unable to record refund.',
          onError: (submitError) => {
            updateForm(recipient.id, { refundError: submitError.message });
          }
        }
      );
      if (!result && result !== undefined) return;
      setSuccess(`Recorded ${form.refundType} refund for ${recipient.playerName}.`);
      await refresh();
    } finally {
      setSubmittingId('');
    }
  };

  const resolveCheckoutUrl = async (recipient: TeamFeeRecipientSummary) => {
    const existingUrl = getActiveCheckoutUrl(recipient);
    if (existingUrl) return { checkoutUrl: existingUrl, created: false };

    const result = await initiateStaffTeamFeeCheckout({
      teamId,
      batchId: selectedBatchId,
      recipientId: recipient.id,
      user: auth.user
    });

    return { checkoutUrl: result.checkoutUrl, created: true };
  };

  const shareCheckoutLink = async (recipient: TeamFeeRecipientSummary) => {
    updateForm(recipient.id, { checkoutError: '' });
    setSuccess('');
    setSubmittingId(`checkout-share:${recipient.id}`);
    try {
      const { checkoutUrl, created } = await resolveCheckoutUrl(recipient);
      const result = await sharePublicUrl({
        title: `${recipient.playerName} fee checkout`,
        text: '',
        url: checkoutUrl,
        clipboardText: checkoutUrl
      });
      if (created) await refresh();
      if (result === 'shared') {
        setSuccess(`Shared checkout link for ${recipient.playerName}.`);
        return;
      }
      if (result === 'copied') {
        setSuccess(`Copied checkout link for ${recipient.playerName}.`);
        return;
      }
      if (result === 'cancelled') return;
      throw new Error('Unable to share checkout link.');
    } catch (shareError: any) {
      updateForm(recipient.id, { checkoutError: toAppServiceError(shareError, 'Unable to share checkout link.').message });
    } finally {
      setSubmittingId('');
    }
  };

  const copyCheckoutLink = async (recipient: TeamFeeRecipientSummary) => {
    updateForm(recipient.id, { checkoutError: '' });
    setSuccess('');
    setSubmittingId(`checkout-copy:${recipient.id}`);
    try {
      const { checkoutUrl, created } = await resolveCheckoutUrl(recipient);
      const result = await copyPublicText(checkoutUrl);
      if (created) await refresh();
      if (result !== 'copied') {
        throw new Error('Unable to copy checkout link.');
      }
      setSuccess(`Copied checkout link for ${recipient.playerName}.`);
    } catch (copyError: any) {
      updateForm(recipient.id, { checkoutError: toAppServiceError(copyError, 'Unable to copy checkout link.').message });
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

  if (loadError || !model) {
    return <StatusCard title="Team fees unavailable" message={loadError?.message || 'Team fees could not be loaded.'} backTo={`/teams/${encodeURIComponent(teamId)}`} onRetry={isRetryableAppServiceError(loadError) ? () => {
      clearLoadError();
      void refresh();
    } : undefined} />;
  }

  if (!model.canManageFees) {
    return <StatusCard title="Admin access required" message="Only team owners, team admins, and global admins can record offline team fee payments, refunds, or balance adjustments." backTo={`/teams/${encodeURIComponent(teamId)}`} />;
  }

  return (
    <div className="space-y-4">
      <section className="app-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.06em] text-primary-700"><DollarSign className="h-4 w-4" aria-hidden="true" /> Team fees</div>
            <h1 className="mt-1 text-2xl font-black text-gray-950">Manage fee balances</h1>
            <p className="mt-1 text-sm font-semibold text-gray-600">{model.team.name}: record offline payments, offline refunds, and one signed balance adjustment with a required reason for each recipient.</p>
          </div>
          <button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
          </button>
        </div>

        <form className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4" onSubmit={submitCreateBatch}>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.06em] text-gray-500">Create fee batch</h2>
              <p className="mt-1 text-xs font-semibold text-gray-500">Post a one-time fee in cents-backed app storage so the existing parent fee view keeps working.</p>
            </div>
            <div className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black uppercase text-amber-800">Offline/manual collection</div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="text-xs font-black uppercase tracking-[0.06em] text-gray-500">Fee name
              <input className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900" value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} disabled={isCreateSubmitting} placeholder="Tournament dues" />
            </label>
            <label className="text-xs font-black uppercase tracking-[0.06em] text-gray-500">Amount
              <input className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900" inputMode="decimal" value={createAmount} onChange={(event) => setCreateAmount(event.target.value)} disabled={isCreateSubmitting} placeholder="25.00" />
            </label>
            <label className="text-xs font-black uppercase tracking-[0.06em] text-gray-500">Due date
              <input className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900" type="date" value={createDueDate} onChange={(event) => updateCreateDueDate(event.target.value)} disabled={isCreateSubmitting} />
            </label>
          </div>

          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-3">
            <label className="flex items-start gap-3 text-sm font-bold text-gray-900">
              <input
                className="mt-1 h-4 w-4 rounded border-gray-300"
                type="checkbox"
                checked={createInstallmentPlanEnabled}
                onChange={(event) => {
                  setCreateInstallmentPlanEnabled(event.target.checked);
                  if (event.target.checked && !createInstallmentFirstDueDate) setCreateInstallmentFirstDueDate(createDueDate);
                }}
                disabled={isCreateSubmitting}
              />
              <span>
                Add installment schedule
                <span className="mt-1 block text-xs font-semibold text-gray-500">Parents will see each due date and amount on the same fee record.</span>
              </span>
            </label>

            {createInstallmentPlanEnabled ? (
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="text-xs font-black uppercase tracking-[0.06em] text-gray-500">Installments
                    <input className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900" type="number" min="2" max="12" step="1" value={createInstallmentCount} onChange={(event) => setCreateInstallmentCount(event.target.value)} disabled={isCreateSubmitting} />
                  </label>
                  <label className="text-xs font-black uppercase tracking-[0.06em] text-gray-500">First due date
                    <input className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900" type="date" value={createInstallmentFirstDueDate} onChange={(event) => setCreateInstallmentFirstDueDate(event.target.value)} disabled={isCreateSubmitting} />
                  </label>
                  <label className="text-xs font-black uppercase tracking-[0.06em] text-gray-500">Days apart
                    <input className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900" type="number" min="1" max="366" step="1" value={createInstallmentIntervalDays} onChange={(event) => setCreateInstallmentIntervalDays(event.target.value)} disabled={isCreateSubmitting} />
                  </label>
                </div>

                {installmentPreview.error ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs font-bold text-amber-700">{installmentPreview.error}</div> : null}
                {installmentPreview.installments.length ? (
                  <div className="grid gap-2 sm:grid-cols-3" aria-label="Installment schedule preview">
                    {installmentPreview.installments.map((installment) => (
                      <div key={`${installment.installmentNumber}-${installment.dueDate}`} className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                        <div className="text-[11px] font-black uppercase tracking-[0.06em] text-gray-500">{installment.label}</div>
                        <div className="mt-1 text-sm font-black text-gray-950">{formatMoney(installment.amountCents)}</div>
                        <div className="mt-0.5 text-xs font-semibold text-gray-500">Due {installment.dueDate}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-3">
            <label className="flex items-start gap-3 text-sm font-bold text-gray-900">
              <input className="mt-1 h-4 w-4 rounded border-gray-300" type="checkbox" checked={createForWholeRoster} onChange={(event) => setCreateForWholeRoster(event.target.checked)} disabled={isCreateSubmitting || !rosterPlayers.length} />
              <span>
                Charge the whole roster
                <span className="mt-1 block text-xs font-semibold text-gray-500">{rosterPlayers.length ? `${rosterPlayers.length} active player${rosterPlayers.length === 1 ? '' : 's'} will receive the fee.` : 'No active roster members are available yet.'}</span>
              </span>
            </label>

            {!createForWholeRoster && rosterPlayers.length ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2" aria-label="Fee recipients">
                {rosterPlayers.map((player) => (
                  <label key={player.id} className="flex items-center gap-3 rounded-2xl border border-gray-200 px-3 py-3 text-sm font-bold text-gray-900">
                    <input className="h-4 w-4 rounded border-gray-300" type="checkbox" checked={selectedRecipientIds.includes(player.id)} onChange={(event) => toggleRecipient(player.id, event.target.checked)} disabled={isCreateSubmitting} />
                    <span>{player.name}{player.number ? ` · #${player.number}` : ''}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>

          {createError ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs font-bold text-rose-700">{createError}</div> : null}
          <div className="mt-4 flex justify-end">
            <button type="submit" className="primary-button" disabled={isCreateSubmitting || !rosterPlayers.length}>{isCreateSubmitting ? 'Creating...' : 'Create fee batch'}</button>
          </div>
        </form>

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
            const form = formByRecipient[recipient.id] || buildRecipientFormState(recipient);
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

                <CheckoutLinkSection
                  recipient={recipient}
                  form={form}
                  recipientSubmitting={recipientSubmitting}
                  onShare={() => shareCheckoutLink(recipient)}
                  onCopy={() => copyCheckoutLink(recipient)}
                />

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

                <RefundSection
                  recipient={recipient}
                  form={form}
                  submittingId={submittingId}
                  recipientSubmitting={recipientSubmitting}
                  updateForm={updateForm}
                  submitRefund={submitRefund}
                />
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
              const form = formByRecipient[recipient.id] || buildRecipientFormState(recipient);
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

                <RefundSection
                  recipient={recipient}
                  form={form}
                  submittingId={submittingId}
                  recipientSubmitting={recipientSubmitting}
                  updateForm={updateForm}
                  submitRefund={submitRefund}
                  className="mt-4"
                />
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
          <p className="mt-1 text-xs font-semibold text-gray-500">Create a fee batch above, then record offline payments, refunds, or adjustments here.</p>
        </section>
      ) : null}
    </div>
  );
}

function buildRecipientFormState(recipient?: TeamFeeRecipientSummary): RecipientFormState {
  return {
    paymentAmount: centsToAmount(recipient?.remainingBalanceCents ?? 0),
    paymentDate: todayIsoDate(),
    paymentNote: '',
    paymentError: '',
    adjustmentAmount: '',
    adjustmentReason: '',
    adjustmentError: '',
    checkoutError: '',
    refundOpen: false,
    refundType: 'full',
    refundAmount: centsToAmount(recipient?.amountPaidCents ?? 0),
    refundMethod: '',
    refundNote: '',
    refundError: ''
  };
}

function seedRecipientForms(current: Record<string, RecipientFormState>, recipients: TeamFeeRecipientSummary[]) {
  return recipients.reduce<Record<string, RecipientFormState>>((next, recipient) => {
    next[recipient.id] = current[recipient.id] || buildRecipientFormState(recipient);
    return next;
  }, {});
}

function formatSignedMoney(value: string) {
  const amount = Number(String(value || '').replace(/[$,]/g, '').trim());
  if (!Number.isFinite(amount)) return String(value || '').trim();
  return `${amount >= 0 ? '+' : '-'}${formatMoney(Math.round(Math.abs(amount) * 100))}`;
}

function isOnlineCollectionRecipient(recipient: TeamFeeRecipientSummary) {
  return ['online_stripe', 'stripe', 'stripe_checkout', 'online'].includes(String(recipient.collectionMode || '').trim().toLowerCase());
}

function getActiveCheckoutUrl(recipient: TeamFeeRecipientSummary) {
  return String(recipient.checkoutStatus || '').trim().toLowerCase() === 'open' && String(recipient.checkoutUrl || '').trim()
    ? String(recipient.checkoutUrl || '').trim()
    : '';
}

function getCheckoutStatusLabel(recipient: TeamFeeRecipientSummary) {
  const normalized = String(recipient.checkoutStatus || '').trim().toLowerCase();
  if (normalized === 'open') return 'Active link';
  if (normalized === 'paid' || normalized === 'complete') return 'Paid';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'Cancelled';
  if (normalized === 'expired') return 'Expired';
  if (normalized === 'payment_failed') return 'Payment failed';
  if (normalized === 'stale') return 'Needs refresh';
  return 'No link yet';
}

function Metric({ label, value, urgent = false }: { label: string; value: string; urgent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 ${urgent ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      <div className="text-[11px] font-black uppercase tracking-[0.06em] text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-black text-gray-950">{value}</div>
    </div>
  );
}

function StatusCard({ title, message, backTo, onRetry }: { title: string; message: string; backTo: string; onRetry?: () => void }) {
  return (
    <section className="app-card p-5">
      <div className="flex items-start gap-3">
        <Shield className="mt-0.5 h-5 w-5 flex-none text-rose-600" aria-hidden="true" />
        <div>
          <div className="text-sm font-black text-gray-950">{title}</div>
          <div className="mt-1 text-sm font-semibold text-gray-600">{message}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {onRetry ? <button type="button" className="primary-button !min-h-9 text-xs" onClick={onRetry}>Retry</button> : null}
            <Link to={backTo} className="secondary-button !min-h-9 text-xs">Back to team</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function RefundSection({
  recipient,
  form,
  submittingId,
  recipientSubmitting,
  updateForm,
  submitRefund,
  className = 'mt-4'
}: {
  recipient: TeamFeeRecipientSummary;
  form: RecipientFormState;
  submittingId: string;
  recipientSubmitting: boolean;
  updateForm: (recipientId: string, patch: Partial<RecipientFormState>) => void;
  submitRefund: (event: FormEvent<HTMLFormElement>, recipient: TeamFeeRecipientSummary) => Promise<void>;
  className?: string;
}) {
  if (recipient.status === 'canceled' || recipient.amountPaidCents <= 0) return null;

  const maxRefundLabel = formatMoney(recipient.amountPaidCents);
  const previewError = form.refundOpen && form.refundType === 'partial'
    ? getPartialRefundPreviewError(form.refundAmount, recipient)
    : '';

  return (
    <section className={`${className} rounded-2xl border border-gray-200 bg-white p-3`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.06em] text-gray-500">Offline refund</div>
          <p className="mt-1 text-xs font-semibold text-gray-500">Refund up to {maxRefundLabel} by cash or check. This records the ledger change only.</p>
        </div>
        <button
          type="button"
          className="secondary-button !min-h-9 text-xs"
          disabled={recipientSubmitting}
          onClick={() => updateForm(recipient.id, { refundOpen: !form.refundOpen, refundError: '' })}
        >
          {form.refundOpen ? 'Cancel refund' : 'Record refund'}
        </button>
      </div>

      {form.refundOpen ? (
        <form className="mt-3 space-y-3" onSubmit={(event) => submitRefund(event, recipient)}>
          <label className="block text-xs font-black uppercase tracking-[0.06em] text-gray-500">Refund type
            <select className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900" value={form.refundType} onChange={(event) => updateForm(recipient.id, { refundType: event.target.value as 'full' | 'partial', refundError: '' })} disabled={recipientSubmitting}>
              <option value="full">Full refund</option>
              <option value="partial">Partial refund</option>
            </select>
          </label>

          {form.refundType === 'partial' ? (
            <label className="block text-xs font-black uppercase tracking-[0.06em] text-gray-500">Refund amount
              <input className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900" inputMode="decimal" placeholder={centsToAmount(recipient.amountPaidCents)} value={form.refundAmount} onChange={(event) => updateForm(recipient.id, { refundAmount: event.target.value, refundError: '' })} disabled={recipientSubmitting} />
            </label>
          ) : null}

          <label className="block text-xs font-black uppercase tracking-[0.06em] text-gray-500">Refund method
            <select className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900" value={form.refundMethod} onChange={(event) => updateForm(recipient.id, { refundMethod: event.target.value, refundError: '' })} disabled={recipientSubmitting}>
              <option value="">Select method</option>
              <option value="cash">Cash</option>
              <option value="check">Check</option>
            </select>
          </label>

          <label className="block text-xs font-black uppercase tracking-[0.06em] text-gray-500">Admin note
            <input className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900" placeholder="Why this was refunded and how it was handled" value={form.refundNote} onChange={(event) => updateForm(recipient.id, { refundNote: event.target.value, refundError: '' })} disabled={recipientSubmitting} />
          </label>

          {previewError ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs font-bold text-amber-700">{previewError}</div> : null}
          {form.refundError ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs font-bold text-rose-700">{form.refundError}</div> : null}
          <button type="submit" className="secondary-button w-full justify-center" disabled={recipientSubmitting || Boolean(previewError)}>{submittingId === `refund:${recipient.id}` ? 'Recording refund...' : 'Submit refund'}</button>
        </form>
      ) : null}
    </section>
  );
}

function CheckoutLinkSection({
  recipient,
  form,
  recipientSubmitting,
  onShare,
  onCopy
}: {
  recipient: TeamFeeRecipientSummary;
  form: RecipientFormState;
  recipientSubmitting: boolean;
  onShare: () => Promise<void>;
  onCopy: () => Promise<void>;
}) {
  if (recipient.status === 'paid' || recipient.status === 'canceled' || recipient.status === 'cancelled') return null;

  const onlineCollection = isOnlineCollectionRecipient(recipient);
  const hasActiveLink = Boolean(getActiveCheckoutUrl(recipient));
  const shareLabel = hasActiveLink ? 'Share checkout link' : 'Generate & share link';

  return (
    <section className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.06em] text-sky-700">Online checkout</div>
          <p className="mt-1 text-xs font-semibold text-sky-900">{onlineCollection ? `${getCheckoutStatusLabel(recipient)}. Share the public Stripe checkout URL with the family.` : 'This fee is marked for offline collection only, so no Stripe checkout link can be generated from the app.'}</p>
        </div>
        {onlineCollection ? <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black uppercase text-sky-700">{getCheckoutStatusLabel(recipient)}</span> : null}
      </div>

      {onlineCollection ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button type="button" className="secondary-button flex-1 justify-center" disabled={recipientSubmitting} onClick={() => { void onShare(); }}>{shareLabel}</button>
          <button type="button" className="ghost-button flex-1 justify-center" disabled={recipientSubmitting} onClick={() => { void onCopy(); }}>Copy checkout link</button>
        </div>
      ) : null}

      {form.checkoutError ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs font-bold text-rose-700">{form.checkoutError}</div> : null}
    </section>
  );
}

function getPartialRefundPreviewError(amount: string, recipient: TeamFeeRecipientSummary) {
  const refundAmountCents = Number(String(amount || '').replace(/[$,]/g, '').trim());
  if (!String(amount || '').trim() || !Number.isFinite(refundAmountCents) || refundAmountCents <= 0) {
    return 'Enter a refund amount greater than $0.';
  }
  if (Math.round(refundAmountCents * 100) > recipient.amountPaidCents) {
    return 'Refund amount cannot exceed the recorded paid amount.';
  }
  return '';
}
