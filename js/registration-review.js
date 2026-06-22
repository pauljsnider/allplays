const SENSITIVE_PLAYER_KEYS = new Set([
    'medicalInfo',
    'medical_info',
    'medicalNotes',
    'medical_notes',
    'emergencyContact',
    'emergency_contact',
    'emergencyContactName',
    'emergencyContactPhone'
]);

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanString(value) {
    return String(value || '').trim();
}

function cleanEmail(value) {
    return cleanString(value).toLowerCase();
}

const SCREENING_STATUSES = new Set(['pending', 'submitted', 'cleared', 'flagged', 'expired', 'rejected']);
const SCREENING_STATUS_LIST = ['pending', 'submitted', 'cleared', 'flagged', 'expired', 'rejected'];

function normalizeScreeningStatus(status) {
    const normalized = cleanString(status).toLowerCase().replace(/[ _]+/g, '-');
    return SCREENING_STATUSES.has(normalized) ? normalized : 'pending';
}

export function matchesRegistrationReviewScreeningStatus(registration = {}, status = 'all') {
    const wantedStatus = cleanString(status).toLowerCase().replace(/[ _]+/g, '-') || 'all';
    if (wantedStatus === 'all') return true;
    if (registration.screeningRequired !== true) return false;
    return normalizeScreeningStatus(registration.screeningStatus) === wantedStatus;
}

export function summarizeRegistrationReviewScreening(registrations = []) {
    const counts = SCREENING_STATUS_LIST.reduce((acc, status) => {
        acc[status] = 0;
        return acc;
    }, {});

    (Array.isArray(registrations) ? registrations : []).forEach((registration) => {
        if (registration?.screeningRequired !== true) return;
        counts[normalizeScreeningStatus(registration.screeningStatus)] += 1;
    });

    const totalRequired = SCREENING_STATUS_LIST.reduce((total, status) => total + counts[status], 0);
    const notCleared = totalRequired - counts.cleared;
    return {
        counts,
        totalRequired,
        notCleared,
        statuses: [...SCREENING_STATUS_LIST]
    };
}

function firstNonEmpty(...values) {
    return values.map(cleanString).find(Boolean) || '';
}

function fullNameFromParts(source) {
    const first = firstNonEmpty(source.firstName, source.givenName, source.playerFirstName, source.athleteFirstName);
    const last = firstNonEmpty(source.lastName, source.familyName, source.playerLastName, source.athleteLastName);
    return [first, last].filter(Boolean).join(' ').trim();
}

function stripSensitiveFields(values = {}) {
    return Object.entries(asObject(values)).reduce((acc, [key, value]) => {
        if (!SENSITIVE_PLAYER_KEYS.has(key)) {
            acc[key] = value;
        }
        return acc;
    }, {});
}

export function normalizeRegistrationStatus(status) {
    const normalized = cleanString(status).toLowerCase().replace(/[ _]+/g, '-');
    if (['submitted', 'new', 'in-review'].includes(normalized)) return 'pending';
    if (['approved', 'accepted', 'enrolled', 'roster-approved'].includes(normalized)) return 'enrolled';
    if (['rejected', 'denied', 'declined'].includes(normalized)) return 'rejected';
    if (['waitlisted', 'offer-extended', 'offer-accepted', 'released', 'pending'].includes(normalized)) return normalized;
    return 'pending';
}

export function isActiveWaitlistDemandStatus(status) {
    return ['waitlisted', 'offer-extended', 'offer-accepted'].includes(normalizeRegistrationStatus(status));
}

export function canTransitionRegistrationStatus(fromStatus, toStatus, { adminAction = false } = {}) {
    const from = normalizeRegistrationStatus(fromStatus);
    const to = normalizeRegistrationStatus(toStatus);
    if (from === to) return true;
    if (from === 'released') return false;
    if (to === 'offer-extended') return from === 'waitlisted' && adminAction;
    if (to === 'offer-accepted') return from === 'offer-extended' && adminAction;
    if (to === 'released') return ['waitlisted', 'offer-extended', 'offer-accepted'].includes(from) && adminAction;
    if (to === 'enrolled') return ['pending', 'offer-accepted'].includes(from) && adminAction;
    if (to === 'rejected') return ['pending', 'waitlisted', 'offer-extended', 'offer-accepted'].includes(from) && adminAction;
    return false;
}

