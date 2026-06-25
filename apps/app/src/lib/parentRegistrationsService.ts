import {
    calculateRegistrationFeeSnapshot,
    getActiveRegistrationOptions,
    getRegistrationPaymentNotice,
    getTeam,
    hasOnlineRegistrationCheckout,
    listPublishedTeamRegistrationForms,
    normalizeRegistrationForm
} from './adapters/legacyParentTools';
import { formatCurrencyFromCents as formatCurrency } from './money';
import type { AuthUser } from './types';

const legacyOrigin = 'https://allplays.ai';

export type RegistrationDiscountRule = {
    id: string;
    type: 'early_bird' | 'quantity';
    label: string;
    amountType: 'percent' | 'fixed';
    amountValue: number;
    earlyBirdDeadline?: string;
    minimumQuantity?: number;
    active: boolean;
};

export type ParentRegistrationCard = Record<string, any> & {
    id: string;
    teamId: string;
    teamName: string;
    programName: string;
    description: string;
    season: string;
    feeLabel: string;
    paymentNotice: string;
    onlineCheckout: boolean;
    options: Array<Record<string, any>>;
    discountRules?: RegistrationDiscountRule[];
    url: string;
    appUrl?: string;
};

export async function loadParentRegistrations(user: AuthUser | null): Promise<ParentRegistrationCard[]> {
    const teamIds = getLinkedTeamIds(user);
    const cards = await Promise.all(teamIds.map(async (teamId) => {
        const [team, forms] = await Promise.all([
            Promise.resolve(getTeam(teamId)).catch(() => null),
            Promise.resolve(listPublishedTeamRegistrationForms(teamId, { pageSize: 50 })).catch(() => [])
        ]);
        return (forms || []).map((form: any) => toRegistrationCard(team || { id: teamId }, form));
    }));
    return cards.flat()
        .filter((card): card is ParentRegistrationCard => Boolean(card))
        .sort((a, b) => a.teamName.localeCompare(b.teamName) || a.programName.localeCompare(b.programName));
}

function getLegacyUrl(path: string, params: Record<string, string> = {}) {
    const url = new URL(path, legacyOrigin);
    Object.entries(params).forEach(([key, value]) => {
        if (value) url.searchParams.set(key, value);
    });
    return url.toString();
}

function getRegistrationUrl(teamId: string, formId: string) {
    return getLegacyUrl('registration.html', { teamId, formId });
}

function getAppRegistrationUrl(teamId: string, formId: string) {
    const url = new URL('app/', legacyOrigin);
    const params = new URLSearchParams();
    if (teamId) params.set('teamId', teamId);
    if (formId) params.set('formId', formId);
    url.hash = `/registration${params.toString() ? `?${params.toString()}` : ''}`;
    return url.toString();
}

function toRegistrationCard(team: any, form: any): ParentRegistrationCard | null {
    const normalized = normalizeRegistrationForm(form, { teamId: team.id || form.teamId, formId: form.id });
    if (!normalized.published || normalized.status === 'closed' || normalized.status === 'archived') return null;
    const feeSnapshot = calculateRegistrationFeeSnapshot(normalized, { now: new Date() });
    return {
        ...normalized,
        id: normalized.id,
        teamId: normalized.teamId,
        teamName: compactString(team.name) || 'Team',
        programName: normalized.programName || 'Registration',
        description: normalized.description,
        season: normalized.season,
        feeLabel: formatCurrency(feeSnapshot.finalAmountDueCents, normalized.currency),
        paymentNotice: getRegistrationPaymentNotice(normalized),
        onlineCheckout: hasOnlineRegistrationCheckout(normalized),
        options: getActiveRegistrationOptions(normalized, normalized.registrationOptionCounts || {}),
        url: getRegistrationUrl(normalized.teamId, normalized.id),
        appUrl: getAppRegistrationUrl(normalized.teamId, normalized.id)
    };
}

function getLinkedTeamIds(user: AuthUser | null) {
    return [...new Set([
        ...(Array.isArray(user?.parentOf) ? user!.parentOf.map((entry: any) => compactString(entry.teamId)) : []),
        ...(Array.isArray(user?.coachOf) ? user!.coachOf.map(compactString) : [])
    ].filter(Boolean))];
}

function compactString(value: unknown) {
    return String(value || '').trim();
}
