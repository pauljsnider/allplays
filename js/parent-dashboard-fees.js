const STATUS_META = {
    paid: {
        label: 'Paid',
        badgeClass: 'bg-green-100 text-green-800 border-green-200',
        accentClass: 'border-l-green-500'
    },
    unpaid: {
        label: 'Unpaid',
        badgeClass: 'bg-red-100 text-red-800 border-red-200',
        accentClass: 'border-l-red-500'
    },
    canceled: {
        label: 'Canceled',
        badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
        accentClass: 'border-l-gray-400'
    },
    adjusted: {
        label: 'Adjusted',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
        accentClass: 'border-l-amber-500'
    },
    partial: {
        label: 'Partially paid',
        badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
        accentClass: 'border-l-blue-500'
    },
    partially_paid: {
        label: 'Partially paid',
        badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
        accentClass: 'border-l-blue-500'
    }
};


function getFirstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0));
}

function getFeeLineItems(fee) {
    const rawItems = getFirstDefined(fee?.lineItems, fee?.invoiceLineItems, fee?.invoiceItems, fee?.items);
    return Array.isArray(rawItems) ? rawItems.filter(Boolean) : [];
}

function getFeeInstallments(fee) {
    const rawInstallments = getFirstDefined(fee?.installments, fee?.installmentSchedule, fee?.paymentSchedule, fee?.scheduledPayments);
    return Array.isArray(rawInstallments) ? rawInstallments.filter(Boolean) : [];
}

function getFeeBalanceCents(fee) {
    const explicitBalance = getFirstDefined(fee?.balanceDueCents, fee?.remainingBalanceCents, fee?.amountDueCents);
    if (explicitBalance !== undefined) return explicitBalance;

    const totalCents = getFeeTotalCents(fee);
    const paidCents = getFeePaidCents(fee);
    if (totalCents === undefined || paidCents === undefined) return undefined;
    return Math.max(0, Number(totalCents) - Number(paidCents));
}

function getFeeTotalCents(fee) {
    return getFirstDefined(fee?.totalAmountCents, fee?.totalCents, fee?.adjustedAmountCents, fee?.amountCents, fee?.amountDueCents, fee?.amount);
}

function getFeePaidCents(fee) {
    return getFirstDefined(fee?.paidAmountCents, fee?.amountPaidCents, fee?.totalPaidCents, fee?.paidCents);
}

function getFeeCheckoutUrl(fee) {
    return getFirstDefined(fee?.checkoutUrl, fee?.checkoutURL, fee?.paymentLink, fee?.paymentLinkUrl, fee?.paymentUrl);
}

function getFeeLedgerEntries(fee) {
    const rawEntries = getFirstDefined(fee?.ledgerEntries, fee?.paymentLedger, fee?.activity, fee?.receipts, fee?.payments, fee?.adjustments);
    return Array.isArray(rawEntries) ? rawEntries.filter(Boolean) : [];
}

function isPayActionAllowed(fee) {
    if (!fee?.checkoutUrl) return false;
    if (fee.status === 'paid' || fee.status === 'canceled') return false;

    const balanceCents = Number(fee.balanceDueCents);
    if (Number.isFinite(balanceCents)) return balanceCents > 0;
    return fee.status === 'unpaid' || fee.status === 'partial' || fee.status === 'partially_paid';
}

function formatCents(value) {
    const cents = Number(value);
    if (!Number.isFinite(cents)) return '';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(cents / 100);
}

