const STATUS_LABELS = {
    paid: 'Paid',
    unpaid: 'Unpaid',
    adjusted: 'Adjusted',
    canceled: 'Canceled'
};

export function toFeeCents(value) {
    if (value === null || value === undefined || value === '') return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Math.round(amount * 100);
}

export function getRecipientBalanceCents(recipient) {
    if (recipient?.status === 'canceled') return 0;
    const raw = recipient?.amountDueCents ?? recipient?.adjustedAmountCents ?? recipient?.amountCents ?? 0;
    const cents = Number(raw);
    return Number.isFinite(cents) ? Math.max(0, cents) : 0;
}

export function getRecipientPaidCents(recipient) {
    if (recipient?.status === 'canceled') return 0;
    if (recipient?.status === 'paid') {
        const paid = Number(recipient?.amountPaidCents ?? recipient?.paidAmountCents);
        return Number.isFinite(paid) ? Math.max(0, paid) : getRecipientBalanceCents(recipient);
    }
    const paid = Number(recipient?.amountPaidCents ?? recipient?.paidAmountCents ?? 0);
    return Number.isFinite(paid) ? Math.max(0, paid) : 0;
}

export function normalizeFeeStatus(status) {
    const normalized = String(status || 'unpaid').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(STATUS_LABELS, normalized) ? normalized : 'unpaid';
}

export function summarizeFeeRecipients(recipients = []) {
    const summary = {
        totalAssignedCents: 0,
        totalPaidCents: 0,
        totalOutstandingCents: 0,
        counts: {
            paid: 0,
            unpaid: 0,
            adjusted: 0,
            canceled: 0
        }
    };

    recipients.forEach((recipient) => {
        const status = normalizeFeeStatus(recipient?.status);
        const balance = getRecipientBalanceCents(recipient);
        const paid = getRecipientPaidCents(recipient);
        summary.counts[status] += 1;
        summary.totalAssignedCents += status === 'canceled' ? 0 : balance;
        summary.totalPaidCents += paid;
        summary.totalOutstandingCents += status === 'paid' || status === 'canceled' ? 0 : Math.max(0, balance - paid);
    });

    return summary;
}

export function formatFeeCurrency(cents) {
    const amount = Number(cents);
    if (!Number.isFinite(amount)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount / 100);
}

export function buildManualPaymentUpdate({ amount, date, note, actorId }) {
    const amountPaidCents = toFeeCents(amount);
    if (amountPaidCents === null || amountPaidCents <= 0) {
        throw new Error('Enter a manual payment amount greater than $0.');
    }
    if (!date) {
        throw new Error('Enter a manual payment date.');
    }

    return {
        status: 'paid',
        amountPaidCents,
        paidAt: date,
        manualPayment: {
            amountPaidCents,
            paidAt: date,
            note: String(note || '').trim(),
            recordedBy: actorId || null
        }
    };
}

export function buildBalanceAdjustmentUpdate({ amount, note, actorId }) {
    const amountDueCents = toFeeCents(amount);
    if (amountDueCents === null) {
        throw new Error('Enter a valid adjusted balance.');
    }

    return {
        status: amountDueCents === 0 ? 'paid' : 'adjusted',
        amountDueCents,
        adjustment: {
            amountDueCents,
            note: String(note || '').trim(),
            adjustedBy: actorId || null
        }
    };
}

export function buildCancelRecipientUpdate({ note, actorId }) {
    return {
        status: 'canceled',
        amountDueCents: 0,
        canceled: {
            note: String(note || '').trim(),
            canceledBy: actorId || null
        }
    };
}

export function getRecipientDisplayName(recipient) {
    return recipient?.playerName || recipient?.childName || recipient?.name || recipient?.parentName || recipient?.parentEmail || 'Recipient';
}

export function getStatusLabel(status) {
    return STATUS_LABELS[normalizeFeeStatus(status)];
}
