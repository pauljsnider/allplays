const DEFAULT_PARTICIPANT_LABELS = ['Participant name', 'Birthdate'];
const DEFAULT_GUARDIAN_LABELS = ['Guardian name', 'Guardian email', 'Guardian phone'];
const DEFAULT_PAYMENT_SETTINGS = {
    offlinePaymentEnabled: false,
    onlineCheckoutEnabled: false
};
const ADMIN_REGISTRATION_FORM_STATUSES = ['draft', 'published', 'closed'];

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
    const feeAmountCents = parseAdminRegistrationFeeAmountCents(input.feeAmount);
    const status = normalizeAdminRegistrationFormStatus(input.status || (input.published === true ? 'published' : 'draft'));
    const installmentPlan = normalizeInstallmentPlan(input.installmentPlan || input);

    return {
        teamId: context.teamId || input.teamId || '',
        programType: String(input.programType || 'season').trim() || 'season',
        programName: String(input.title || input.programName || '').trim(),
        title: String(input.title || input.programName || '').trim(),
        description: String(input.description || '').trim(),
        season: String(input.season || '').trim(),
        feeAmountCents,
        currency: 'USD',
        installmentPlan,
        participantFields: fieldLabelsToDefinitions(
            participantLabels.length ? participantLabels : DEFAULT_PARTICIPANT_LABELS,
            'participant'
        ),
        guardianFields: fieldLabelsToDefinitions(
            guardianLabels.length ? guardianLabels : DEFAULT_GUARDIAN_LABELS,
            'guardian'
        ),
        registrationOptions: normalizeRegistrationOptions(input.registrationOptions),
        paymentSettings: normalizePaymentSettings(input.paymentSettings),
        discountRules: normalizeRegistrationDiscountRules(input.discountRules),
        backgroundCheck: normalizeBackgroundCheckSettings(input.backgroundCheck),
        waiverText: String(input.waiverText || '').trim(),
        status,
        published: isPublishedAdminRegistrationFormStatus(status)
    };
}

export function normalizeAdminRegistrationFormStatus(status = 'draft') {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'open') return 'published';
    return ADMIN_REGISTRATION_FORM_STATUSES.includes(normalized) ? normalized : 'draft';
}

export function isPublishedAdminRegistrationFormStatus(status = 'draft') {
    const normalized = normalizeAdminRegistrationFormStatus(status);
    return normalized === 'published' || normalized === 'closed';
}

export function parseAdminRegistrationFeeAmountCents(value = '') {
    const normalized = String(value ?? '').replace(/[$,]/g, '').trim();
    if (!normalized) return 0;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.max(0, Math.round(parsed * 100));
}

export function normalizeBackgroundCheck(settings = {}) {
    const required = settings?.required === true;
    const instructions = String(settings?.instructions || '').trim();

    return {
        required,
        instructions: required ? instructions : ''
    };
}

export function normalizePaymentSettings(settings = {}) {
    return {
        offlinePaymentEnabled: settings?.offlinePaymentEnabled === true,
        onlineCheckoutEnabled: settings?.onlineCheckoutEnabled === true
    };
}

export const SCREENING_STATUSES = ['pending', 'submitted', 'cleared', 'flagged', 'expired', 'rejected'];

export function normalizeScreeningStatus(status = 'pending') {
    const normalized = String(status || 'pending').trim().toLowerCase().replace(/[ _]+/g, '-');
    return SCREENING_STATUSES.includes(normalized) ? normalized : 'pending';
}

export function normalizeBackgroundCheckSettings(settings = {}) {
    const policy = normalizeBackgroundCheck(settings);
    const enabled = settings?.enabled === true || settings?.backgroundCheckEnabled === true || policy.required === true;
    return {
        ...policy,
        enabled,
        initialScreeningStatus: enabled ? normalizeScreeningStatus(settings?.initialScreeningStatus) : 'pending',
        providerName: String(settings?.providerName || '').trim()
    };
}

