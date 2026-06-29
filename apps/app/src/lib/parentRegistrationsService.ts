import {
    acceptTeamRegistrationOffer,
    approveTeamRegistration,
    calculateRegistrationFeeSnapshot,
    cancelStripeRegistrationCheckout,
    createRegistrationCheckoutSession,
    db,
    doc,
    extendTeamRegistrationOffer,
    functions,
    getActiveRegistrationOptions,
    getDoc,
    getPaymentPlanChoices,
    getPlayers,
    getRegistrationGuardianDrafts,
    getRegistrationPaymentNotice,
    getRegistrationPlayerDraft,
    getRegistrationSubmittedData,
    getTeam,
    getTeamRegistrationForm,
    hasOnlineRegistrationCheckout,
    httpsCallable,
    listPublishedTeamRegistrationForms,
    listTeamRegistrationReviewsPage,
    normalizeRegistrationForm,
    normalizeRegistrationStatus,
    rejectTeamRegistration
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

export type ParentRegistrationDetailModel = {
    teamName: string;
    isPublished: boolean;
    onlineCheckout: boolean;
    legacyUrl: string;
    form: Record<string, any>;
    options: Array<Record<string, any>>;
    feeSnapshot: Record<string, any>;
    paymentNotice: string;
    paymentPlans: Array<Record<string, any>>;
};

export type TeamRegistrationRosterPlayer = {
    id: string;
    name: string;
    number?: string;
};

export type TeamRegistrationReviewCard = Record<string, any> & {
    id: string;
    status: string;
    participantName: string;
    guardianLabel: string;
    guardianEmails: string[];
    participant: Record<string, any>;
    guardian: Record<string, any>;
    submittedData: Record<string, any>;
    submittedAt: unknown;
    selectedOptionLabel: string;
    paymentLabel: string;
    waiverAccepted: boolean;
    linkedPlayerId: string;
    decisionNote: string;
};

export type TeamRegistrationQueueModel = {
    reviews: TeamRegistrationReviewCard[];
    rosterPlayers: TeamRegistrationRosterPlayer[];
    waitlistedReviews?: TeamRegistrationReviewCard[];
    totalWaitlisted?: number;
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

export async function submitOfflineRegistration(teamId: string, formId: string, submission: Record<string, any>) {
    if (!teamId || !formId || !submission) throw new Error('Registration submission is incomplete.');

    const submitPublicRegistration = httpsCallable(functions, 'submitPublicRegistration');
    try {
        const result = await submitPublicRegistration({
            teamId,
            formId,
            participant: submission.participant,
            guardian: submission.guardian,
            waiverAccepted: submission.waiverAccepted,
            selectedOptionId: submission.selectedOptionId || submission.selectedOption?.id || '',
            selectedPaymentPlanId: submission.selectedPaymentPlanId || 'pay_full',
            quantity: submission.quantity || submission.feeSnapshot?.quantity || 1,
            checkoutAttemptToken: submission.checkoutAttemptToken || ''
        });
        return result?.data || {};
    } catch (error: any) {
        const code = String(error?.code || '').replace(/^functions\//, '');
        const details = error?.details || {};
        if (details.reason === 'option-full' || details.reason === 'missing-option' || code === 'failed-precondition' || code === 'invalid-argument' || code === 'resource-exhausted') {
            throw new Error(error?.message || 'Registration could not be submitted.');
        }
        throw error;
    }
}

export async function loadTeamRegistrationQueuePage(
    teamId: string,
    formId: string,
    options: { status?: string; pageSize?: number; afterDoc?: any } = {}
): Promise<{ reviews: TeamRegistrationReviewCard[]; lastDoc: any; hasMore: boolean }> {
    const { status = 'all', pageSize = 25, afterDoc = null } = options;
    const { registrations, lastDoc, hasMore } = await listTeamRegistrationReviewsPage(teamId, formId, { status, pageSize, afterDoc });
    return {
        reviews: (registrations || []).map((review: any) => toTeamRegistrationReviewCard(review)),
        lastDoc,
        hasMore
    };
}

export async function loadTeamRegistrationRosterPlayers(
    user: AuthUser | null,
    teamId: string
): Promise<TeamRegistrationRosterPlayer[]> {
    if (!canManageTeamRegistrations(user, teamId)) {
        throw new Error('Admin access is required to review registrations.');
    }
    const rosterPlayers = await Promise.resolve(getPlayers(teamId)).catch(() => []);
    return (rosterPlayers || []).map((player: any) => ({
        id: compactString(player.id),
        name: compactString(player.name) || 'Player',
        number: compactString(player.number)
    }));
}

export async function approveTeamRegistrationForApp(
    user: AuthUser | null,
    teamId: string,
    formId: string,
    registrationId: string,
    options: { playerId?: string; decisionNote?: string } = {}
) {
    if (!canManageTeamRegistrations(user, teamId)) {
        throw new Error('Admin access is required to approve registrations.');
    }
    return approveTeamRegistration(teamId, formId, registrationId, options);
}

export async function rejectTeamRegistrationForApp(
    user: AuthUser | null,
    teamId: string,
    formId: string,
    registrationId: string,
    decisionNote = ''
) {
    if (!canManageTeamRegistrations(user, teamId)) {
        throw new Error('Admin access is required to decline registrations.');
    }
    return rejectTeamRegistration(teamId, formId, registrationId, decisionNote);
}

export async function extendTeamRegistrationOfferForApp(
    user: AuthUser | null,
    teamId: string,
    formId: string,
    registrationId: string,
    decisionNote = ''
) {
    if (!canManageTeamRegistrations(user, teamId)) {
        throw new Error('Admin access is required to manage waitlist registrations.');
    }
    return extendTeamRegistrationOffer(teamId, formId, registrationId, decisionNote);
}

export async function acceptTeamRegistrationOfferForApp(
    user: AuthUser | null,
    teamId: string,
    formId: string,
    registrationId: string,
    decisionNote = ''
) {
    if (!canManageTeamRegistrations(user, teamId)) {
        throw new Error('Admin access is required to manage waitlist registrations.');
    }
    return acceptTeamRegistrationOffer(teamId, formId, registrationId, decisionNote);
}

export async function loadParentRegistrationDetail(
    user: AuthUser | null,
    teamId: string,
    formId: string
): Promise<ParentRegistrationDetailModel> {
    if (!user?.uid || !teamId || !formId) {
        throw new Error('Team and form are required.');
    }
    if (!getLinkedTeamIds(user).includes(teamId)) {
        throw new Error('Registration is not linked to your family.');
    }
    return loadRegistrationDetailModel(teamId, formId);
}

export async function loadStaffRegistrationDetail(
    user: AuthUser | null,
    teamId: string,
    formId: string
): Promise<ParentRegistrationDetailModel> {
    if (!canManageTeamRegistrations(user, teamId)) {
        throw new Error('Admin access is required to review registrations.');
    }
    return loadRegistrationDetailModel(teamId, formId);
}

export async function loadPublicRegistrationDetail(
    teamId: string,
    formId: string
): Promise<ParentRegistrationDetailModel> {
    if (!teamId || !formId) {
        throw new Error('Team and form are required.');
    }

    const formSnap = await Promise.resolve(getDoc(doc(db, 'teams', teamId, 'registrationForms', formId))).catch(() => null);
    const form = formSnap?.exists?.() ? { id: formId, ...(formSnap.data() || {}) } : null;
    if (!form) throw new Error('Registration form not found.');

    const normalizedForm = normalizeRegistrationForm(form, { teamId, formId });
    if (!normalizedForm.published || normalizedForm.status === 'closed' || normalizedForm.status === 'archived') {
        throw new Error('This registration form is not available right now.');
    }

    const feeSnapshot = calculateRegistrationFeeSnapshot(normalizedForm, { now: new Date() });
    const paymentPlans = getPaymentPlanChoices(normalizedForm);
    const paymentNotice = getRegistrationPaymentNotice(normalizedForm);
    const onlineCheckout = hasOnlineRegistrationCheckout(normalizedForm);
    const legacyUrl = getRegistrationUrl(teamId, formId);

    return {
        teamName: getPublicRegistrationTeamName(form),
        isPublished: true,
        onlineCheckout,
        legacyUrl,
        form: normalizedForm,
        options: getActiveRegistrationOptions(normalizedForm, normalizedForm.registrationOptionCounts || {}),
        feeSnapshot,
        paymentNotice,
        paymentPlans
    };
}

export async function initiateRegistrationCheckout(
    teamId: string,
    formId: string,
    registrationId: string,
    selectedOptionId: string,
    paymentPlanId: string,
    quantity: number,
    amountCents: number,
    currency: string,
    options: { checkoutAttemptToken?: string; retryPayment?: boolean; publicCheckoutCapability?: string } = {}
): Promise<{ success: true; checkoutUrl: string }> {
    if (!teamId || !formId || (!registrationId && !options.publicCheckoutCapability) || !paymentPlanId || !quantity || !amountCents || !currency) {
        throw new Error('Missing required fields for checkout.');
    }

    const result = await createRegistrationCheckoutSession(
        teamId,
        formId,
        registrationId,
        selectedOptionId,
        paymentPlanId,
        quantity,
        amountCents,
        currency,
        options.checkoutAttemptToken,
        options.retryPayment,
        options.publicCheckoutCapability
    );

    if (!result?.checkoutUrl) {
        throw new Error('Failed to get checkout URL.');
    }

    return { success: true, checkoutUrl: result.checkoutUrl };
}

export async function cancelRegistrationCheckout(
    teamId: string,
    formId: string,
    registrationId: string,
    checkoutAttemptToken = '',
    publicCheckoutCapability = ''
) {
    if (!teamId || !formId || (!registrationId && !publicCheckoutCapability)) {
        throw new Error('Missing required fields for checkout cancellation.');
    }

    return cancelStripeRegistrationCheckout({
        teamId,
        formId,
        registrationId,
        checkoutAttemptToken,
        publicCheckoutCapability
    });
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

async function loadRegistrationDetailModel(teamId: string, formId: string): Promise<ParentRegistrationDetailModel> {
    if (!teamId || !formId) {
        throw new Error('Team and form are required.');
    }
    const [team, form] = await Promise.all([
        Promise.resolve(getTeam(teamId)).catch(() => null),
        Promise.resolve(getTeamRegistrationForm(teamId, formId)).catch(() => null)
    ]);

    if (!form) throw new Error('Registration form not found.');
    if (!team) throw new Error('Team not found.');

    const normalizedForm = normalizeRegistrationForm(form, { teamId, formId });
    const feeSnapshot = calculateRegistrationFeeSnapshot(normalizedForm, { now: new Date() });
    const paymentPlans = getPaymentPlanChoices(normalizedForm);
    const paymentNotice = getRegistrationPaymentNotice(normalizedForm);
    const onlineCheckout = hasOnlineRegistrationCheckout(normalizedForm);
    const legacyUrl = getRegistrationUrl(teamId, formId);

    return {
        teamName: compactString(team.name) || 'Team',
        isPublished: normalizedForm.published && normalizedForm.status !== 'closed' && normalizedForm.status !== 'archived',
        onlineCheckout,
        legacyUrl,
        form: normalizedForm,
        options: getActiveRegistrationOptions(normalizedForm, normalizedForm.registrationOptionCounts || {}),
        feeSnapshot,
        paymentNotice,
        paymentPlans
    };
}

function getPublicRegistrationTeamName(form: Record<string, any>) {
    return compactString(form.teamName || form.team?.name || form.organizationName || form.clubName) || 'Team';
}

function toTeamRegistrationReviewCard(review: any): TeamRegistrationReviewCard {
    const normalizedStatus = normalizeRegistrationStatus(review?.status || 'pending');
    const submittedData = asObject(getRegistrationSubmittedData(review));
    const participant = {
        ...asObject(review?.participant),
        ...asObject(submittedData.participant)
    };
    const guardian = {
        ...asObject(review?.guardian),
        ...asObject(submittedData.guardian)
    };
    const guardians = getRegistrationGuardianDrafts(review) as Array<Record<string, any>>;
    const playerDraft = getRegistrationPlayerDraft(review);
    const feeSnapshot = asObject(review?.feeSnapshot);
    const selectedOption = asObject(review?.selectedOption);
    const paymentState = compactString(
        review?.paymentStatus
        || feeSnapshot.paymentStatus
        || review?.checkoutStatus
        || review?.paymentState
        || review?.payment?.status
    );
    const paymentAmount = Number(
        review?.balanceDueCents
        ?? review?.paymentPlan?.remainingBalanceCents
        ?? feeSnapshot.finalAmountDueCents
        ?? feeSnapshot.amountDueCents
        ?? feeSnapshot.feeAmountCents
        ?? review?.feeAmountCents
    );
    const paymentStateLabel = paymentState.replace(/_/g, ' ');

    return {
        ...review,
        id: compactString(review?.id),
        status: normalizedStatus,
        participantName: compactString(review?.reviewSummary?.playerName || playerDraft.name || participant.name) || 'Unnamed player',
        guardianLabel: compactString(review?.reviewSummary?.guardianLabel || guardians.map((entry) => entry.email || entry.name).filter(Boolean).join(', ')),
        guardianEmails: guardians.map((entry) => compactString(entry.email)).filter(Boolean),
        participant,
        guardian,
        submittedData,
        submittedAt: review?.reviewSummary?.submittedAt || review?.submittedAt || review?.createdAt || null,
        selectedOptionLabel: compactString(selectedOption.title || selectedOption.label || review?.selectedOptionLabel || review?.selectedOptionId),
        paymentLabel: paymentState
            ? `${paymentStateLabel}${Number.isFinite(paymentAmount) ? ` · ${formatCurrency(paymentAmount, feeSnapshot.currency || review?.currency || 'USD')}` : ''}`
            : (Number.isFinite(paymentAmount) ? formatCurrency(paymentAmount, feeSnapshot.currency || review?.currency || 'USD') : 'Not recorded'),
        waiverAccepted: Boolean(
            review?.waiverAccepted
            ?? submittedData.waiverAccepted
            ?? submittedData.waiver
            ?? review?.waiver?.accepted
        ),
        linkedPlayerId: compactString(review?.linkedPlayerId),
        decisionNote: compactString(review?.decisionNote)
    };
}

function getLinkedTeamIds(user: AuthUser | null) {
    return [...new Set([
        ...(Array.isArray(user?.parentOf) ? user.parentOf.map((entry: any) => compactString(entry.teamId)) : []),
        ...(Array.isArray(user?.coachOf) ? user.coachOf.map(compactString) : [])
    ].filter(Boolean))];
}

function canManageTeamRegistrations(user: AuthUser | null, teamId: string) {
    if (!teamId || !user) return false;
    if (Array.isArray(user.roles) && user.roles.some((role) => role === 'admin' || role === 'platformAdmin')) return true;
    return Array.isArray(user.coachOf) && user.coachOf.map(compactString).includes(teamId);
}

function asObject(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function compactString(value: unknown) {
    return String(value || '').trim();
}