export function buildRegistrationStatusUpdate({ registration = {}, status = '', reviewer = {}, now = null, decisionNote = '' } = {}) {
    const currentStatus = normalizeRegistrationStatus(registration.status);
    const nextStatus = normalizeRegistrationStatus(status);
    if (!canTransitionRegistrationStatus(currentStatus, nextStatus, { adminAction: true })) {
        throw new Error(`Invalid registration status transition: ${currentStatus} to ${nextStatus}`);
    }
    const changedAt = now || new Date();
    const update = {
        status: nextStatus,
        updatedAt: changedAt,
        waitlistStatusUpdatedAt: changedAt,
        waitlistStatusUpdatedBy: reviewer.userId || '',
        waitlistStatusUpdatedByName: reviewer.name || reviewer.email || 'Admin',
        activeWaitlistDemand: isActiveWaitlistDemandStatus(nextStatus)
    };
    if (decisionNote) update.decisionNote = cleanString(decisionNote);
    if (nextStatus === 'offer-extended') {
        update.offerExtendedAt = changedAt;
        update.offerExtendedBy = reviewer.userId || '';
        update.offerExtendedByName = reviewer.name || reviewer.email || 'Admin';
    }
    if (nextStatus === 'offer-accepted') {
        update.offerAcceptedAt = changedAt;
        update.offerAcceptedBy = reviewer.userId || '';
        update.offerAcceptedByName = reviewer.name || reviewer.email || 'Admin';
    }
    if (nextStatus === 'released') {
        update.releasedAt = changedAt;
        update.releasedBy = reviewer.userId || '';
        update.releasedByName = reviewer.name || reviewer.email || 'Admin';
    }
    return update;
}

export function getRegistrationSubmittedData(registration = {}) {
    const data = asObject(registration);
    return asObject(data.submittedData || data.submission || data.payload || data.formData || data.answers || data.data);
}

export function getRegistrationPlayerDraft(registration = {}) {
    const data = asObject(registration);
    const submitted = getRegistrationSubmittedData(data);
    const playerSource = asObject(data.player || data.playerData || data.athlete || submitted.player || submitted.playerData || submitted.athlete);
    const name = firstNonEmpty(
        playerSource.name,
        playerSource.fullName,
        playerSource.playerName,
        playerSource.athleteName,
        submitted.playerName,
        submitted.athleteName,
        fullNameFromParts(playerSource),
        fullNameFromParts(submitted)
    );
    const number = firstNonEmpty(playerSource.number, playerSource.jerseyNumber, playerSource.jersey, submitted.playerNumber, submitted.jerseyNumber, submitted.jersey);
    const rosterFieldValues = stripSensitiveFields({
        ...asObject(playerSource.rosterFieldValues),
        ...asObject(playerSource.customFields),
        ...asObject(playerSource.profileFields),
        ...asObject(submitted.rosterFieldValues),
        ...asObject(submitted.customFields),
        ...asObject(submitted.profileFields)
    });

    const draft = {
        name,
        number,
        active: true
    };
    if (Object.keys(rosterFieldValues).length > 0) {
        draft.rosterFieldValues = rosterFieldValues;
    }
    return draft;
}

export function getRegistrationGuardianDrafts(registration = {}) {
    const data = asObject(registration);
    const submitted = getRegistrationSubmittedData(data);
    const sources = [];
    [data.guardian, data.parent, data.primaryGuardian, submitted.guardian, submitted.parent, submitted.primaryGuardian]
        .filter(Boolean)
        .forEach((entry) => sources.push(entry));
    [data.guardians, data.parents, submitted.guardians, submitted.parents]
        .filter(Array.isArray)
        .forEach((entries) => entries.forEach((entry) => sources.push(entry)));

    const deduped = new Map();
    sources.map(asObject).forEach((source) => {
        const email = cleanEmail(source.email || source.parentEmail || source.guardianEmail);
        const name = firstNonEmpty(source.name, source.fullName, source.parentName, source.guardianName, fullNameFromParts(source), email);
        if (!email && !name) return;
        const key = email || name.toLowerCase();
        if (!deduped.has(key)) {
            deduped.set(key, {
                email,
                name,
                relation: firstNonEmpty(source.relation, source.relationship, source.type, 'Guardian'),
                phone: firstNonEmpty(source.phone, source.phoneNumber, source.mobile)
            });
        }
    });
    return [...deduped.values()];
}

export function matchesRegistrationReviewStatus(registration = {}, status = 'all') {
    const wantedStatus = cleanString(status).toLowerCase() || 'all';
    switch (wantedStatus) {
        case 'all':
            return true;
        case 'approved':
        case 'enrolled':
            return normalizeRegistrationStatus(registration.status) === 'enrolled';
        case 'registration-approved':
            return registration.registrationApproved === true;
        case 'roster-approved':
            return registration.rosterApproved === true;
        case 'rejected':
            return normalizeRegistrationStatus(registration.status) === 'rejected' ||
                registration.registrationApproved === false ||
                registration.rosterApproved === false;
        case 'waitlisted':
        case 'offer-extended':
        case 'offer-accepted':
        case 'released':
        case 'pending':
            return normalizeRegistrationStatus(registration.status) === wantedStatus;
        default:
            return normalizeRegistrationStatus(registration.status) === wantedStatus;
    }
}

