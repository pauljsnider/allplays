import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { DollarSign, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { openPublicUrl } from '../../lib/publicActions';
import { initiateParentTeamFeeCheckout, loadParentFeesForApp, type ParentFeeAppRecord } from '../../lib/parentFeesService';
import type { AuthState } from '../../lib/types';
import { EmptyState, LoadingBlock, MetricCard, RetryableStatus, ToolHeader, formatDetailAmount, formatMoney, useParentToolAsyncOperation } from './shared';

export function FeesTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
    const [searchParams] = useSearchParams();
    const [fees, setFees] = useState<ParentFeeAppRecord[]>([]);
    const [filter, setFilter] = useState<'open' | 'all' | 'paid'>('open');
    const [payingFeeId, setPayingFeeId] = useState('');
    const paymentInFlightRef = useRef(false);
    const [feeErrors, setFeeErrors] = useState<Record<string, string>>({});
    const { loading, error, run: runLoad } = useParentToolAsyncOperation();
    const payOperation = useParentToolAsyncOperation();
    const requestedTeamId = String(searchParams.get('teamId') || '').trim();
    const requestedBatchId = String(searchParams.get('batchId') || '').trim();
    const requestedRecipientId = String(searchParams.get('recipientId') || '').trim();
    const hasRequestedFee = Boolean(requestedTeamId || requestedBatchId || requestedRecipientId);

    const refresh = useCallback(async () => {
        return runLoad(
            () => loadParentFeesForApp(auth.user),
            'Unable to load fees.',
            {
                onSuccess: (result) => {
                    setFees(result);
                }
            }
        );
    }, [auth.user, runLoad]);

    useEffect(() => {
        void refresh();
    }, [auth.user?.uid, refresh, refreshVersion]);

    useEffect(() => {
        if (!hasRequestedFee) return;
        setFilter((current) => (current === 'open' ? 'all' : current));
    }, [hasRequestedFee, requestedBatchId, requestedRecipientId, requestedTeamId]);

    const visibleFees = useMemo(() => {
        const filteredFees = fees.filter((fee) => {
            if (filter === 'all') return true;
            if (filter === 'paid') return fee.status === 'paid';
            return !['paid', 'canceled', 'cancelled'].includes(String(fee.status || '').toLowerCase());
        });

        if (!hasRequestedFee) {
            return filteredFees;
        }

        const matchingFees = filteredFees.filter((fee) => {
            if (requestedTeamId && String(fee.teamId || '') !== requestedTeamId) return false;
            if (requestedBatchId && String(fee.batchId || '') !== requestedBatchId) return false;
            if (requestedRecipientId && String(fee.recipientId || '') !== requestedRecipientId) return false;
            return true;
        });

        return matchingFees.length ? matchingFees : filteredFees;
    }, [fees, filter, hasRequestedFee, requestedBatchId, requestedRecipientId, requestedTeamId]);

    const openCount = fees.filter((fee) => !['paid', 'canceled', 'cancelled'].includes(String(fee.status || '').toLowerCase())).length;
    const balanceCents = visibleFees.reduce((sum, fee) => sum + Number(fee.balanceDueCents ?? fee.amountDueCents ?? 0), 0);
    const payFee = async (fee: ParentFeeAppRecord) => {
        if (paymentInFlightRef.current) return;

        paymentInFlightRef.current = true;
        const feeKey = getFeeCardKey(fee);
        const checkoutStatus = String(fee.checkoutStatus || '').toLowerCase();
        const reusableCheckoutUrl = Boolean(fee.checkoutUrl) && (!checkoutStatus || checkoutStatus === 'open');
        setPayingFeeId(feeKey);
        setFeeErrors((current) => ({ ...current, [feeKey]: '' }));
        payOperation.clearError();
        await payOperation.run(
            async () => {
                if (fee.paymentAction === 'checkoutUrl' || (!fee.paymentAction && reusableCheckoutUrl)) {
                    await openPublicUrl(String(fee.checkoutUrl));
                    return;
                }
                if (fee.paymentAction === 'createCheckout' || (!fee.paymentAction && fee.checkoutInitiatable)) {
                    const checkout = await initiateParentTeamFeeCheckout(String(fee.teamId || ''), String(fee.batchId || ''), String(fee.recipientId || ''));
                    await openPublicUrl(checkout.checkoutUrl);
                    return;
                }
                if (!reusableCheckoutUrl) {
                    throw new Error('Checkout is not available for this fee.');
                }
                await openPublicUrl(String(fee.checkoutUrl));
            },
            'Unable to open checkout. Please try again.',
            {
                onError: (payError) => {
                    setFeeErrors((current) => ({ ...current, [feeKey]: String(payError.message || 'Unable to open checkout. Please try again.') }));
                },
                onFinally: () => {
                    paymentInFlightRef.current = false;
                    setPayingFeeId('');
                }
            }
        );
    };

    return (
        <div className="space-y-3">
            <section className="app-card p-4">
                <ToolHeader icon={DollarSign} title="Team fees" detail="Balances, checkout links, installments, and payment history." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <MetricCard label="Open" value={String(openCount)} />
                    <MetricCard label="Showing" value={String(visibleFees.length)} />
                    <MetricCard label="Balance" value={formatMoney(balanceCents)} urgent={balanceCents > 0} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1 rounded-2xl border border-gray-200 bg-white p-1">
                    {(['open', 'all', 'paid'] as const).map((option) => (
                        <button key={option} type="button" className={`min-h-10 rounded-xl text-sm font-black capitalize ${filter === option ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`} onClick={() => setFilter(option)} aria-pressed={filter === option}>
                            {option}
                        </button>
                    ))}
                </div>
            </section>

            {error ? <RetryableStatus error={error} fallbackMessage="Unable to load fees." onRetry={refresh} retrying={loading} /> : null}
            {!error && (loading ? <LoadingBlock label="Loading fees" /> : (
                <div className="grid gap-3 lg:grid-cols-2">
                    {visibleFees.length ? visibleFees.map((fee) => {
                        const feeKey = getFeeCardKey(fee);
                        return <FeeCard key={feeKey} fee={fee} onPay={payFee} paying={payingFeeId === feeKey} payBlocked={Boolean(payingFeeId)} error={feeErrors[feeKey] || ''} />;
                    }) : (
                        <EmptyState icon={DollarSign} title="No fees in this view" detail="Paid and canceled items are available under All." />
                    )}
                </div>
            ))}
        </div>
    );
}

