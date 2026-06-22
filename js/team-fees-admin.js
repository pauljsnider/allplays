import { escapeHtml, getUrlParams, renderFooter, renderHeader } from './utils.js?v=8';

export const OFFLINE_TEAM_FEE_LABEL = 'Offline/manual collection only';
export const OFFLINE_TEAM_FEE_INSTRUCTIONS = 'Collect payment outside ALL PLAYS. No online payment is processed.';

const STATUS_LABELS = {
    paid: 'Paid',
    unpaid: 'Unpaid',
    partial: 'Partial',
    adjusted: 'Adjusted',
    canceled: 'Canceled'
};

const REFUND_METHOD_LABELS = {
    cash: 'Cash',
    check: 'Check'
};

function normalizeString(value) {
    return String(value || '').trim();
}

function normalizeInvoiceEntries(entries = [], { descriptionKey = 'description', amountKey = 'amount', dateKey = null, requireDescription = false, missingMessage = 'Complete each invoice row before saving.' } = {}) {
    return (entries || [])
        .map((entry) => ({
            description: normalizeString(entry?.[descriptionKey]),
            dueDate: dateKey ? normalizeString(entry?.[dateKey]) : '',
            amountCents: toFeeCents(entry?.[amountKey])
        }))
        .filter((entry) => entry.description || entry.dueDate || entry.amountCents !== null)
        .map((entry) => {
            if ((requireDescription && !entry.description) || (dateKey && !entry.dueDate) || entry.amountCents === null || entry.amountCents <= 0) {
                throw new Error(missingMessage);
            }
            const normalized = { amountCents: entry.amountCents };
            if (requireDescription) normalized.description = entry.description;
            if (dateKey) normalized.dueDate = entry.dueDate;
            return normalized;
        });
}

function sumCents(entries = []) {
    return entries.reduce((total, entry) => total + (Number(entry.amountCents) || 0), 0);
}

export function parseTeamFeeAmountToCents(value) {
    const normalized = normalizeString(value).replace(/[$,]/g, '');
    if (!normalized) return null;

    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount <= 0) return null;

    return Math.round(amount * 100);
}

export function toFeeCents(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = normalizeString(value).replace(/[$,]/g, '');
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Math.round(amount * 100);
}

export function toSignedFeeCents(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = normalizeString(value).replace(/[$,]/g, '');
    const amount = Number(normalized);
    if (!Number.isFinite(amount)) return null;
    return Math.round(amount * 100);
}

export function isTeamFeeAdmin(team, user = {}) {
    if (!team || !user) return false;
    if (user.isAdmin === true) return true;
    if (team.ownerId && user.uid && team.ownerId === user.uid) return true;

    const email = normalizeString(user.email || user.profileEmail).toLowerCase();
    if (!email) return false;

    return (team.adminEmails || [])
        .map((adminEmail) => normalizeString(adminEmail).toLowerCase())
        .includes(email);
}

export function normalizeTeamFeeDraft(formValues = {}) {
    const title = normalizeString(formValues.title);
    const amountCents = parseTeamFeeAmountToCents(formValues.amount);
    const dueDate = normalizeString(formValues.dueDate);
    const notes = normalizeString(formValues.notes);
    const recipientIds = Array.from(new Set((formValues.recipientIds || [])
        .map((id) => normalizeString(id))
        .filter(Boolean)));

    if (!title) throw new Error('Fee title is required.');
    if (!amountCents) throw new Error('Enter an amount greater than $0.');
    if (!dueDate) throw new Error('Due date is required.');
    if (recipientIds.length === 0) throw new Error('Select at least one roster recipient.');

    const lineItems = normalizeInvoiceEntries(formValues.lineItems, {
        requireDescription: true,
        missingMessage: 'Complete each line item description and amount before saving.'
    });
    const installments = normalizeInvoiceEntries(formValues.installments, {
        dateKey: 'dueDate',
        missingMessage: 'Complete each installment due date and amount before saving.'
    });

    if (lineItems.length && sumCents(lineItems) !== amountCents) {
        throw new Error('Line items must add up to the total fee amount.');
    }
    if (installments.length && sumCents(installments) !== amountCents) {
        throw new Error('Installments must add up to the total fee amount.');
    }

    return {
        title,
        amountCents,
        dueDate,
        notes,
        recipientIds,
        lineItems,
        installments,
        collectionMode: 'offline_manual',
        offlinePaymentInstructions: OFFLINE_TEAM_FEE_INSTRUCTIONS
    };
}

export function buildTeamFeeRecipientRecords(draft, players = [], teamId = '') {
    const selectedIds = new Set(draft.recipientIds || []);
    return (players || [])
        .filter((player) => selectedIds.has(player.id))
        .map((player) => ({
            teamId,
            playerId: player.id,
            playerKey: teamId && player.id ? `${teamId}::${player.id}` : '',
            playerName: player.name || player.displayName || 'Roster member',
            playerNumber: player.number || '',
            feeTitle: draft.title,
            amountCents: draft.amountCents,
            dueDate: draft.dueDate,
            notes: draft.notes || '',
            status: 'unpaid',
            collectionMode: 'offline_manual',
            offlinePaymentInstructions: draft.offlinePaymentInstructions || OFFLINE_TEAM_FEE_INSTRUCTIONS,
            lineItems: draft.lineItems || [],
            installments: draft.installments || []
        }));
}