export function buildRegistrationRosterDecision({ registration = {}, team = {}, playerId = '', rosterDestinationType = '', reviewer = {}, now = null, decisionNote = '' } = {}) {
    const playerDraft = getRegistrationPlayerDraft(registration);
    if (!playerDraft.name) {
        throw new Error('Registration is missing a player name.');
    }
    const guardians = getRegistrationGuardianDrafts(registration);
    const linkedAt = now || new Date();
    const source = {
        formId: registration.formId || '',
        registrationId: registration.id || '',
        status: 'approved',
        linkedAt
    };

    return {
        player: {
            ...playerDraft,
            registrationSource: source
        },
        guardians,
        registrationUpdate: {
            status: 'enrolled',
            linkedTeamId: team.id || registration.teamId || '',
            linkedTeamName: team.name || registration.teamName || '',
            linkedPlayerId: playerId || null,
            decidedAt: linkedAt,
            decidedBy: reviewer.userId || '',
            decidedByName: reviewer.name || reviewer.email || 'Admin',
            decisionNote: cleanString(decisionNote),
            rosterDestination: {
                teamId: team.id || registration.teamId || '',
                playerId: playerId || null,
                type: rosterDestinationType || (playerId ? 'existing-player' : 'new-player')
            }
        }
    };
}

export function summarizeRegistration(registration = {}) {
    const player = getRegistrationPlayerDraft(registration);
    const guardians = getRegistrationGuardianDrafts(registration);
    return {
        status: normalizeRegistrationStatus(registration.status),
        playerName: player.name || 'Unnamed player',
        playerNumber: player.number || '',
        guardianLabel: guardians.map((guardian) => guardian.email || guardian.name).filter(Boolean).join(', '),
        screeningRequired: registration.screeningRequired === true,
        screeningStatus: registration.screeningRequired === true ? normalizeScreeningStatus(registration.screeningStatus) : '',
        screeningProviderReference: registration.screeningRequired === true ? cleanString(registration.screeningProviderReference) : '',
        submittedAt: registration.submittedAt || registration.createdAt || null
    };
}

function formatCsvDate(value) {
    const date = value?.toDate ? value.toDate() : (value ? new Date(value) : null);
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
}

function formatMoneyCents(value, currency = '') {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '';
    const formatted = (amount / 100).toFixed(2);
    return currency ? `${formatted} ${String(currency).toUpperCase()}` : formatted;
}

function findRegistrationOption(form = {}, optionId = '') {
    const options = Array.isArray(form.registrationOptions) ? form.registrationOptions : [];
    return options.find((option) => option?.id === optionId || option?.countKey === optionId) || {};
}

function resolveFeeAmount(registration = {}) {
    const snapshot = asObject(registration.feeSnapshot);
    const selectedOption = asObject(registration.selectedOption);
    const cents = snapshot.finalAmountDueCents ?? snapshot.amountDueCents ?? snapshot.feeAmountCents ?? selectedOption.feeAmountCents ?? registration.feeAmountCents;
    return formatMoneyCents(cents, snapshot.currency || registration.currency || '');
}

function resolvePaymentPlanLabel(registration = {}) {
    const plan = asObject(registration.paymentPlan);
    return firstNonEmpty(plan.label, plan.name, plan.id, registration.selectedPaymentPlanId);
}

export function escapeRegistrationCsvValue(value) {
    const text = value === null || value === undefined ? '' : String(value);
    const safeText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safeText) ? `"${safeText.replace(/"/g, '""')}"` : safeText;
}

export const REGISTRATION_REVIEW_STANDARD_CSV_COLUMNS = [
    { key: 'registrationId', label: 'registration id', value: (row) => row.registrationId },
    { key: 'playerName', label: 'player name', value: (row) => row.playerName },
    { key: 'playerNumber', label: 'player number', value: (row) => row.playerNumber },
    { key: 'guardianName', label: 'guardian name', value: (row) => row.guardianName },
    { key: 'guardianEmail', label: 'guardian email', value: (row) => row.guardianEmail },
    { key: 'status', label: 'status', value: (row) => row.status },
    { key: 'selectedOptionLabel', label: 'selected option label', value: (row) => row.selectedOptionLabel },
    { key: 'selectedOptionId', label: 'selected option id', value: (row) => row.selectedOptionId },
    { key: 'submittedDate', label: 'submitted date', value: (row) => row.submittedDate },
    { key: 'feeAmount', label: 'fee amount', value: (row) => row.feeAmount },
    { key: 'paymentPlan', label: 'payment plan', value: (row) => row.paymentPlan },
    { key: 'linkedPlayerId', label: 'linked player id', value: (row) => row.linkedPlayerId },
    { key: 'decisionNote', label: 'decision note', value: (row) => row.decisionNote }
];

