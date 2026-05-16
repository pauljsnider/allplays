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
        installmentPlan: normalizeInstallmentPlan(form.installmentPlan),
        participantFields: normalizeFields(form.participantFields || form.playerFields || []),
        guardianFields: normalizeFields(form.guardianFields || []),
        waiverText: String(form.waiverText || form.waiver || '').trim(),
        status: String(form.status || '').trim(),
        published: form.published === true || form.status === 'published',
        paymentSettings: normalizePaymentSettings(form.paymentSettings),
        discountRules: normalizeRegistrationDiscountRules(form.discountRules || []),
        registrationOptions: normalizeRegistrationOptions(form.registrationOptions || form.options || [])
    };
}

export function normalizePaymentSettings(settings = {}) {
    return {
        offlinePaymentEnabled: settings?.offlinePaymentEnabled === true,
        onlineCheckoutEnabled: settings?.onlineCheckoutEnabled === true
    };
}

export function hasRegistrationPaymentSettings(form = {}) {
    return form.paymentSettings?.offlinePaymentEnabled === true || form.paymentSettings?.onlineCheckoutEnabled === true;
}

export function getRegistrationPaymentNotice(form = {}) {
    const settings = form.paymentSettings || {};
    if (settings.offlinePaymentEnabled && settings.onlineCheckoutEnabled) {
        return 'Offline payment is accepted for this registration. Online checkout is planned, but online payment processing is not available yet.';
    }
    if (settings.offlinePaymentEnabled) {
        return 'Offline payment is accepted for this registration. The organizer will share payment instructions after review.';
    }
    if (settings.onlineCheckoutEnabled) {
        return 'Online checkout is planned for this registration, but online payment processing is not available yet.';
    }
    return '';
}

export function normalizeInstallmentPlan(plan = null) {
    if (!plan || plan.enabled !== true) return null;

    const installmentCount = Math.max(2, Math.min(12, Math.floor(Number(plan.installmentCount) || 0)));
    const intervalDays = Math.max(1, Math.min(365, Math.floor(Number(plan.intervalDays) || 30)));
    const firstDueDate = String(plan.firstDueDate || '').trim();
    if (!firstDueDate) return null;

    return {
        enabled: true,
        title: String(plan.title || 'Installment plan').trim() || 'Installment plan',
        installmentCount,
        firstDueDate,
        intervalDays
    };
}

export function hasInstallmentPlan(form = {}) {
    return form.installmentPlan?.enabled === true;
}

export function getPaymentPlanChoices(form = {}) {
    const payInFull = { id: 'pay_full', type: 'pay_full', title: 'Pay in full' };
    if (!hasInstallmentPlan(form)) return [payInFull];
    return [payInFull, { id: 'installments', type: 'installments', title: form.installmentPlan.title || 'Installment plan' }];
}

export function buildPaymentPlanSnapshot(form = {}, selectedPaymentPlanId = 'pay_full') {
    const totalBalanceDueCents = Math.max(0, Math.round(Number(form.feeAmountCents) || 0));
    const useInstallments = selectedPaymentPlanId === 'installments' && hasInstallmentPlan(form);
    const schedule = useInstallments
        ? buildInstallmentSchedule(totalBalanceDueCents, form.installmentPlan)
        : [{ label: 'Pay in full', dueDate: form.installmentPlan?.firstDueDate || '', amountCents: totalBalanceDueCents }];

    return {
        id: useInstallments ? 'installments' : 'pay_full',
        type: useInstallments ? 'installments' : 'pay_full',
        title: useInstallments ? form.installmentPlan.title : 'Pay in full',
        installmentCount: schedule.length,
        totalBalanceDueCents,
        schedule
    };
}

