import {
    formatParentFeeAmount,
    formatParentFeeDueDate,
    getParentFeeStatusMeta,
    initiateTeamFeeCheckout,
    normalizeParentFeeRecord,
    sortParentFeeRecords
} from './adapters/legacyParentTools';
import { listParentTeamFeeRecipientsForApp } from './parentFeeRecipientsService';
import { callNativeFirebaseFunction } from './nativeCallable';
import { isNativeRuntime } from './nativeRuntime';
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
    const rawFees = await listParentTeamFeeRecipientsForApp(user.uid, user.parentOf || []);
    return sortParentFeeRecords(rawFees || []).map((fee: any) => toParentFeeAppRecord(fee));
}

export async function initiateParentTeamFeeCheckout(teamId: string, batchId: string, recipientId: string): Promise<{ success: true; checkoutUrl: string }> {
    if (!teamId || !batchId || !recipientId) {
        throw new Error('Missing required fields for team fee checkout.');
    }

    const input = { teamId, batchId, recipientId };
    const nativeRuntime = isNativeRuntime();
    const checkoutResult = nativeRuntime
        ? await callNativeFirebaseFunction<{ checkoutUrl?: unknown }>(
            'createStripeTeamFeeCheckout',
            input,
            { errorLabel: 'Team fee checkout' }
        )
        : await initiateTeamFeeCheckout(input);
    const checkoutUrl = getTrustedStripeCheckoutUrl(
        nativeRuntime ? checkoutResult?.checkoutUrl : checkoutResult
    );
    if (!checkoutUrl) {
        throw new Error('Unable to get a trusted Stripe checkout link. Try again.');
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
        && compactString(fee?.teamId)
        && compactString(fee?.batchId)
        && compactString(fee?.recipientId)
    );
}

function toParentFeeAppRecord(fee: any): ParentFeeAppRecord {
    const normalized = normalizeParentFeeRecord(fee);
    const collectionMode = compactString(normalized.collectionMode);
    const checkoutStatus = compactString(normalized.checkoutStatus);
    const storedParentFee = {
        ...normalized,
        collectionMode,
        checkoutUrl: '',
        checkoutStatus
    };
    const parentFee: Record<string, any> = {
        ...omitParentFeeCheckoutDestinationFields(storedParentFee),
        checkoutUrl: ''
    };
    const meta = getParentFeeStatusMeta(normalized.status);
    const checkoutInitiatable = canInitiateParentTeamFeeCheckout(storedParentFee);
    return {
        ...parentFee,
        amountLabel: formatParentFeeAmount(parentFee),
        dueLabel: formatParentFeeDueDate(parentFee.dueDate),
        statusLabel: meta.label,
        canPay: checkoutInitiatable,
        checkoutInitiatable,
        paymentAction: checkoutInitiatable ? 'createCheckout' : '',
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

export function getTrustedStripeCheckoutUrl(value: unknown) {
    const checkoutUrl = compactString(value);
    try {
        const parsed = new URL(checkoutUrl);
        if (
            parsed.protocol === 'https:'
            && parsed.hostname === 'checkout.stripe.com'
            && !parsed.username
            && !parsed.password
            && !parsed.port
        ) {
            return checkoutUrl;
        }
    } catch {
        // Invalid destinations use the same fail-closed path as untrusted URLs.
    }

    return '';
}

function omitParentFeeCheckoutDestinationFields(fee: Record<string, any>) {
    const safeFee = { ...fee };
    ['checkoutUrl', 'checkoutURL', 'paymentLink', 'paymentLinkUrl', 'paymentUrl'].forEach((field) => {
        delete safeFee[field];
    });
    return safeFee;
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