const DEFAULT_REGISTRATION_REVIEW_CSV_COLUMN_KEYS = REGISTRATION_REVIEW_STANDARD_CSV_COLUMNS.map((column) => column.key);

function normalizeExportField(field = {}, index = 0, group = 'field') {
    const id = cleanString(field.id || field.key || `field_${index + 1}`);
    const label = cleanString(field.label || field.name || id || `Field ${index + 1}`);
    return id && label ? { id, label, group } : null;
}

function readSubmittedFieldValue(registration = {}, group = '', fieldId = '') {
    const submitted = getRegistrationSubmittedData(registration);
    return asObject(submitted[group])[fieldId] ?? asObject(registration[group])[fieldId] ?? '';
}

export function getRegistrationReviewCsvColumnDefinitions(form = {}) {
    const participantColumns = (Array.isArray(form.participantFields) ? form.participantFields : [])
        .map((field, index) => normalizeExportField(field, index, 'participant'))
        .filter(Boolean)
        .map((field) => ({
            key: `participant.${field.id}`,
            label: `participant: ${field.label}`,
            value: (_row, registration) => readSubmittedFieldValue(registration, 'participant', field.id)
        }));
    const guardianColumns = (Array.isArray(form.guardianFields) ? form.guardianFields : [])
        .map((field, index) => normalizeExportField(field, index, 'guardian'))
        .filter(Boolean)
        .map((field) => ({
            key: `guardian.${field.id}`,
            label: `guardian: ${field.label}`,
            value: (_row, registration) => readSubmittedFieldValue(registration, 'guardian', field.id)
        }));
    return [
        ...REGISTRATION_REVIEW_STANDARD_CSV_COLUMNS,
        ...participantColumns,
        ...guardianColumns
    ];
}

export function getDefaultRegistrationReviewCsvColumnKeys() {
    return [...DEFAULT_REGISTRATION_REVIEW_CSV_COLUMN_KEYS];
}

export function flattenRegistrationReviewForCsv(registration = {}, form = {}) {
    const summary = registration.reviewSummary || summarizeRegistration(registration);
    const guardians = getRegistrationGuardianDrafts(registration);
    const primaryGuardian = guardians[0] || {};
    const selectedOption = asObject(registration.selectedOption);
    const selectedOptionId = firstNonEmpty(selectedOption.id, registration.selectedOptionId);
    const formOption = findRegistrationOption(form, selectedOptionId);
    return {
        registrationId: registration.id || '',
        playerName: summary.playerName || '',
        playerNumber: summary.playerNumber || '',
        guardianName: primaryGuardian.name || '',
        guardianEmail: primaryGuardian.email || '',
        status: normalizeRegistrationStatus(registration.status),
        selectedOptionLabel: firstNonEmpty(selectedOption.title, selectedOption.label, formOption.title, formOption.label),
        selectedOptionId,
        submittedDate: formatCsvDate(summary.submittedAt || registration.submittedAt || registration.createdAt),
        feeAmount: resolveFeeAmount(registration),
        paymentPlan: resolvePaymentPlanLabel(registration),
        linkedPlayerId: registration.linkedPlayerId || registration.rosterDestination?.playerId || '',
        decisionNote: registration.decisionNote || ''
    };
}

export function buildRegistrationReviewCsv(registrations = [], form = {}, selectedColumnKeys = null) {
    const definitions = getRegistrationReviewCsvColumnDefinitions(form);
    const selectedKeys = Array.isArray(selectedColumnKeys) && selectedColumnKeys.length
        ? selectedColumnKeys
        : DEFAULT_REGISTRATION_REVIEW_CSV_COLUMN_KEYS;
    const definitionsByKey = new Map(definitions.map((definition) => [definition.key, definition]));
    const selectedDefinitions = selectedKeys.map((key) => definitionsByKey.get(key)).filter(Boolean);
    const columns = selectedDefinitions.length ? selectedDefinitions : definitions.filter((definition) => DEFAULT_REGISTRATION_REVIEW_CSV_COLUMN_KEYS.includes(definition.key));
    const rows = registrations.map((registration) => ({
        registration,
        row: flattenRegistrationReviewForCsv(registration, form)
    }));
    return [columns.map((column) => column.label), ...rows.map(({ row, registration }) => columns.map((column) => column.value(row, registration) ?? ''))]
        .map((row) => row.map(escapeRegistrationCsvValue).join(','))
        .join('\n');
}

export function buildRegistrationReviewCsvFilename({ teamId = '', formId = '', status = 'all', now = new Date() } = {}) {
    const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const safePart = (value, fallback) => cleanString(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || fallback;
    return `registration-review-${safePart(teamId, 'team')}-${safePart(formId, 'form')}-${safePart(status, 'all')}-${date}.csv`;
}
