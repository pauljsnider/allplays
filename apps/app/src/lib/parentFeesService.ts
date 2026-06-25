import {
    formatParentFeeAmount,
    formatParentFeeDueDate,
    getParentFeeStatusMeta,
    initiateTeamFeeCheckout,
    listParentTeamFeeRecipients,
    normalizeParentFeeRecord,
    sortParentFeeRecords
} from './adapters/legacyParentTools';
import type { AuthUser } from './types';

export type ParentFeeAppRecord = Record<string, any> & {
    amountLabel: string;
    dueLabel: string;
    statusLabel: string;
    notes?: string;
    feeNotes?: string;
    offlinePaymentInstructions?: string;
    paymentInstructions?: string;
    collectionMode?: string;
    checkoutUrl?: string;
    checkoutStatus?: string;
    canPay: boolean;
    checkoutInitiatable: boolean;
    paymentAction: 'checkoutUrl' | 'createCheckout' | '';
    lineItems: Array<Record<string, any>>;
    installments: Array<Record<string, any>>;
    ledgerEntries: Array<Record<string, any>>;
};

export async function loadParentFeesForApp(user: AuthUser | null): Promise<ParentFeeAppRecord[]> {
    if (!user?.uid) return [];
    const rawFees = await Promise.resolve(listParentTeamFeeRecipients(user.uid, user.parentOf || []));
    return sortParentFeeRecords(rawFees || []).map((fee: any) => toParentFeeAppRecord(fee));
}

export async function initiateParentTeamFeeCheckout(teamId: string, batchId: string, recipientId: string): Promise<{ success: true; checkoutUrl: string }> {
    if (!teamId || !batchId || !recipientId) {
        throw new Error('Missing required fields for team fee checkout.');
    }

    const checkoutUrl = await initiateTeamFeeCheckout({ teamId, batchId, recipientId });
    if (!checkoutUrl) {
        throw new Error('Failed to get checkout URL.');
    }

    return { success: true, checkoutUrl };
}

export function isParentTeamFeePayActionAllowed(fee: any) {
    if (!isOnlineParentTeamFeeCollection(fee)) return false;

    const status = compactString(fee?.status).toLowerCase();
    if (status === 'paid' || status === 'canceled' || status === 'cancelled') return false;

    const balanceCents = Number(fee?.balanceDueCents);
    if (!Number.isFinite(balanceCents) || balanceCents <= 0) return false;

    return true;
}

export function canInitiateParentTeamFeeCheckout(fee: any) {
    return Boolean(
        isParentTeamFeePayActionAllowed(fee)
        && !hasReusableParentTeamFeeCheckoutUrl(fee)
        && compactString(fee?.teamId)
        && compactString(fee?.batchId)
        && compactString(fee?.recipientId)
    );
}

function toParentFeeAppRecord(fee: any): ParentFeeAppRecord {
    const normalized = normalizeParentFeeRecord(fee);
    const collectionMode = compactString(normalized.collectionMode);
    const checkoutUrl = compactString(normalized.checkoutUrl);
    const checkoutStatus = compactString(normalized.checkoutStatus);
    const parentFee = {
        ...normalized,
        collectionMode,
        checkoutUrl,
        checkoutStatus
    };
    const meta = getParentFeeStatusMeta(normalized.status);
    const canOpenCheckoutUrl = isParentTeamFeePayActionAllowed(parentFee) && hasReusableParentTeamFeeCheckoutUrl(parentFee);
    const checkoutInitiatable = canInitiateParentTeamFeeCheckout(parentFee);
    return {
        ...parentFee,
        amountLabel: formatParentFeeAmount(parentFee),
        dueLabel: formatParentFeeDueDate(parentFee.dueDate),
        statusLabel: meta.label,
        canPay: canOpenCheckoutUrl || checkoutInitiatable,
        checkoutInitiatable,
        paymentAction: canOpenCheckoutUrl ? 'checkoutUrl' : checkoutInitiatable ? 'createCheckout' : '',
        lineItems: getArrayField(normalized, ['lineItems', 'invoiceLineItems', 'invoiceItems', 'items']),
        installments: getArrayField(normalized, ['installments', 'installmentSchedule', 'paymentSchedule', 'scheduledPayments']),
        ledgerEntries: getArrayField(normalized, ['ledgerEntries', 'paymentLedger', 'activity', 'receipts', 'payments', 'adjustments'])
    };
}

function isOnlineParentTeamFeeCollection(fee: any) {
    const collectionMode = compactString(fee?.collectionMode).toLowerCase();
    if (!collectionMode) {
        return Boolean(compactString(fee?.checkoutUrl));
    }

    return ['online_stripe', 'stripe', 'stripe_checkout', 'online'].includes(collectionMode);
}

function hasReusableParentTeamFeeCheckoutUrl(fee: any) {
    if (!compactString(fee?.checkoutUrl)) return false;

    const checkoutStatus = compactString(fee?.checkoutStatus).toLowerCase();
    return !checkoutStatus || checkoutStatus === 'open';
}

function getArrayField(source: any, keys: string[]) {
    for (const key of keys) {
        if (Array.isArray(source?.[key])) return source[key].filter(Boolean);
    }
    return [];
}

function compactString(value: unknown) {
    return String(value || '').trim();
}