export function normalizeFeeStatus(status) {
    const normalized = normalizeString(status || 'unpaid').toLowerCase();
    return Object.prototype.hasOwnProperty.call(STATUS_LABELS, normalized) ? normalized : 'unpaid';
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

export function getRecipientRefundedCents(recipient) {
    const explicitRefunded = Number(recipient?.refundedAmountCents ?? recipient?.amountRefundedCents ?? recipient?.totalRefundedCents);
    if (Number.isFinite(explicitRefunded) && explicitRefunded >= 0) return Math.round(explicitRefunded);

    const ledger = Array.isArray(recipient?.paymentLedger) ? recipient.paymentLedger : Array.isArray(recipient?.ledgerEntries) ? recipient.ledgerEntries : [];
    return ledger.reduce((total, entry) => {
        if (entry?.type !== 'stripe_refund' && entry?.type !== 'online_refund' && entry?.type !== 'offline_refund') return total;
        const status = normalizeString(entry.status || 'succeeded').toLowerCase();
        if (status === 'failed' || status === 'canceled' || status === 'cancelled') return total;
        const amount = Number(entry.refundAmountCents ?? entry.amountCents ?? 0);
        return total + (Number.isFinite(amount) ? Math.abs(Math.round(amount)) : 0);
    }, 0);
}

export function getRecipientRefundableCents(recipient) {
    return getRecipientPaidCents(recipient);
}

export function getRecipientStripePaymentRefs(recipient) {
    const paymentIntentId = normalizeString(recipient?.stripePaymentIntentId || recipient?.adminBilling?.stripePaymentIntentId);
    const chargeId = normalizeString(recipient?.stripeChargeId || recipient?.stripeLatestChargeId || recipient?.adminBilling?.stripeChargeId || recipient?.adminBilling?.stripeLatestChargeId);
    return { paymentIntentId, chargeId };
}

export function isOnlineRefundEligible(recipient) {
    const { paymentIntentId, chargeId } = getRecipientStripePaymentRefs(recipient);
    const hasPrivateAdminBilling = recipient?.hasAdminBilling === true;
    return recipient?.paymentProvider === 'stripe'
        && Boolean(paymentIntentId || chargeId || hasPrivateAdminBilling)
        && getRecipientRefundableCents(recipient) > 0;
}

export function summarizeFeeRecipients(recipients = []) {
    const summary = {
        totalAssignedCents: 0,
        totalPaidCents: 0,
        totalAdjustedCents: 0,
        totalCanceledCents: 0,
        totalOutstandingCents: 0,
        counts: {
            paid: 0,
            partial: 0,
            unpaid: 0,
            adjusted: 0,
            canceled: 0
        }
    };

    recipients.forEach((recipient) => {
        const status = normalizeFeeStatus(recipient?.status);
        const balance = getRecipientBalanceCents(recipient);
        const paid = getRecipientPaidCents(recipient);
        const assigned = Number(recipient?.amountCents ?? recipient?.originalAmountCents ?? recipient?.assignedAmountCents ?? balance);
        const assignedCents = Number.isFinite(assigned) ? Math.max(0, assigned) : 0;
        summary.counts[status] += 1;
        summary.totalAssignedCents += assignedCents;
        summary.totalPaidCents += paid;
        summary.totalCanceledCents += status === 'canceled' ? assignedCents : 0;
        summary.totalAdjustedCents += status === 'canceled' ? 0 : Math.abs(assignedCents - balance);
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

function formatFeeCsvAmount(cents) {
    const amount = Number(cents);
    return (Number.isFinite(amount) ? amount / 100 : 0).toFixed(2);
}

function getRecipientAssignedCents(recipient) {
    const assigned = Number(recipient?.amountCents ?? recipient?.originalAmountCents ?? recipient?.assignedAmountCents ?? getRecipientBalanceCents(recipient));
    return Number.isFinite(assigned) ? Math.max(0, assigned) : 0;
}

function getRecipientOutstandingCents(recipient, balanceCents = getRecipientBalanceCents(recipient), paidCents = getRecipientPaidCents(recipient)) {
    const status = normalizeFeeStatus(recipient?.status);
    return status === 'paid' || status === 'canceled' ? 0 : Math.max(0, balanceCents - paidCents);
}

function getRecipientLedgerEntries(recipient) {
    return Array.isArray(recipient?.paymentLedger) ? recipient.paymentLedger : Array.isArray(recipient?.ledgerEntries) ? recipient.ledgerEntries : [];
}

function normalizeExportDate(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.slice(0, 10);
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value?.toDate === 'function') return normalizeExportDate(value.toDate());
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000).toISOString().slice(0, 10);
    return '';
}

function getLedgerEntryDate(entry) {
    return normalizeExportDate(entry?.paymentDate || entry?.paidAt || entry?.refundDate || entry?.refundedAt || entry?.createdAt || entry?.date);
}

function getLastActivityDate(recipient, activityTypes) {
    const dates = getRecipientLedgerEntries(recipient)
        .filter((entry) => activityTypes.has(normalizeString(entry?.type).toLowerCase()))
        .map(getLedgerEntryDate)
        .filter(Boolean)
        .sort();
    return dates.at(-1) || '';
}

function getLastPaymentDate(recipient) {
    return normalizeExportDate(recipient?.paidAt || recipient?.manualPayment?.paidAt || recipient?.payment?.paidAt)
        || getLastActivityDate(recipient, new Set(['offline_payment', 'manual_payment', 'stripe_payment', 'online_payment', 'payment']));
}

function getLastRefundDate(recipient) {
    return normalizeExportDate(recipient?.refunded?.refundedAt || recipient?.refunded?.date || recipient?.refund?.refundedAt)
        || getLastActivityDate(recipient, new Set(['offline_refund', 'stripe_refund', 'online_refund', 'refund']));
}

function getRecipientAdminNotes(recipient) {
    return [
        recipient?.notes,
        recipient?.manualPayment?.note,
        recipient?.adjustment?.note,
        recipient?.canceled?.note,
        recipient?.refunded?.note,
        recipient?.adminBilling?.note,
        recipient?.adminBilling?.reason
    ]
        .map(normalizeString)
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index)
        .join(' | ');
}

function getRecipientReference(recipient) {
    return normalizeString(recipient?.reference || recipient?.paymentReference || recipient?.manualPayment?.reference || recipient?.adminBilling?.reference || recipient?.invoiceNumber || recipient?.receiptNumber);
}

export function buildTeamFeePaymentSummaryRows(recipients = []) {
    return (recipients || []).map((recipient) => {
        const balanceCents = getRecipientBalanceCents(recipient);
        const paidCents = getRecipientPaidCents(recipient);
        const refundedCents = getRecipientRefundedCents(recipient);
        return {
            recipientName: getRecipientDisplayName(recipient),
            playerName: recipient?.playerName || recipient?.childName || '',
            playerId: recipient?.playerId || recipient?.playerKey || '',
            status: getStatusLabel(recipient?.status),
            assignedAmount: formatFeeCsvAmount(getRecipientAssignedCents(recipient)),
            paidAmount: formatFeeCsvAmount(paidCents),
            outstandingAmount: formatFeeCsvAmount(getRecipientOutstandingCents(recipient, balanceCents, paidCents)),
            refundedAmount: formatFeeCsvAmount(refundedCents),
            dueDate: recipient?.dueDate || '',
            collectionMode: recipient?.collectionMode || '',
            lastPaymentDate: getLastPaymentDate(recipient),
            lastRefundDate: getLastRefundDate(recipient),
            adminNotes: getRecipientAdminNotes(recipient),
            reference: getRecipientReference(recipient)
        };
    });
}

const PAYMENT_SUMMARY_CSV_COLUMNS = [
    ['Recipient name', 'recipientName'],
    ['Player name', 'playerName'],
    ['Player ID', 'playerId'],
    ['Status', 'status'],
    ['Assigned amount', 'assignedAmount'],
    ['Paid amount', 'paidAmount'],
    ['Outstanding amount', 'outstandingAmount'],
    ['Refunded amount', 'refundedAmount'],
    ['Due date', 'dueDate'],
    ['Collection mode', 'collectionMode'],
    ['Last payment date', 'lastPaymentDate'],
    ['Last refund date', 'lastRefundDate'],
    ['Admin notes', 'adminNotes'],
    ['Reference', 'reference']
];

export function escapeCsvValue(value) {
    const text = value === null || value === undefined ? '' : String(value);
    const sanitized = /^(?:\s)*[=+\-@]/.test(text) || /\|(?:\s)*[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(sanitized) ? `"${sanitized.replace(/"/g, '""')}"` : sanitized;
}

export function serializeTeamFeePaymentSummaryCsv(rows = []) {
    const header = PAYMENT_SUMMARY_CSV_COLUMNS.map(([label]) => escapeCsvValue(label)).join(',');
    const lines = (rows || []).map((row) => PAYMENT_SUMMARY_CSV_COLUMNS
        .map(([, key]) => escapeCsvValue(row?.[key]))
        .join(','));
    return [header, ...lines].join('\n');
}

export function buildTeamFeePaymentSummaryCsv(recipients = []) {
    return serializeTeamFeePaymentSummaryCsv(buildTeamFeePaymentSummaryRows(recipients));
}

function buildPaymentSummaryFilename({ teamId = '', batchId = '', batch = {}, date = new Date() } = {}) {
    const title = normalizeString(batch.title || batch.feeTitle || batch.name || batchId || 'team-fee');
    const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'team-fee';
    const safeTeam = normalizeString(teamId).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 32) || 'team';
    const exportDate = normalizeExportDate(date) || new Date().toISOString().slice(0, 10);
    return `${safeTeam}-${safeTitle}-payment-summary-${exportDate}.csv`;
}

function downloadTextFile(filename, contents, mimeType = 'text/csv;charset=utf-8') {
    const blob = new Blob([contents], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function normalizeLedgerStatus(balanceCents, paidCents) {
    const balance = Math.max(0, Number(balanceCents) || 0);
    const paid = Math.max(0, Number(paidCents) || 0);
    if (balance === 0 || paid >= balance) return 'paid';
    if (paid > 0) return 'partial';
    return 'unpaid';
}

function assertManualPaymentWithinRemainingBalance(paymentAmountCents, balanceCents, priorPaidCents) {
    if (!Number.isFinite(balanceCents)) return;
    const remainingBalanceCents = Math.max(0, balanceCents - priorPaidCents);
    if (paymentAmountCents > remainingBalanceCents) {
        throw new Error('Manual payment amount cannot exceed the remaining balance.');
    }
}

export function buildManualPaymentUpdate({ amount, date, note, actorId, currentBalanceCents, currentPaidCents }) {
    const paymentAmountCents = toFeeCents(amount);
    if (paymentAmountCents === null || paymentAmountCents <= 0) {
        throw new Error('Enter a manual payment amount greater than $0.');
    }
    if (!date) throw new Error('Enter a manual payment date.');

    const currentBalance = Number(currentBalanceCents);
    const balanceCents = Number.isFinite(currentBalance) ? Math.max(0, currentBalance) : Number.MAX_SAFE_INTEGER;
    const priorPaid = Number(currentPaidCents);
    const priorPaidCents = Number.isFinite(priorPaid) ? Math.max(0, priorPaid) : 0;
    assertManualPaymentWithinRemainingBalance(paymentAmountCents, balanceCents, priorPaidCents);
    const amountPaidCents = priorPaidCents + paymentAmountCents;
    const remainingBalanceCents = Math.max(0, balanceCents - amountPaidCents);
    const status = normalizeLedgerStatus(balanceCents, amountPaidCents);
    const noteText = normalizeString(note);
    const ledgerEntry = {
        type: 'offline_payment',
        amountCents: paymentAmountCents,
        paymentDate: date
    };

    return {
        status,
        amountPaidCents,
        remainingBalanceCents,
        paidAt: status === 'paid' ? date : null,
        manualPayment: {
            amountPaidCents: paymentAmountCents,
            paidAt: date
        },
        ledgerEntries: [ledgerEntry],
        adminBilling: {
            type: 'offline_payment',
            amountPaidCents: paymentAmountCents,
            paidAt: date,
            note: noteText,
            recordedBy: actorId || null
        }
    };
}

export function buildBalanceAdjustmentUpdate({ amount, note, actorId, currentBalanceCents, currentPaidCents }) {
    const adjustmentCents = toSignedFeeCents(amount);
    const reason = normalizeString(note);
    if (adjustmentCents === null || adjustmentCents === 0) {
        throw new Error('Enter a positive or negative adjustment amount.');
    }
    if (!reason) throw new Error('Enter an adjustment reason.');

    const currentBalance = Number(currentBalanceCents);
    const priorBalanceCents = Number.isFinite(currentBalance) ? Math.max(0, currentBalance) : 0;
    const paid = Number(currentPaidCents);
    const amountPaidCents = Number.isFinite(paid) ? Math.max(0, paid) : 0;
    const amountDueCents = Math.max(0, priorBalanceCents - adjustmentCents);
    const remainingBalanceCents = Math.max(0, amountDueCents - amountPaidCents);
    const status = normalizeLedgerStatus(amountDueCents, amountPaidCents);
    const ledgerEntry = {
        type: 'balance_adjustment',
        amountCents: adjustmentCents,
        previousAmountDueCents: priorBalanceCents,
        amountDueCents
    };

    return {
        status,
        amountDueCents,
        remainingBalanceCents,
        adjustment: {
            amountCents: adjustmentCents,
            previousAmountDueCents: priorBalanceCents,
            amountDueCents
        },
        ledgerEntries: [ledgerEntry],
        adminBilling: {
            type: 'balance_adjustment',
            amountCents: adjustmentCents,
            previousAmountDueCents: priorBalanceCents,
            amountDueCents,
            reason,
            adjustedBy: actorId || null
        }
    };
}

export function buildOfflineRefundUpdate({ refundType = 'full', amount, method, note, actorId, currentBalanceCents, currentPaidCents }) {
    const priorPaid = Number(currentPaidCents);
    const priorPaidCents = Number.isFinite(priorPaid) ? Math.max(0, priorPaid) : 0;
    if (priorPaidCents <= 0) {
        throw new Error('Only recipients with recorded payments can be refunded.');
    }

    const normalizedType = normalizeString(refundType).toLowerCase() === 'partial' ? 'partial' : 'full';
    const refundAmountCents = normalizedType === 'full' ? priorPaidCents : toFeeCents(amount);
    if (refundAmountCents === null || refundAmountCents <= 0) {
        throw new Error('Enter a refund amount greater than $0.');
    }
    if (refundAmountCents > priorPaidCents) {
        throw new Error('Refund amount cannot exceed the recorded paid amount.');
    }

    const refundMethod = normalizeString(method).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(REFUND_METHOD_LABELS, refundMethod)) {
        throw new Error('Select cash or check as the refund method.');
    }

    const adminNote = normalizeString(note);
    if (!adminNote) throw new Error('Enter an admin note for the refund.');

    const currentBalance = Number(currentBalanceCents);
    const balanceCents = Number.isFinite(currentBalance) ? Math.max(0, currentBalance) : 0;
    const amountPaidCents = Math.max(0, priorPaidCents - refundAmountCents);
    const remainingBalanceCents = Math.max(0, balanceCents - amountPaidCents);
    const status = normalizeLedgerStatus(balanceCents, amountPaidCents);
    const ledgerEntry = {
        type: 'offline_refund',
        amountCents: -refundAmountCents,
        refundAmountCents,
        refundType: normalizedType,
        refundMethod,
        methodLabel: REFUND_METHOD_LABELS[refundMethod]
    };

    return {
        status,
        amountPaidCents,
        remainingBalanceCents,
        ...(status === 'paid' ? {} : { paidAt: null }),
        refunded: {
            amountCents: refundAmountCents,
            refundType: normalizedType,
            refundMethod
        },
        ledgerEntries: [ledgerEntry],
        adminBilling: {
            type: 'offline_refund',
            refundAmountCents,
            refundType: normalizedType,
            refundMethod,
            methodLabel: REFUND_METHOD_LABELS[refundMethod],
            note: adminNote,
            recordedBy: actorId || null
        }
    };
}

export function buildCancelRecipientUpdate({ note, actorId }) {
    const reason = normalizeString(note);
    const ledgerEntry = {
        type: 'cancellation',
        amountCents: 0,
        reason,
        canceledBy: actorId || null
    };

    return {
        status: 'canceled',
        amountDueCents: 0,
        remainingBalanceCents: 0,
        canceled: {
            note: reason,
            canceledBy: actorId || null
        },
        ledgerEntries: [ledgerEntry]
    };
}

export function buildOnlineRefundRequest({ amount, reason, teamId, batchId, recipientId }) {
    const amountCents = toFeeCents(amount);
    if (amountCents === null || amountCents <= 0) {
        throw new Error('Enter a refund amount greater than $0.');
    }
    const refundRequestId = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `refund_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return {
        teamId: normalizeString(teamId),
        batchId: normalizeString(batchId),
        recipientId: normalizeString(recipientId),
        amountCents,
        reason: normalizeString(reason),
        refundRequestId
    };
}

export async function submitOnlineTeamFeeRefund(request) {
    const { getFunctions, httpsCallable } = await import('./firebase.js?v=19');
    const functions = getFunctions();
    const refundTeamFee = httpsCallable(functions, 'refundStripeTeamFeePayment');
    const result = await refundTeamFee(request);
    return result?.data || {};
}

export function getRecipientDisplayName(recipient) {
    return recipient?.playerName || recipient?.childName || recipient?.name || recipient?.parentName || recipient?.parentEmail || 'Recipient';
}

export function getStatusLabel(status) {
    return STATUS_LABELS[normalizeFeeStatus(status)];
}

function renderRosterOptions(players) {
    if (!players.length) {
        return '<p class="text-sm text-gray-500">No active roster members found for this team.</p>';
    }

    return players.map((player) => `
        <label class="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 hover:border-primary-300">
            <input type="checkbox" name="recipients" value="${escapeHtml(player.id)}" class="h-4 w-4 rounded border-gray-300 text-primary-600" checked>
            <span class="flex-1">
                <span class="block font-semibold text-gray-900">${escapeHtml(player.name || player.displayName || 'Roster member')}</span>
                ${player.number ? `<span class="text-xs text-gray-500">#${escapeHtml(player.number)}</span>` : ''}
            </span>
        </label>
    `).join('');
}

function showMessage(message, type = 'info') {
    const el = document.getElementById('fee-message');
    if (!el) return null;

    const colors = type === 'error'
        ? 'border-red-200 bg-red-50 text-red-700'
        : type === 'success'
            ? 'border-green-200 bg-green-50 text-green-700'
            : 'border-blue-200 bg-blue-50 text-blue-700';

    el.className = `rounded-xl border p-4 text-sm ${colors}`;
    el.textContent = message;
    el.classList.remove('hidden');
    return el;
}

function showHtmlMessage(html, type = 'info') {
    const el = showMessage('', type);
    if (!el) return;
    el.innerHTML = html;
}

function collectFormValues(form) {
    return {
        title: form.elements.title.value,
        amount: form.elements.amount.value,
        dueDate: form.elements.dueDate.value,
        notes: form.elements.notes.value,
        recipientIds: Array.from(form.querySelectorAll('input[name="recipients"]:checked')).map((input) => input.value),
        lineItems: Array.from(form.querySelectorAll('[data-line-item-row]')).map((row) => ({
            description: row.querySelector('[name="lineItemDescription"]')?.value,
            amount: row.querySelector('[name="lineItemAmount"]')?.value
        })),
        installments: Array.from(form.querySelectorAll('[data-installment-row]')).map((row) => ({
            dueDate: row.querySelector('[name="installmentDueDate"]')?.value,
            amount: row.querySelector('[name="installmentAmount"]')?.value
        }))
    };
}

function renderInvoiceRow(type) {
    if (type === 'lineItem') {
        return `
            <div data-line-item-row class="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 md:grid-cols-[1fr_10rem_auto]">
                <input name="lineItemDescription" type="text" placeholder="Description" class="rounded-lg border-gray-300 text-sm" aria-label="Line item description">
                <input name="lineItemAmount" type="number" min="0.01" step="0.01" placeholder="0.00" class="rounded-lg border-gray-300 text-sm" aria-label="Line item amount">
                <button type="button" data-remove-row class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-white">Remove</button>
            </div>
        `;
    }

    return `
        <div data-installment-row class="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 md:grid-cols-[1fr_10rem_auto]">
            <input name="installmentDueDate" type="date" class="rounded-lg border-gray-300 text-sm" aria-label="Installment due date">
            <input name="installmentAmount" type="number" min="0.01" step="0.01" placeholder="0.00" class="rounded-lg border-gray-300 text-sm" aria-label="Installment amount">
            <button type="button" data-remove-row class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-white">Remove</button>
        </div>
    `;
}

export function buildTeamFeeBatchManageUrl(teamId, batchId) {
    return `team-fees.html#teamId=${encodeURIComponent(teamId)}&batchId=${encodeURIComponent(batchId)}`;
}

export function renderCreatedTeamFeeBatchSuccess(teamId, batchId) {
    const manageUrl = buildTeamFeeBatchManageUrl(teamId, batchId);
    return `
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>Fee batch saved with unpaid recipient records. Batch ID: ${escapeHtml(batchId)}</span>
            <a href="${escapeHtml(manageUrl)}" class="rounded-lg bg-green-700 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-green-800">Manage this fee</a>
        </div>
    `;
}

export function renderTeamFeeBatchList(batches = [], teamId = '') {
    if (!batches.length) return '';

    return `
        <section class="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 class="text-lg font-bold text-gray-900">Existing fee batches</h2>
                    <p class="text-sm text-gray-500">Open a saved batch to record manual payments, adjustments, or cancellations.</p>
                </div>
                <span class="text-xs font-semibold uppercase tracking-wide text-gray-400">Latest 25</span>
            </div>
            <div class="mt-4 divide-y divide-gray-100">
                ${batches.map((batch) => {
                    const title = batch.title || batch.feeTitle || batch.name || 'Team fee';
                    const amount = formatFeeCurrency(batch.amountCents ?? batch.totalAmountCents ?? 0);
                    const recipientCount = Number(batch.recipientCount || 0);
                    const dueDate = batch.dueDate ? ` · Due ${escapeHtml(batch.dueDate)}` : '';
                    const status = batch.status ? ` · ${escapeHtml(batch.status)}` : '';
                    const manageUrl = buildTeamFeeBatchManageUrl(teamId, batch.id);
                    return `
                        <a href="${escapeHtml(manageUrl)}" class="flex flex-col gap-2 py-3 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between">
                            <span>
                                <span class="block font-semibold text-gray-900">${escapeHtml(title)}</span>
                                <span class="text-sm text-gray-500">${amount} · ${recipientCount} recipient${recipientCount === 1 ? '' : 's'}${dueDate}${status}</span>
                            </span>
                            <span class="text-sm font-semibold text-primary-600">Manage</span>
                        </a>
                    `;
                }).join('')}
            </div>
        </section>
    `;
}

function renderSummary(container, recipients) {
    const summary = summarizeFeeRecipients(recipients);
    const cards = [
        ['Total assigned', formatFeeCurrency(summary.totalAssignedCents)],
        ['Total paid', formatFeeCurrency(summary.totalPaidCents)],
        ['Adjusted', formatFeeCurrency(summary.totalAdjustedCents)],
        ['Canceled', formatFeeCurrency(summary.totalCanceledCents)],
        ['Outstanding', formatFeeCurrency(summary.totalOutstandingCents)],
        ['Status counts', `${summary.counts.paid} paid · ${summary.counts.partial} partial · ${summary.counts.unpaid} unpaid · ${summary.counts.canceled} canceled`]
    ];
    container.innerHTML = cards.map(([label, value]) => `
        <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div class="text-xs uppercase tracking-wide text-gray-500 font-semibold">${label}</div>
            <div class="mt-1 text-xl font-bold text-gray-900">${value}</div>
        </div>
    `).join('');
}

function renderRefundModal() {
    return `
        <div id="refund-modal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="refund-modal-title">
            <form id="refund-form" class="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
                <div class="flex items-start justify-between gap-4">
                    <div>
                        <h2 id="refund-modal-title" class="text-xl font-bold text-gray-900">Record offline refund</h2>
                        <p id="refund-modal-subtitle" class="mt-1 text-sm text-gray-600">Choose the offline refund details to record in the ledger.</p>
                    </div>
                    <button type="button" data-refund-close class="rounded-lg px-2 py-1 text-sm font-semibold text-gray-500 hover:bg-gray-100">Close</button>
                </div>

                <div class="mt-5 space-y-4">
                    <fieldset>
                        <legend class="text-sm font-semibold text-gray-700">Refund amount</legend>
                        <div class="mt-2 grid gap-2 sm:grid-cols-2">
                            <label class="rounded-xl border border-gray-200 p-3 text-sm font-semibold text-gray-700">
                                <input type="radio" name="refundType" value="full" checked class="mr-2"> Full refund
                            </label>
                            <label class="rounded-xl border border-gray-200 p-3 text-sm font-semibold text-gray-700">
                                <input type="radio" name="refundType" value="partial" class="mr-2"> Partial refund
                            </label>
                        </div>
                    </fieldset>
                    <label class="block">
                        <span class="text-sm font-semibold text-gray-700">Partial amount</span>
                        <input name="amount" type="number" min="0.01" step="0.01" class="mt-1 w-full rounded-lg border-gray-300 text-sm" aria-label="Refund amount">
                    </label>
                    <label class="block">
                        <span class="text-sm font-semibold text-gray-700">Refund method</span>
                        <select name="method" required class="mt-1 w-full rounded-lg border-gray-300 text-sm">
                            <option value="cash">Offline cash</option>
                            <option value="check">Offline check</option>
                        </select>
                    </label>
                    <label class="block">
                        <span class="text-sm font-semibold text-gray-700">Admin note</span>
                        <textarea name="note" required rows="3" placeholder="Required refund note" class="mt-1 w-full rounded-lg border-gray-300 text-sm"></textarea>
                    </label>
                </div>

                <div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button type="button" data-refund-close class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
                    <button type="submit" class="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">Record refund</button>
                </div>
            </form>
        </div>
    `;
}

function renderRecipients(container, countEl, recipients) {
    countEl.textContent = `${recipients.length} assigned recipient${recipients.length === 1 ? '' : 's'}`;
    if (recipients.length === 0) {
        container.innerHTML = '<div class="p-6 text-sm text-gray-500">No recipients are assigned to this fee batch.</div>';
        return;
    }

    container.innerHTML = recipients.map((recipient) => {
        const name = escapeHtml(getRecipientDisplayName(recipient));
        const status = getStatusLabel(recipient.status);
        const assigned = formatFeeCurrency(recipient.amountCents ?? recipient.originalAmountCents ?? recipient.assignedAmountCents ?? 0);
        const balanceCents = getRecipientBalanceCents(recipient);
        const paidCents = getRecipientPaidCents(recipient);
        const outstandingCents = recipient.status === 'paid' || recipient.status === 'canceled' ? 0 : Math.max(0, balanceCents - paidCents);
        const balance = formatFeeCurrency(balanceCents);
        const paid = formatFeeCurrency(paidCents);
        const outstanding = formatFeeCurrency(outstandingCents);
        const refundableCents = getRecipientRefundableCents(recipient);
        const canRefundOnline = isOnlineRefundEligible(recipient);
        const note = recipient.manualPayment?.note || recipient.adjustment?.note || recipient.canceled?.note || recipient.adminBilling?.note || recipient.adminBilling?.reason || recipient.notes || '';
        return `
            <article class="p-5" data-recipient-id="${escapeHtml(recipient.id)}" data-balance-cents="${balanceCents}" data-paid-cents="${paidCents}" data-status="${escapeHtml(normalizeFeeStatus(recipient.status))}">
                <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div>
                        <div class="flex items-center gap-2 flex-wrap">
                            <h3 class="font-bold text-gray-900">${name}</h3>
                            <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-700">${status}</span>
                        </div>
                        <div class="mt-1 text-sm text-gray-500">Assigned ${assigned} · Balance ${balance} · Paid ${paid} · Outstanding ${outstanding}</div>
                        ${note ? `<p class="mt-2 text-sm text-gray-600">${escapeHtml(note)}</p>` : ''}
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 w-full lg:max-w-7xl">
                        <form data-action="paid" class="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
                            <div class="text-xs font-bold uppercase tracking-wide text-gray-500">Manual payment</div>
                            <input name="amount" type="number" min="0" max="${(outstandingCents / 100).toFixed(2)}" step="0.01" value="${(outstandingCents / 100).toFixed(2)}" class="w-full rounded-lg border-gray-300 text-sm" aria-label="Payment amount">
                            <input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" class="w-full rounded-lg border-gray-300 text-sm" aria-label="Payment date">
                            <input name="note" type="text" placeholder="Optional note" class="w-full rounded-lg border-gray-300 text-sm" aria-label="Payment note">
                            <button class="w-full rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700">Mark paid</button>
                        </form>
                        <form data-action="adjust" class="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
                            <div class="text-xs font-bold uppercase tracking-wide text-gray-500">Adjust balance</div>
                            <input name="amount" type="number" step="0.01" placeholder="20.00 credit or -5.00 charge" class="w-full rounded-lg border-gray-300 text-sm" aria-label="Balance adjustment amount">
                            <p class="text-xs text-gray-500">Positive amounts credit the account and reduce what is owed. Negative amounts add a charge.</p>
                            <input name="note" type="text" required placeholder="Required reason" class="w-full rounded-lg border-gray-300 text-sm" aria-label="Adjustment reason">
                            <button class="w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700">Save adjustment</button>
                        </form>
                        ${canRefundOnline ? `
                            <form data-action="refund" class="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-2">
                                <div class="text-xs font-bold uppercase tracking-wide text-blue-700">Online refund</div>
                                <input name="amount" type="number" min="0" max="${(refundableCents / 100).toFixed(2)}" step="0.01" value="${(refundableCents / 100).toFixed(2)}" class="w-full rounded-lg border-gray-300 text-sm" aria-label="Refund amount">
                                <input name="reason" type="text" placeholder="Optional reason" class="w-full rounded-lg border-gray-300 text-sm" aria-label="Refund reason">
                                <button class="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">Issue refund</button>
                            </form>
                        ` : ''}
                        <div class="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
                            <div class="text-xs font-bold uppercase tracking-wide text-gray-500">Refund</div>
                            <p class="text-xs text-gray-500">Record offline cash/check refunds only.</p>
                            <button type="button" data-refund-action class="w-full rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300" ${paidCents > 0 && recipient.status !== 'canceled' ? '' : 'disabled'}>Refund</button>
                        </div>
                        <form data-action="cancel" class="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
                            <div class="text-xs font-bold uppercase tracking-wide text-gray-500">Cancel recipient</div>
                            <input name="note" type="text" placeholder="Reason" class="w-full rounded-lg border-gray-300 text-sm" aria-label="Cancellation note">
                            <button class="w-full rounded-lg bg-gray-700 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800">Cancel balance</button>
                        </form>
                    </div>
                </div>
            </article>
        `;
    }).join('');
}

function canManageTeamFees(team, user, canModerateChat) {
    return isTeamFeeAdmin(team, user) || canModerateChat(user, team);
}

async function renderCreateMode({ container, teamId, team, user, getPlayers, createTeamFeeBatch, listTeamFeeBatches }) {
    const [players, existingBatches] = await Promise.all([
        getPlayers(teamId),
        listTeamFeeBatches ? listTeamFeeBatches(teamId).catch((error) => {
            console.warn('[team-fees] Unable to load fee batches:', error);
            return [];
        }) : []
    ]);
    container.innerHTML = `
        <div class="mb-6">
            <a href="dashboard.html" class="text-sm font-semibold text-primary-600 hover:text-primary-700">Back to My Teams</a>
            <h1 class="mt-3 text-3xl font-bold text-gray-900">Create offline team fee</h1>
            <p class="mt-2 text-gray-600">${escapeHtml(team.name || 'Team')} fee batches are for manual collection only.</p>
        </div>

        <div class="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
            <p class="font-bold">${OFFLINE_TEAM_FEE_LABEL}</p>
            <p class="mt-1 text-sm">No credit card, Stripe, checkout, email, push, or SMS workflow is created. This only records unpaid roster fee assignments.</p>
        </div>

        ${renderTeamFeeBatchList(existingBatches, teamId)}

        <form id="team-fee-form" class="rounded-2xl border border-gray-200 bg-white p-6 shadow-md">
            <div id="fee-message" class="hidden"></div>
            <div class="mt-4 grid gap-4 md:grid-cols-2">
                <label class="block">
                    <span class="text-sm font-semibold text-gray-700">Title</span>
                    <input name="title" type="text" required placeholder="Tournament dues" class="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none">
                </label>
                <label class="block">
                    <span class="text-sm font-semibold text-gray-700">Amount</span>
                    <input name="amount" type="number" min="0.01" step="0.01" required placeholder="25.00" class="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none">
                </label>
                <label class="block">
                    <span class="text-sm font-semibold text-gray-700">Due date</span>
                    <input name="dueDate" type="date" required class="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none">
                </label>
                <label class="block md:col-span-2">
                    <span class="text-sm font-semibold text-gray-700">Notes <span class="font-normal text-gray-500">optional</span></span>
                    <textarea name="notes" rows="3" placeholder="Cash/check instructions, what this covers, or who to contact." class="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none"></textarea>
                </label>
            </div>

            <div class="mt-6">
                <div class="mb-3 flex items-center justify-between gap-3">
                    <h2 class="text-lg font-bold text-gray-900">Recipients</h2>
                    <span class="text-sm text-gray-500">Selected recipients will be saved as unpaid.</span>
                </div>
                <div class="grid gap-3 md:grid-cols-2">${renderRosterOptions(players)}</div>
            </div>

            <details id="advanced-invoice-details" class="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <summary class="cursor-pointer text-lg font-bold text-gray-900">Advanced invoice details <span class="text-sm font-normal text-gray-500">optional</span></summary>
                <p class="mt-2 text-sm text-gray-500">Add invoice line items or installment schedules only when this fee needs extra detail. If used, each section must total the fee amount.</p>
                <div class="mt-4 grid gap-4 lg:grid-cols-2">
                    <section class="rounded-2xl border border-gray-200 bg-white p-4">
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <h2 class="font-bold text-gray-900">Invoice line items <span class="text-sm font-normal text-gray-500">optional</span></h2>
                                <p class="mt-1 text-sm text-gray-500">Add descriptions and amounts when this fee should look like an invoice. If used, items must total the fee amount.</p>
                            </div>
                            <button type="button" id="add-line-item" class="shrink-0 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800">Add item</button>
                        </div>
                        <div id="line-items-list" class="mt-4 space-y-3"></div>
                    </section>
                    <section class="rounded-2xl border border-gray-200 bg-white p-4">
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <h2 class="font-bold text-gray-900">Installment schedule <span class="text-sm font-normal text-gray-500">optional</span></h2>
                                <p class="mt-1 text-sm text-gray-500">Add due dates and amounts for planned installments. If used, installments must total the fee amount.</p>
                            </div>
                            <button type="button" id="add-installment" class="shrink-0 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800">Add installment</button>
                        </div>
                        <div id="installments-list" class="mt-4 space-y-3"></div>
                    </section>
                </div>
            </details>

            <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                <a href="dashboard.html" class="rounded-xl border border-gray-300 px-5 py-3 text-center font-semibold text-gray-700 hover:bg-gray-50">Cancel</a>
                <button type="submit" class="rounded-xl bg-primary-600 px-5 py-3 font-semibold text-white shadow hover:bg-primary-700">Save unpaid fee records</button>
            </div>
        </form>
    `;

    const form = document.getElementById('team-fee-form');
    const advancedInvoiceDetails = document.getElementById('advanced-invoice-details');
    const lineItemsList = document.getElementById('line-items-list');
    const installmentsList = document.getElementById('installments-list');

    document.getElementById('add-line-item')?.addEventListener('click', () => {
        lineItemsList.insertAdjacentHTML('beforeend', renderInvoiceRow('lineItem'));
    });

    document.getElementById('add-installment')?.addEventListener('click', () => {
        installmentsList.insertAdjacentHTML('beforeend', renderInvoiceRow('installment'));
    });

    form.addEventListener('click', (event) => {
        const button = event.target.closest('[data-remove-row]');
        if (button) button.closest('[data-line-item-row], [data-installment-row]')?.remove();
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        button.textContent = 'Saving...';

        try {
            const draft = normalizeTeamFeeDraft(collectFormValues(form));
            const recipients = buildTeamFeeRecipientRecords(draft, players, teamId);
            if (recipients.length !== draft.recipientIds.length) {
                throw new Error('One or more selected recipients are no longer on the active roster.');
            }

            const batch = await createTeamFeeBatch(teamId, draft, recipients, user);
            form.reset();
            advancedInvoiceDetails.open = false;
            lineItemsList.innerHTML = '';
            installmentsList.innerHTML = '';
            showHtmlMessage(renderCreatedTeamFeeBatchSuccess(teamId, batch.id), 'success');
        } catch (error) {
            showMessage(error?.message || 'Unable to save fee batch.', 'error');
        } finally {
            button.disabled = false;
            button.textContent = 'Save unpaid fee records';
        }
    });
}

async function renderManageMode({ container, teamId, batchId, team, user, getTeamFeeBatch, listTeamFeeRecipients, updateTeamFeeRecipient }) {
    container.innerHTML = `
        <div class="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
                <a href="team.html?id=${encodeURIComponent(teamId)}" class="text-sm font-semibold text-primary-600 hover:text-primary-700">Back to team</a>
                <h1 id="page-title" class="mt-2 text-3xl font-bold text-gray-900">Manage team fee</h1>
                <p id="page-subtitle" class="mt-1 text-sm text-gray-600">Review assigned recipients, record offline payments, and adjust balances.</p>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button id="export-payment-summary-btn" type="button" disabled class="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-gray-300">Export payment summary</button>
                <button id="refresh-btn" type="button" class="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-700 border border-gray-200 shadow-sm hover:bg-gray-50">Refresh</button>
            </div>
        </div>

        <div id="fee-message" class="mb-4 hidden rounded-xl border px-4 py-3 text-sm"></div>
        ${renderRefundModal()}
        <section id="summary-cards" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6"></section>
        <section class="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
            <div class="px-5 py-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                    <h2 class="text-lg font-bold text-gray-900">Recipients</h2>
                    <p id="recipient-count" class="text-sm text-gray-500">Loading recipients...</p>
                </div>
            </div>
            <div id="recipients-list" class="divide-y divide-gray-100">
                <div class="p-6 text-sm text-gray-500">Loading...</div>
            </div>
        </section>
    `;

    const title = document.getElementById('page-title');
    const subtitle = document.getElementById('page-subtitle');
    const summary = document.getElementById('summary-cards');
    const count = document.getElementById('recipient-count');
    const list = document.getElementById('recipients-list');
    const refundModal = document.getElementById('refund-modal');
    const refundForm = document.getElementById('refund-form');
    const refundSubtitle = document.getElementById('refund-modal-subtitle');
    const exportButton = document.getElementById('export-payment-summary-btn');
    let currentBatch = null;
    let currentRecipients = [];

    async function loadBatch() {
        exportButton.disabled = true;
        const batch = await getTeamFeeBatch(teamId, batchId);
        if (!batch) throw new Error('Fee batch not found.');
        title.textContent = batch.title || batch.feeTitle || batch.name || 'Manage team fee';
        subtitle.textContent = `${team.name || 'Team'} · Offline payment tracking`;
        const recipients = await listTeamFeeRecipients(teamId, batchId);
        currentBatch = batch;
        currentRecipients = recipients;
        renderSummary(summary, recipients);
        renderRecipients(list, count, recipients);
        exportButton.disabled = false;
    }

    function closeRefundModal() {
        refundModal?.classList.add('hidden');
        refundModal?.classList.remove('flex');
        refundForm?.reset();
    }

    list.addEventListener('click', (event) => {
        const button = event.target.closest('[data-refund-action]');
        if (!button) return;
        const article = button.closest('[data-recipient-id]');
        if (!article || !refundModal || !refundForm) return;
        refundForm.dataset.recipientId = article.dataset.recipientId || '';
        refundForm.dataset.balanceCents = article.dataset.balanceCents || '0';
        refundForm.dataset.paidCents = article.dataset.paidCents || '0';
        if (refundSubtitle) {
            const paidAmount = formatFeeCurrency(article.dataset.paidCents || 0);
            refundSubtitle.textContent = `Record an offline refund up to ${paidAmount}. This does not contact Stripe or move money.`;
        }
        refundModal.classList.remove('hidden');
        refundModal.classList.add('flex');
    });

    refundModal?.addEventListener('click', (event) => {
        if (event.target === refundModal || event.target.closest('[data-refund-close]')) {
            closeRefundModal();
        }
    });

    refundForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(refundForm).entries());
        const button = refundForm.querySelector('button[type="submit"]');
        button.disabled = true;
        button.textContent = 'Recording...';
        try {
            const updates = buildOfflineRefundUpdate({
                ...data,
                actorId: user.uid,
                currentBalanceCents: refundForm.dataset.balanceCents,
                currentPaidCents: refundForm.dataset.paidCents
            });
            await updateTeamFeeRecipient(teamId, batchId, refundForm.dataset.recipientId, updates);
            closeRefundModal();
            showMessage('Offline refund recorded.', 'success');
            await loadBatch();
        } catch (error) {
            showMessage(error?.message || 'Unable to record refund.', 'error');
        } finally {
            button.disabled = false;
            button.textContent = 'Record refund';
        }
    });

    list.addEventListener('submit', async (event) => {
        const form = event.target.closest('form[data-action]');
        if (!form) return;
        event.preventDefault();

        const article = form.closest('[data-recipient-id]');
        const recipientId = article?.dataset?.recipientId;
        const data = Object.fromEntries(new FormData(form).entries());
        let updates;

        try {
            if (form.dataset.action === 'paid') {
                updates = buildManualPaymentUpdate({ ...data, actorId: user.uid, currentBalanceCents: article?.dataset?.balanceCents, currentPaidCents: article?.dataset?.paidCents, currentStatus: article?.dataset?.status });
                await updateTeamFeeRecipient(teamId, batchId, recipientId, updates);
            } else if (form.dataset.action === 'adjust') {
                updates = buildBalanceAdjustmentUpdate({ ...data, actorId: user.uid, currentBalanceCents: article?.dataset?.balanceCents, currentPaidCents: article?.dataset?.paidCents });
                await updateTeamFeeRecipient(teamId, batchId, recipientId, updates);
            } else if (form.dataset.action === 'refund') {
                await submitOnlineTeamFeeRefund(buildOnlineRefundRequest({ ...data, teamId, batchId, recipientId }));
            } else {
                updates = buildCancelRecipientUpdate({ ...data, actorId: user.uid });
                await updateTeamFeeRecipient(teamId, batchId, recipientId, updates);
            }
            showMessage(form.dataset.action === 'refund' ? 'Stripe refund submitted.' : 'Fee recipient updated.', 'success');
            await loadBatch();
        } catch (error) {
            showMessage(error?.message || 'Unable to update fee recipient.', 'error');
        }
    });

    exportButton.addEventListener('click', () => {
        const csv = buildTeamFeePaymentSummaryCsv(currentRecipients);
        const filename = buildPaymentSummaryFilename({ teamId, batchId, batch: currentBatch });
        downloadTextFile(filename, csv);
    });

    document.getElementById('refresh-btn').addEventListener('click', () => {
        loadBatch().catch((error) => showMessage(error?.message || 'Unable to load fee batch.', 'error'));
    });

    await loadBatch();
}