function formatInvoiceQuantity(item) {
    const quantity = Number(item?.quantity ?? item?.qty);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

function formatInstallmentStatus(installment) {
    const status = String(installment?.status || '').trim().toLowerCase();
    if (installment?.paid === true || status === 'paid' || installment?.paidAt) return 'Paid';
    if (status === 'canceled' || status === 'cancelled') return 'Canceled';
    if (status === 'adjusted') return 'Adjusted';
    return 'Unpaid';
}

function renderInvoiceLineItems(fee) {
    const lineItems = getFeeLineItems(fee);
    if (!lineItems.length) return '';

    const rows = lineItems.map((item) => {
        const description = getFirstDefined(item?.description, item?.title, item?.name, item?.label, 'Fee line item');
        const quantity = formatInvoiceQuantity(item);
        const amount = formatCents(getFirstDefined(item?.amountCents, item?.totalCents, item?.unitAmountCents, item?.priceCents));
        const details = [
            quantity ? `Qty ${escapeHtml(quantity)}` : '',
            item?.dueDate || item?.dueAt ? `Due ${escapeHtml(formatParentFeeDueDate(item.dueDate || item.dueAt))}` : ''
        ].filter(Boolean).join(' · ');

        return `
            <div class="flex items-start justify-between gap-3 py-2 border-t border-gray-100 first:border-t-0">
                <div>
                    <div class="font-medium text-gray-900">${escapeHtml(description)}</div>
                    ${details ? `<div class="text-xs text-gray-500 mt-0.5">${details}</div>` : ''}
                </div>
                <div class="font-semibold text-gray-900 whitespace-nowrap">${escapeHtml(amount || 'Amount not set')}</div>
            </div>
        `;
    }).join('');

    return `
        <div class="mt-4 rounded-lg border border-gray-200 bg-white p-3">
            <div class="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">Invoice line items</div>
            ${rows}
        </div>
    `;
}

function renderInstallmentSchedule(fee) {
    const installments = getFeeInstallments(fee);
    if (!installments.length) return '';

    const rows = installments.map((installment, index) => {
        const label = getFirstDefined(installment?.label, installment?.title, installment?.name, `Installment ${index + 1}`);
        const dueDate = formatParentFeeDueDate(installment?.dueDate || installment?.dueAt);
        const amount = formatCents(getFirstDefined(installment?.amountCents, installment?.dueAmountCents, installment?.balanceDueCents));
        const status = formatInstallmentStatus(installment);
        const statusClass = status === 'Paid'
            ? 'bg-green-100 text-green-800 border-green-200'
            : 'bg-red-100 text-red-800 border-red-200';

        return `
            <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 sm:items-center py-2 border-t border-gray-100 first:border-t-0">
                <div>
                    <div class="font-medium text-gray-900">${escapeHtml(label)}</div>
                    <div class="text-xs text-gray-500">Due ${escapeHtml(dueDate)}</div>
                </div>
                <div class="font-semibold text-gray-900 sm:text-right">${escapeHtml(amount || 'Amount not set')}</div>
                <span class="inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-bold ${statusClass}">${escapeHtml(status)}</span>
            </div>
        `;
    }).join('');

    return `
        <div class="mt-4 rounded-lg border border-gray-200 bg-white p-3">
            <div class="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">Installment schedule</div>
            ${rows}
        </div>
    `;
}

function isRefundLedgerEntry(entry) {
    const marker = String(getFirstDefined(entry?.type, entry?.kind, entry?.action, entry?.category, entry?.label, entry?.title, '')).toLowerCase();
    return marker.includes('refund') || entry?.refund === true || entry?.isRefund === true || entry?.refundAmountCents !== undefined;
}

function formatLedgerEntryLabel(entry, index) {
    if (isRefundLedgerEntry(entry)) return getFirstDefined(entry?.label, entry?.title, 'Refund');
    return getFirstDefined(entry?.label, entry?.title, entry?.type, entry?.kind, `Activity ${index + 1}`);
}

function getLedgerEntryDate(entry) {
    return getFirstDefined(
        entry?.date,
        entry?.refundDate,
        entry?.refundedAt,
        entry?.processedAt,
        entry?.postedAt,
        entry?.createdAt,
        entry?.paidAt,
        entry?.paymentDate,
        entry?.adjustedAt
    );
}

function getRefundAmountCents(entry) {
    const rawAmount = getFirstDefined(entry?.refundAmountCents, entry?.amountCents, entry?.paidAmountCents, entry?.totalCents);
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount)) return undefined;
    return amount > 0 ? -amount : amount;
}