export function normalizeInstallmentPlan(input = {}) {
    const enabled = input.installmentPlanEnabled === true || input.enabled === true;
    if (!enabled) return null;

    const installmentCount = Math.max(2, Math.min(12, Math.floor(Number(input.installmentCount) || 0)));
    const intervalDays = Math.max(1, Math.min(365, Math.floor(Number(input.intervalDays) || 30)));
    const firstDueDate = String(input.firstDueDate || '').trim();

    if (!firstDueDate) return null;

    return {
        enabled: true,
        title: String(input.title || 'Installment plan').trim() || 'Installment plan',
        installmentCount,
        firstDueDate,
        intervalDays
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

export function normalizeRegistrationDiscountRules(rules = []) {
    if (!Array.isArray(rules)) return [];

    return rules
        .map((rule, index) => {
            const type = normalizeDiscountType(rule?.type);
            const label = String(rule?.label || '').trim();
            const amountType = rule?.amountType === 'percent' ? 'percent' : 'fixed';
            const amountValue = amountType === 'percent'
                ? Math.min(100, Math.max(0, Number(rule?.amountValue || 0)))
                : Math.max(0, Math.round(Number(rule?.amountValue || 0) * 100));
            const earlyBirdDeadline = String(rule?.earlyBirdDeadline || '').trim();
            const minimumQuantity = Math.max(1, Math.floor(Number(rule?.minimumQuantity || 1)));

            if (!type || !label || amountValue <= 0) return null;
            if (type === 'early_bird' && !/^\d{4}-\d{2}-\d{2}$/.test(earlyBirdDeadline)) return null;

            return {
                id: String(rule?.id || '').trim() || `discount_${index + 1}`,
                type,
                label,
                amountType,
                amountValue,
                earlyBirdDeadline: type === 'early_bird' ? earlyBirdDeadline : '',
                minimumQuantity: type === 'quantity' ? minimumQuantity : 1,
                active: rule?.active !== false,
                sortOrder: index
            };
        })
        .filter(Boolean);
}

export function parseRegistrationDiscountRulesText(value = '') {
    return String(value || '')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
            const [rawLabel, rawValue = ''] = line.split(':');
            const label = String(rawLabel || '').trim();
            const valueText = rawValue.trim();
            const percentMatch = valueText.match(/(\d+(?:\.\d+)?)\s*%/);
            const fixedMatch = valueText.match(/\$?\s*(\d+(?:\.\d+)?)/);
            const amountType = percentMatch ? 'percent' : 'fixed';
            const amountValue = Number((percentMatch || fixedMatch || [0, 0])[1] || 0);
            const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
            const quantityMatch = line.match(/(\d+)\s*\+/);
            const lower = line.toLowerCase();
            const type = lower.includes('early') || dateMatch ? 'early_bird' : 'quantity';

            return {
                id: `discount_${index + 1}`,
                type,
                label: label || (type === 'early_bird' ? 'Early bird discount' : 'Sibling/cart discount'),
                amountType,
                amountValue,
                earlyBirdDeadline: dateMatch ? dateMatch[1] : '',
                minimumQuantity: quantityMatch ? Number(quantityMatch[1]) : 2,
                active: true
            };
        });
}

export function formatRegistrationDiscountRulesText(rules = []) {
    if (!Array.isArray(rules) || rules.length === 0) return '';

    return rules.map((rule) => {
        const amount = rule.amountType === 'percent' ? `${rule.amountValue}%` : `$${(Number(rule.amountValue || 0) / 100).toFixed(2)}`;
        if (rule.type === 'early_bird') {
            return `${rule.label || 'Early bird discount'} before ${rule.earlyBirdDeadline}: ${amount}`;
        }
        return `${rule.label || 'Sibling/cart discount'} ${rule.minimumQuantity || 2}+: ${amount}`;
    }).join('\n');
}

function normalizeDiscountType(type) {
    const normalized = String(type || '').toLowerCase().replace(/[ -]/g, '_');
    if (normalized === 'early_bird' || normalized === 'quantity') return normalized;
    return '';
}

export function validateAdminRegistrationFormPayload(payload = {}) {
    const errors = [];
    if (!payload.teamId) errors.push('Team is required.');
    if (!payload.programName) errors.push('Title is required.');
    if (!payload.waiverText) errors.push('Waiver text is required.');
    if (!ADMIN_REGISTRATION_FORM_STATUSES.includes(String(payload.status || 'draft'))) {
        errors.push('Registration status is invalid.');
    }
    if (!Number.isFinite(Number(payload.feeAmountCents)) || Number(payload.feeAmountCents) < 0) {
        errors.push('Fee amount must be zero or greater.');
    }
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
    guardianLabels: DEFAULT_GUARDIAN_LABELS,
    paymentSettings: DEFAULT_PAYMENT_SETTINGS
};
