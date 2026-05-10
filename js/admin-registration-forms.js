const DEFAULT_PARTICIPANT_LABELS = ['Participant name', 'Birthdate'];
const DEFAULT_GUARDIAN_LABELS = ['Guardian name', 'Guardian email', 'Guardian phone'];

export function fieldLabelsToDefinitions(labels = [], prefix = 'field') {
    return labels
        .map((label) => String(label || '').trim())
        .filter(Boolean)
        .map((label, index) => ({
            id: `${prefix}_${index + 1}`,
            label,
            type: inferFieldType(label),
            required: true,
            options: []
        }));
}

export function parseFieldLabels(value = '') {
    return String(value || '')
        .split(/[\n,]+/)
        .map((label) => label.trim())
        .filter(Boolean);
}

export function formatFieldLabels(fields = [], fallbackLabels = []) {
    const labels = Array.isArray(fields) ? fields.map((field) => field?.label).filter(Boolean) : [];
    return (labels.length ? labels : fallbackLabels).join('\n');
}

export function buildAdminRegistrationFormPayload(input = {}, context = {}) {
    const participantLabels = parseFieldLabels(input.participantFieldsText);
    const guardianLabels = parseFieldLabels(input.guardianFieldsText);
    const feeAmount = Number(input.feeAmount || 0);
    const status = input.status === 'published' ? 'published' : 'draft';

    return {
        teamId: context.teamId || input.teamId || '',
        programType: String(input.programType || 'season').trim() || 'season',
        programName: String(input.title || input.programName || '').trim(),
        title: String(input.title || input.programName || '').trim(),
        description: String(input.description || '').trim(),
        season: String(input.season || '').trim(),
        feeAmountCents: Math.max(0, Math.round(feeAmount * 100)),
        currency: 'USD',
        participantFields: fieldLabelsToDefinitions(
            participantLabels.length ? participantLabels : DEFAULT_PARTICIPANT_LABELS,
            'participant'
        ),
        guardianFields: fieldLabelsToDefinitions(
            guardianLabels.length ? guardianLabels : DEFAULT_GUARDIAN_LABELS,
            'guardian'
        ),
        registrationOptions: normalizeRegistrationOptions(input.registrationOptions),
        waiverText: String(input.waiverText || '').trim(),
        status,
        published: status === 'published'
    };
}

export function normalizeRegistrationOptions(options = []) {
    if (!Array.isArray(options)) return [];

    return options
        .map((option) => {
            const label = String(option?.label || '').trim();
            if (!label) return null;
            const rawCapacity = option?.capacityLimit;
            const capacityLimit = rawCapacity === '' || rawCapacity === null || rawCapacity === undefined
                ? null
                : Math.max(0, Math.floor(Number(rawCapacity) || 0));
            return {
                id: String(option?.id || '').trim(),
                label,
                capacityLimit,
                active: option?.active !== false,
                waitlistEnabled: option?.waitlistEnabled === true
            };
        })
        .filter(Boolean)
        .map((option, index) => ({
            ...option,
            id: option.id || `option_${index + 1}`,
            sortOrder: index
        }));
}

export function validateAdminRegistrationFormPayload(payload = {}) {
    const errors = [];
    if (!payload.teamId) errors.push('Team is required.');
    if (!payload.programName) errors.push('Title is required.');
    if (!payload.waiverText) errors.push('Waiver text is required.');
    if (!Array.isArray(payload.participantFields) || payload.participantFields.length < 1) {
        errors.push('At least one participant field is required.');
    }
    if (!Array.isArray(payload.guardianFields) || payload.guardianFields.length < 1) {
        errors.push('At least one guardian field is required.');
    }
    return errors;
}

export function getAdminRegistrationShareUrl(teamId, formId, origin = '') {
    const base = String(origin || '').replace(/\/$/, '');
    return `${base}/registration.html?teamId=${encodeURIComponent(teamId)}&formId=${encodeURIComponent(formId)}`;
}

function inferFieldType(label) {
    const normalized = String(label || '').toLowerCase();
    if (normalized.includes('email')) return 'email';
    if (normalized.includes('phone')) return 'tel';
    if (/\b(date|birth|dob)\b/.test(normalized) || normalized.includes('birthdate')) return 'date';
    return 'text';
}

export const adminRegistrationDefaults = {
    participantLabels: DEFAULT_PARTICIPANT_LABELS,
    guardianLabels: DEFAULT_GUARDIAN_LABELS
};
