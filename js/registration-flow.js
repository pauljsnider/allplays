export function normalizeRegistrationForm(form = {}, context = {}) {
    const programName = String(form.programName || form.title || form.name || '').trim();
    const feeAmountCents = Number.isFinite(Number(form.feeAmountCents)) ? Number(form.feeAmountCents) : 0;

    return {
        id: context.formId || form.id || '',
        teamId: context.teamId || form.teamId || '',
        programName,
        description: String(form.description || form.programDescription || '').trim(),
        season: String(form.season || '').trim(),
        feeAmountCents,
        currency: String(form.currency || 'USD').trim() || 'USD',
        participantFields: normalizeFields(form.participantFields || form.playerFields || []),
        guardianFields: normalizeFields(form.guardianFields || []),
        waiverText: String(form.waiverText || form.waiver || '').trim(),
        status: String(form.status || '').trim(),
        published: form.published === true || form.status === 'published'
    };
}

export function normalizeFields(fields = []) {
    if (!Array.isArray(fields)) return [];

    return fields
        .map((field, index) => ({
            id: String(field.id || field.key || `field_${index + 1}`).trim(),
            label: String(field.label || field.name || field.id || field.key || `Field ${index + 1}`).trim(),
            type: normalizeFieldType(field.type),
            required: field.required === true,
            options: Array.isArray(field.options) ? field.options.map(option => String(option || '').trim()).filter(Boolean) : []
        }))
        .filter(field => field.id && field.label);
}

export function normalizeFieldType(type) {
    const normalized = String(type || 'text').toLowerCase();
    if (['email', 'tel', 'phone', 'date', 'number', 'textarea', 'select'].includes(normalized)) {
        return normalized === 'phone' ? 'tel' : normalized;
    }
    return 'text';
}

export function formatFeeAmount(feeAmountCents = 0, currency = 'USD') {
    const amount = Number(feeAmountCents) || 0;
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD'
    }).format(amount / 100);
}

export function collectFieldValues(fields = [], values = {}) {
    return fields.reduce((result, field) => {
        result[field.id] = String(values[field.id] || '').trim();
        return result;
    }, {});
}

export function validateRegistrationSubmission(form, submission = {}) {
    const errors = [];
    if (!form || !form.published) {
        errors.push('This registration form is not accepting submissions.');
    }

    validateRequiredFields(form.participantFields || [], submission.participant || {}, 'Participant', errors);
    validateRequiredFields(form.guardianFields || [], submission.guardian || {}, 'Guardian', errors);

    if (!submission.waiverAccepted) {
        errors.push('Waiver acceptance is required.');
    }

    return errors;
}

function validateRequiredFields(fields, values, groupLabel, errors) {
    fields.forEach((field) => {
        if (field.required && !String(values[field.id] || '').trim()) {
            errors.push(`${groupLabel} ${field.label} is required.`);
        }
    });
}

export function buildPendingRegistrationRecord({ form, participant, guardian, waiverAccepted, now }) {
    return {
        teamId: form.teamId,
        formId: form.id,
        programName: form.programName,
        feeAmountCents: form.feeAmountCents,
        currency: form.currency,
        participant,
        guardian,
        waiverAccepted: waiverAccepted === true,
        waiverText: form.waiverText,
        status: 'pending',
        submittedAt: now,
        source: 'public-registration'
    };
}