async function initTeamFeesAdminPage() {
    if (typeof document === 'undefined') return;

    const container = document.getElementById('team-fees-admin-root');
    if (!container) return;

    renderFooter(document.getElementById('footer-container'));

    const [{ getTeam, getPlayers, getUserProfile, createTeamFeeBatch, getTeamFeeBatch, listTeamFeeBatches, listTeamFeeRecipients, updateTeamFeeRecipient, canModerateChat }, { requireAuth }] = await Promise.all([
        import('./db.js?v=63'),
        import('./auth.js?v=32')
    ]);

    try {
        const user = await requireAuth();
        let profile = null;
        try {
            profile = await getUserProfile(user.uid);
            if (profile?.isAdmin) user.isAdmin = true;
            if (profile?.email) user.profileEmail = profile.email;
        } catch (error) {
            console.warn('[team-fees] Unable to load profile:', error);
        }

        renderHeader(document.getElementById('header-container'), user);

        const params = getUrlParams();
        const teamId = params.teamId || '';
        const batchId = params.batchId || params.feeBatchId || '';
        if (!teamId) {
            container.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">Missing teamId.</div>';
            return;
        }

        const team = await getTeam(teamId, { includeInactive: true });
        if (!team) {
            container.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">Team not found.</div>';
            return;
        }

        if (!canManageTeamFees(team, user, canModerateChat)) {
            container.innerHTML = `
                <div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
                    <h1 class="mb-2 text-2xl font-bold">Fees are admin-only</h1>
                    <p>Only team owners, team admins, and global admins can create or edit offline fee batches.</p>
                </div>
            `;
            return;
        }

        if (batchId) {
            await renderManageMode({ container, teamId, batchId, team, user, getTeamFeeBatch, listTeamFeeRecipients, updateTeamFeeRecipient });
        } else {
            await renderCreateMode({ container, teamId, team, user, getPlayers, createTeamFeeBatch, listTeamFeeBatches });
        }
    } catch (error) {
        console.error('[team-fees] init failed:', error);
        container.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">Unable to load team fees.</div>';
    }
}

export function registerTeamFeesAdminPageHandlers(win = typeof window !== 'undefined' ? window : null) {
    if (!win?.addEventListener) return;

    win.addEventListener('DOMContentLoaded', initTeamFeesAdminPage);
    win.addEventListener('hashchange', initTeamFeesAdminPage);
}

if (typeof window !== 'undefined') {
    registerTeamFeesAdminPageHandlers(window);
}
