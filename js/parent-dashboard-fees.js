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
    }
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function toDateSafe(value) {
    if (!value) return null;
    const date = value?.toDate ? value.toDate() : new Date(value);
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
    const raw = fee?.amountDueCents ?? fee?.adjustedAmountCents ?? fee?.amountCents ?? fee?.amount;
    const cents = Number(raw);
    if (!Number.isFinite(cents)) return 'Amount not set';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(cents / 100);
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
        offlinePaymentInstructions: fee?.offlinePaymentInstructions || fee?.paymentInstructions || ''
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
                    <span class="self-start inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${meta.badgeClass}">${meta.label}</span>
                </div>
                <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div class="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                        <div class="text-xs uppercase tracking-wide text-gray-500 font-semibold">Amount owed</div>
                        <div class="font-bold text-gray-900">${formatParentFeeAmount(fee)}</div>
                    </div>
                    <div class="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                        <div class="text-xs uppercase tracking-wide text-gray-500 font-semibold">Due date</div>
                        <div class="font-bold text-gray-900">${escapeHtml(formatParentFeeDueDate(fee.dueDate))}</div>
                    </div>
                </div>
                ${notes}
                ${instructions}
            </div>
        `;
    }).join('');
}
