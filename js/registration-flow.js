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
        published: form.published === true || form.status === 'published',
        registrationOptions: normalizeRegistrationOptions(form.registrationOptions || form.options || [])
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

export function normalizeRegistrationOptions(options = []) {
    if (!Array.isArray(options)) return [];

    return options
        .map((option, index) => {
            const id = String(option.id || option.key || `option_${index + 1}`).trim();
            const title = String(option.title || option.name || option.label || `Option ${index + 1}`).trim();
            const capacityNumber = Number(option.capacityLimit ?? option.capacity ?? option.maxRegistrations);
            const capacityLimit = Number.isFinite(capacityNumber) && capacityNumber > 0 ? Math.floor(capacityNumber) : null;

            return {
                id,
                countKey: buildRegistrationOptionCountKey(id),
                title,
                description: String(option.description || '').trim(),
                capacityLimit,
                waitlistEnabled: option.waitlistEnabled === true || option.waitlist === true,
                active: option.active !== false && option.status !== 'inactive' && option.status !== 'archived'
            };
        })
        .filter(option => option.id && option.title);
}

export function buildRegistrationOptionCountKey(optionId = '') {
    const key = String(optionId || '').trim().replace(/[^A-Za-z0-9_-]/g, '_');
    return key || 'option';
}

export function getActiveRegistrationOptions(form = {}) {
    return (form.registrationOptions || []).filter(option => option.active !== false);
}

export function requiresRegistrationOption(form = {}) {
    return getActiveRegistrationOptions(form).length > 0;
}

export function getRegistrationOptionById(form = {}, optionId = '') {
    return getActiveRegistrationOptions(form).find(option => option.id === optionId) || null;
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

    if (requiresRegistrationOption(form) && !getRegistrationOptionById(form, submission.selectedOptionId)) {
        errors.push('Please select a registration option.');
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

export function buildPendingRegistrationRecord({ form, participant, guardian, waiverAccepted, now, selectedOption = null, status = 'pending' }) {
    return buildRegistrationRecord({
        form,
        participant,
        guardian,
        waiverAccepted,
        now,
        selectedOption,
        status
    });
}

export function buildRegistrationRecord({ form, participant, guardian, waiverAccepted, now, selectedOption = null, status = 'pending' }) {
    const record = {
        teamId: form.teamId,
        formId: form.id,
        programName: form.programName,
        feeAmountCents: form.feeAmountCents,
        currency: form.currency,
        participant,
        guardian,
        waiverAccepted: waiverAccepted === true,
        waiverText: form.waiverText,
        status,
        submittedAt: now,
        source: 'public-registration'
    };

    if (selectedOption) {
        record.selectedOption = {
            id: selectedOption.id,
            countKey: selectedOption.countKey,
            title: selectedOption.title,
            feeAmountCents: selectedOption.feeAmountCents ?? form.feeAmountCents,
            capacityLimit: selectedOption.capacityLimit,
            waitlistEnabled: selectedOption.waitlistEnabled === true
        };
    }

    if (status === 'waitlisted') {
        record.waitlistedAt = now;
    }

    return record;
}

export function decideRegistrationPlacement({ form, selectedOptionId, counts = {} }) {
    const selectedOption = getRegistrationOptionById(form, selectedOptionId);
    if (!selectedOption) {
        return { status: 'blocked', reason: 'missing-option', message: 'Please select a registration option.' };
    }

    const optionCounts = counts[selectedOption.countKey] || counts[selectedOption.id] || {};
    const enrolledCount = Number(optionCounts.enrolled || 0);
    const waitlistedCount = Number(optionCounts.waitlisted || 0);
    const hasCapacity = !selectedOption.capacityLimit || enrolledCount < selectedOption.capacityLimit;

    if (hasCapacity) {
        return {
            status: 'pending',
            selectedOption,
            nextCounts: { enrolled: enrolledCount + 1, waitlisted: waitlistedCount }
        };
    }

    if (selectedOption.waitlistEnabled) {
        return {
            status: 'waitlisted',
            selectedOption,
            nextCounts: { enrolled: enrolledCount, waitlisted: waitlistedCount + 1 }
        };
    }

    return {
        status: 'blocked',
        reason: 'option-full',
        selectedOption,
        message: `${selectedOption.title} is full and is not accepting waitlist registrations.`
    };
}