function formatLedgerEntryAmount(entry) {
    const rawAmount = isRefundLedgerEntry(entry)
        ? getRefundAmountCents(entry)
        : getFirstDefined(entry?.amountCents, entry?.paidAmountCents, entry?.adjustmentAmountCents, entry?.totalCents);
    return formatCents(rawAmount);
}

function getParentVisibleLedgerNote(entry) {
    const publicNote = getFirstDefined(
        entry?.publicNote,
        entry?.parentNote,
        entry?.payerNote,
        entry?.customerNote,
        entry?.receiptNumber,
        entry?.reference
    );
    if (publicNote || isRefundLedgerEntry(entry)) return publicNote;
    return getFirstDefined(entry?.note, entry?.memo, entry?.description);
}

function renderReceiptActivity(fee) {
    const entries = getFeeLedgerEntries(fee);
    if (!entries.length) return '';

    const rows = entries.map((entry, index) => {
        const refundEntry = isRefundLedgerEntry(entry);
        const label = formatLedgerEntryLabel(entry, index);
        const dateValue = getLedgerEntryDate(entry);
        const amount = formatLedgerEntryAmount(entry);
        const note = getParentVisibleLedgerNote(entry);
        const method = refundEntry ? getFirstDefined(entry?.offlineMethod, entry?.refundMethod, entry?.method, entry?.paymentMethod) : '';
        const status = getFirstDefined(entry?.refundStatus, entry?.status, entry?.paymentStatus);
        const details = [
            dateValue ? formatParentFeeDueDate(dateValue) : '',
            method ? String(method) : '',
            status ? String(status) : '',
            note ? String(note) : ''
        ].filter(Boolean).join(' · ');
        const amountClass = refundEntry ? 'text-emerald-700' : 'text-gray-900';

        return `
            <div class="flex items-start justify-between gap-3 py-2 border-t border-gray-100 first:border-t-0">
                <div>
                    <div class="font-medium text-gray-900 capitalize">${escapeHtml(label)}</div>
                    ${details ? `<div class="text-xs text-gray-500 mt-0.5">${escapeHtml(details)}</div>` : ''}
                </div>
                <div class="font-semibold ${amountClass} whitespace-nowrap">${escapeHtml(amount || 'Amount not set')}</div>
            </div>
        `;
    }).join('');

    return `
        <div class="mt-4 rounded-lg border border-gray-200 bg-white p-3">
            <div class="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">Receipts & activity</div>
            ${rows}
        </div>
    `;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function parseDateOnlyLocal(value) {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toDateSafe(value) {
    if (!value) return null;
    const localDateOnly = typeof value === 'string' ? parseDateOnlyLocal(value) : null;
    const date = value?.toDate ? value.toDate() : localDateOnly || new Date(value);
    return Number.isNaN(date?.getTime?.()) ? null : date;
}

export function normalizeParentFeeStatus(status) {
    const normalized = String(status || 'unpaid').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(STATUS_META, normalized) ? normalized : 'unpaid';
}

export function getParentFeeStatusMeta(status) {
    return STATUS_META[normalizeParentFeeStatus(status)];
}

export function formatParentFeeAmount(fee) {
    const raw = getFeeTotalCents(fee);
    return formatCents(raw) || 'Amount not set';
}

export function formatParentFeeDueDate(value) {
    const date = toDateSafe(value);
    if (!date) return 'No due date';
    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

export function normalizeParentFeeRecord(fee) {
    return {
        ...fee,
        title: fee?.title || fee?.feeTitle || fee?.name || 'Team fee',
        teamName: fee?.teamName || 'Team',
        playerName: fee?.playerName || fee?.childName || '',
        status: normalizeParentFeeStatus(fee?.status),
        dueDate: fee?.dueDate || fee?.dueAt || null,
        notes: fee?.notes || fee?.feeNotes || '',
        offlinePaymentInstructions: fee?.offlinePaymentInstructions || fee?.paymentInstructions || '',
        totalAmountCents: getFeeTotalCents(fee),
        paidAmountCents: getFeePaidCents(fee),
        balanceDueCents: getFeeBalanceCents(fee),
        checkoutUrl: getFeeCheckoutUrl(fee)
    };
}

export function sortParentFeeRecords(fees) {
    return [...(fees || [])].sort((a, b) => {
        const aDate = toDateSafe(a?.dueDate || a?.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bDate = toDateSafe(b?.dueDate || b?.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (aDate !== bDate) return aDate - bDate;
        return String(a?.title || a?.feeTitle || '').localeCompare(String(b?.title || b?.feeTitle || ''));
    });
}

export function renderParentTeamFees(fees) {
    const normalizedFees = sortParentFeeRecords(fees).map(normalizeParentFeeRecord);
    if (normalizedFees.length === 0) {
        return '';
    }

    return normalizedFees.map((fee) => {
        const meta = getParentFeeStatusMeta(fee.status);
        const playerLine = fee.playerName ? `<span>For ${escapeHtml(fee.playerName)}</span>` : '';
        const notes = fee.notes
            ? `<p class="text-sm text-gray-700 mt-3"><span class="font-semibold">Notes:</span> ${escapeHtml(fee.notes)}</p>`
            : '';
        const instructions = fee.offlinePaymentInstructions
            ? `<p class="text-sm text-gray-700 mt-2"><span class="font-semibold">Offline payment:</span> ${escapeHtml(fee.offlinePaymentInstructions)}</p>`
            : '';
        const paid = fee.paidAmountCents !== undefined && fee.paidAmountCents !== null
            ? `<div class="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2"><div class="text-xs uppercase tracking-wide text-gray-500 font-semibold">Paid</div><div class="font-bold text-gray-900">${escapeHtml(formatCents(fee.paidAmountCents) || 'Amount not set')}</div></div>`
            : '';
        const balance = fee.balanceDueCents !== undefined && fee.balanceDueCents !== null
            ? `<div class="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2"><div class="text-xs uppercase tracking-wide text-gray-500 font-semibold">Remaining balance</div><div class="font-bold text-gray-900">${escapeHtml(formatCents(fee.balanceDueCents) || 'Amount not set')}</div></div>`
            : '';
        const lineItems = renderInvoiceLineItems(fee);
        const installmentSchedule = renderInstallmentSchedule(fee);
        const receiptActivity = renderReceiptActivity(fee);
        const payLink = isPayActionAllowed(fee)
            ? `<a class="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700" href="${escapeHtml(fee.checkoutUrl)}">Pay</a>`
            : '';

        return `
            <div class="rounded-xl border border-gray-200 border-l-4 ${meta.accentClass} bg-white p-4 shadow-sm">
                <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div>
                        <h3 class="font-bold text-gray-900">${escapeHtml(fee.title)}</h3>
                        <div class="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-2 gap-y-1">
                            <span>${escapeHtml(fee.teamName)}</span>
                            ${playerLine}
                        </div>
                    </div>
                    <div class="flex flex-col sm:items-end gap-2">
                        <span class="self-start sm:self-end inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${meta.badgeClass}">${meta.label}</span>
                        ${payLink}
                    </div>
                </div>
                <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div class="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                        <div class="text-xs uppercase tracking-wide text-gray-500 font-semibold">Total amount</div>
                        <div class="font-bold text-gray-900">${formatParentFeeAmount(fee)}</div>
                    </div>
                    <div class="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                        <div class="text-xs uppercase tracking-wide text-gray-500 font-semibold">Due date</div>
                        <div class="font-bold text-gray-900">${escapeHtml(formatParentFeeDueDate(fee.dueDate))}</div>
                    </div>
                    ${paid}
                    ${balance}
                </div>
                <details class="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <summary class="cursor-pointer text-sm font-bold text-blue-700 hover:text-blue-800">View fee details</summary>
                    <div class="mt-3 text-sm text-gray-700">
                        ${lineItems || '<div class="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-500">No line items recorded.</div>'}
                        ${installmentSchedule}
                        ${receiptActivity}
                    </div>
                </details>
                ${notes}
                ${instructions}
            </div>
        `;
    }).join('');
}