export function buildInstallmentSchedule(totalBalanceDueCents = 0, plan = {}) {
    const count = Math.max(2, Math.min(12, Math.floor(Number(plan.installmentCount) || 2)));
    const baseAmount = Math.floor(totalBalanceDueCents / count);
    const remainder = totalBalanceDueCents - (baseAmount * count);
    const firstDate = parseLocalDate(plan.firstDueDate);
    const intervalDays = Math.max(1, Math.floor(Number(plan.intervalDays) || 30));

    return Array.from({ length: count }, (_, index) => {
        const dueDate = firstDate ? addDays(firstDate, intervalDays * index) : null;
        return {
            label: `Installment ${index + 1}`,
            dueDate: dueDate ? formatLocalDate(dueDate) : String(plan.firstDueDate || ''),
            amountCents: baseAmount + (index === count - 1 ? remainder : 0)
        };
    });
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

export function normalizeRegistrationDiscountRules(rules = []) {
    if (!Array.isArray(rules)) return [];

    return rules
        .map((rule, index) => {
            const type = String(rule?.type || '').toLowerCase();
            const amountType = rule?.amountType === 'percent' ? 'percent' : 'fixed';
            const amountValue = Math.max(0, Number(rule?.amountValue || 0));
            const earlyBirdDeadline = String(rule?.earlyBirdDeadline || '').trim();
            const minimumQuantity = Math.max(1, Math.floor(Number(rule?.minimumQuantity || 1)));
            if (!['early_bird', 'quantity'].includes(type) || amountValue <= 0) return null;

            return {
                id: String(rule?.id || `discount_${index + 1}`).trim(),
                type,
                label: String(rule?.label || (type === 'early_bird' ? 'Early bird discount' : 'Sibling/cart discount')).trim(),
                amountType,
                amountValue,
                earlyBirdDeadline,
                minimumQuantity,
                active: rule?.active !== false
            };
        })
        .filter(Boolean);
}

export function calculateRegistrationFeeSnapshot(form = {}, options = {}) {
    const currency = String(form.currency || 'USD').trim() || 'USD';
    const originalFeeAmountCents = Math.max(0, Math.round(Number(form.feeAmountCents || 0)));
    const quantity = Math.max(1, Math.floor(Number(options.quantity || 1)));
    const submittedAt = options.now instanceof Date ? options.now : new Date();
    const subtotalAmountCents = originalFeeAmountCents * quantity;
    let remainingAmountCents = subtotalAmountCents;
    const appliedDiscounts = [];

    normalizeRegistrationDiscountRules(form.discountRules || []).forEach((rule) => {
        if (!rule.active || !isDiscountRuleEligible(rule, { quantity, now: submittedAt })) return;
        const discountAmountCents = rule.amountType === 'percent'
            ? Math.round(remainingAmountCents * (rule.amountValue / 100))
            : Math.round(rule.amountValue);
        const appliedAmountCents = Math.min(remainingAmountCents, Math.max(0, discountAmountCents));
        if (appliedAmountCents <= 0) return;
        remainingAmountCents -= appliedAmountCents;
        appliedDiscounts.push({
            id: rule.id,
            type: rule.type,
            label: rule.label,
            amountType: rule.amountType,
            amountValue: rule.amountValue,
            amountCents: appliedAmountCents
        });
    });

    return {
        currency,
        quantity,
        originalFeeAmountCents,
        subtotalAmountCents,
        appliedDiscounts,
        finalAmountDueCents: remainingAmountCents
    };
}

function isDiscountRuleEligible(rule, { quantity, now }) {
    if (rule.type === 'quantity') return quantity >= rule.minimumQuantity;
    if (rule.type === 'early_bird') {
        const deadline = Date.parse(`${rule.earlyBirdDeadline}T23:59:59.999`);
        return Number.isFinite(deadline) && now.getTime() <= deadline;
    }
    return false;
}

export function formatFeeSnapshotLines(snapshot = {}) {
    const lines = [
        { label: 'Original fee', amountCents: snapshot.subtotalAmountCents ?? snapshot.originalFeeAmountCents ?? 0 }
    ];
    (snapshot.appliedDiscounts || []).forEach((discount) => {
        lines.push({ label: discount.label, amountCents: -Math.abs(Number(discount.amountCents || 0)) });
    });
    lines.push({ label: 'Final amount due', amountCents: snapshot.finalAmountDueCents ?? 0, strong: true });
    return lines;
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

    if (hasInstallmentPlan(form) && !getPaymentPlanChoices(form).some(choice => choice.id === submission.selectedPaymentPlanId)) {
        errors.push('Please select a payment plan.');
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

export function buildPendingRegistrationRecord({ form, participant, guardian, waiverAccepted, now, selectedOption = null, selectedPaymentPlanId = 'pay_full', status = 'pending', feeSnapshot = null }) {
    return buildRegistrationRecord({
        form,
        participant,
        guardian,
        waiverAccepted,
        now,
        selectedOption,
        selectedPaymentPlanId,
        status,
        feeSnapshot
    });
}

export function buildRegistrationRecord({ form, participant, guardian, waiverAccepted, now, selectedOption = null, selectedPaymentPlanId = 'pay_full', status = 'pending', feeSnapshot = null }) {
    const registrationFeeSnapshot = feeSnapshot || calculateRegistrationFeeSnapshot(form, { now: now instanceof Date ? now : new Date() });
    const paymentPlanForm = {
        ...form,
        feeAmountCents: registrationFeeSnapshot.finalAmountDueCents ?? form.feeAmountCents
    };
    const record = {
        teamId: form.teamId,
        formId: form.id,
        programName: form.programName,
        feeAmountCents: form.feeAmountCents,
        currency: form.currency,
        paymentSettings: normalizePaymentSettings(form.paymentSettings),
        feeSnapshot: registrationFeeSnapshot,
        participant,
        guardian,
        waiverAccepted: waiverAccepted === true,
        waiverText: form.waiverText,
        paymentPlan: buildPaymentPlanSnapshot(paymentPlanForm, selectedPaymentPlanId),
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

function parseLocalDate(value = '') {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function addDays(date, days) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

function formatLocalDate(date) {
    return date.toISOString().slice(0, 10);
}