function getFeeCardKey(fee: ParentFeeAppRecord) {
    return `${fee.teamId || 'team'}-${fee.batchId || 'batch'}-${fee.recipientId || fee.id || fee.title || 'fee'}`;
}

function getFeeMessage(...values: Array<unknown>): string {
    return values.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function FeeMessageBlock({ title, message }: { title: string; message: string }) {
    return (
        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs font-semibold leading-5 text-blue-900">
            <div className="font-black uppercase tracking-[0.04em] text-blue-700">{title}</div>
            <div className="mt-1 whitespace-pre-wrap break-words">{message}</div>
        </div>
    );
}

function FeeCard({ fee, onPay, paying, payBlocked, error }: { fee: ParentFeeAppRecord; onPay: (fee: ParentFeeAppRecord) => void | Promise<void>; paying: boolean; payBlocked: boolean; error: string }) {
    const [detailsOpen, setDetailsOpen] = useState(false);
    const detailsId = useId();
    const notes = getFeeMessage(fee.notes, fee.feeNotes);
    const offlinePaymentInstructions = getFeeMessage(fee.offlinePaymentInstructions, fee.paymentInstructions);
    const hasDetails = Boolean(fee.lineItems.length || fee.installments.length || fee.ledgerEntries.length || notes);

    return (
        <section className="app-card p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-sm font-black text-gray-950">{fee.title || fee.feeName || 'Team fee'}</div>
                    <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{fee.teamName || 'Team'}{fee.playerName ? ` - ${fee.playerName}` : ''}</div>
                </div>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase text-gray-700">{fee.statusLabel}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
                <MetricCard label="Amount" value={fee.amountLabel} />
                <MetricCard label="Due" value={fee.dueLabel} />
                <MetricCard label="Balance" value={formatMoney(Number(fee.balanceDueCents ?? 0))} urgent={Number(fee.balanceDueCents ?? 0) > 0} />
            </div>
            {offlinePaymentInstructions ? <FeeMessageBlock title="Offline payment" message={offlinePaymentInstructions} /> : null}
            {fee.canPay ? (
                <button type="button" className="primary-button mt-3 w-full" onClick={() => onPay(fee)} disabled={payBlocked}>
                    {paying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
                    {paying ? 'Opening checkout' : 'Pay fee'}
                </button>
            ) : null}
            {error ? <div className="mt-2 rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error}</div> : null}
            {hasDetails ? (
                <div className="mt-3">
                    <button
                        type="button"
                        className="secondary-button w-full justify-center"
                        aria-expanded={detailsOpen}
                        aria-controls={detailsId}
                        onClick={() => setDetailsOpen((current) => !current)}
                    >
                        {detailsOpen ? 'Hide details' : 'View details'}
                    </button>
                    {detailsOpen ? (
                        <div id={detailsId}>
                            {fee.lineItems.length ? <FeeDetailList title="Line items" rows={fee.lineItems} /> : null}
                            {fee.installments.length ? <FeeDetailList title="Installments" rows={fee.installments} /> : null}
                            {fee.ledgerEntries.length ? <FeeDetailList title="Payments and adjustments" rows={fee.ledgerEntries} /> : null}
                            {notes ? <FeeMessageBlock title="Notes" message={notes} /> : null}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}

function FeeDetailList({ title, rows }: { title: string; rows: Array<Record<string, any>> }) {
    return (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">{title}</div>
            <div className="mt-2 space-y-1.5">
                {rows.slice(0, 4).map((row, index) => (
                    <div key={`${title}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs">
                        <span className="min-w-0 truncate font-black text-gray-800">{row.title || row.label || row.description || row.status || `Item ${index + 1}`}</span>
                        <span className="flex-none font-black text-gray-600">{formatDetailAmount(row)}</span>
                    </div>
                ))}
                {rows.length > 4 ? <div className="text-xs font-bold text-gray-500">+{rows.length - 4} more</div> : null}
            </div>
        </div>
    );
}
