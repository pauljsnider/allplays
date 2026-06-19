import {
    calculateRegistrationFeeSnapshot as legacyCalculateRegistrationFeeSnapshot,
    decideRegistrationPlacement as legacyDecideRegistrationPlacement,
    formatFeeSnapshotLines as legacyFormatFeeSnapshotLines,
    getActiveRegistrationOptions as legacyGetActiveRegistrationOptions,
    getPaymentPlanChoices as legacyGetPaymentPlanChoices,
    hasQuantityDiscountRule as legacyHasQuantityDiscountRule,
    requiresRegistrationOption as legacyRequiresRegistrationOption
} from '@legacy/registration-flow.js';

export type LegacyRegistrationOption = {
    id: string;
    countKey?: string;
    title: string;
    description?: string;
    capacityLimit?: number | null;
    waitlistEnabled?: boolean;
    active?: boolean;
};

export type LegacyRegistrationPaymentPlanChoice = {
    id: string;
    type: string;
    title: string;
};

export type LegacyRegistrationFeeSnapshot = {
    currency: string;
    quantity: number;
    originalFeeAmountCents: number;
    subtotalAmountCents: number;
    appliedDiscounts: Array<{
        id?: string;
        type?: string;
        label: string;
        amountType?: string;
        amountValue?: number;
        amountCents: number;
    }>;
    finalAmountDueCents: number;
};

export type LegacyRegistrationFeeSummaryLine = {
    label: string;
    amountCents: number;
    strong?: boolean;
};

export type LegacyRegistrationPlacement =
    | {
        status: 'pending' | 'waitlisted';
        selectedOption: LegacyRegistrationOption;
        nextCounts: { enrolled: number; waitlisted: number };
        message?: string;
    }
    | {
        status: 'blocked';
        reason: string;
        selectedOption?: LegacyRegistrationOption;
        message: string;
    };

export function getActiveRegistrationOptions(form: Record<string, unknown>, registrationOptionCounts: Record<string, unknown>): LegacyRegistrationOption[] {
    return legacyGetActiveRegistrationOptions(form, registrationOptionCounts) as LegacyRegistrationOption[];
}

export function getPaymentPlanChoices(form: Record<string, unknown>): LegacyRegistrationPaymentPlanChoice[] {
    return legacyGetPaymentPlanChoices(form) as LegacyRegistrationPaymentPlanChoice[];
}

export function requiresRegistrationOption(form: Record<string, unknown>): boolean {
    return legacyRequiresRegistrationOption(form);
}

export function hasQuantityDiscountRule(rules: unknown[] | undefined): boolean {
    return legacyHasQuantityDiscountRule(rules);
}

export function calculateRegistrationFeeSnapshot(form: Record<string, unknown>, options: { quantity?: number; now?: Date }): LegacyRegistrationFeeSnapshot {
    return legacyCalculateRegistrationFeeSnapshot(form, options) as LegacyRegistrationFeeSnapshot;
}

export function formatFeeSnapshotLines(snapshot: LegacyRegistrationFeeSnapshot): LegacyRegistrationFeeSummaryLine[] {
    return legacyFormatFeeSnapshotLines(snapshot) as LegacyRegistrationFeeSummaryLine[];
}

export function decideRegistrationPlacement(input: {
    form: Record<string, unknown>;
    selectedOptionId: string;
    counts?: Record<string, unknown>;
}): LegacyRegistrationPlacement {
    return legacyDecideRegistrationPlacement(input) as LegacyRegistrationPlacement;
}
