import { describe, expect, it } from 'vitest';
import {
    buildInstallmentSchedule,
    buildPendingRegistrationRecord,
    calculateRegistrationFeeSnapshot,
    collectFieldValues,
    decideRegistrationPlacement,
    formatFeeAmount,
    getRegistrationPaymentNotice,
    hasRegistrationPaymentSettings,
    hasOnlineRegistrationCheckout,
    getPaymentPlanChoices,
    formatFeeSnapshotLines,
    normalizeRegistrationForm,
    validateRegistrationSubmission
} from '../../js/registration-flow.js';
import fs from 'node:fs';

describe('public registration flow', () => {
    it('normalizes a published form with participant, guardian, fee, and waiver details', () => {
        const form = normalizeRegistrationForm({
            name: 'Spring Soccer',
            season: 'Spring 2026',
            feeAmountCents: 12500,
            paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: true },
            playerFields: [{ key: 'firstName', name: 'First name', required: true }],
            guardianFields: [{ id: 'email', label: 'Email', type: 'email', required: true }],
            waiver: 'I accept the risk.',
            status: 'published'
        }, { teamId: 'team-1', formId: 'form-1' });

        expect(form).toMatchObject({
            id: 'form-1',
            teamId: 'team-1',
            programName: 'Spring Soccer',
            season: 'Spring 2026',
            feeAmountCents: 12500,
            paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: true },
            published: true,
            waiverText: 'I accept the risk.'
        });
        expect(form.participantFields[0]).toMatchObject({ id: 'firstName', label: 'First name', required: true });
        expect(form.guardianFields[0]).toMatchObject({ id: 'email', type: 'email' });
        expect(form.paymentSettings).toEqual({ offlinePaymentEnabled: true, onlineCheckoutEnabled: true });
        expect(hasRegistrationPaymentSettings(form)).toBe(true);
        expect(hasOnlineRegistrationCheckout(form)).toBe(true);
        expect(getRegistrationPaymentNotice(form)).toContain('Online checkout is available');
        expect(formatFeeAmount(form.feeAmountCents, form.currency)).toBe('$125.00');
    });

    it('requires published state, required fields, and explicit waiver acceptance', () => {
        const form = normalizeRegistrationForm({
            programName: 'Clinic',
            published: true,
            participantFields: [{ id: 'playerName', label: 'Player name', required: true }],
            guardianFields: [{ id: 'guardianEmail', label: 'Guardian email', required: true }],
            waiverText: 'Waiver'
        }, { teamId: 'team-1', formId: 'form-1' });

        expect(validateRegistrationSubmission(form, {
            participant: { playerName: '' },
            guardian: { guardianEmail: 'parent@example.com' },
            waiverAccepted: false
        })).toEqual([
            'Participant Player name is required.',
            'Waiver acceptance is required.'
        ]);

        expect(validateRegistrationSubmission(form, {
            participant: { playerName: 'Sam' },
            guardian: { guardianEmail: 'parent@example.com' },
            waiverAccepted: true
        })).toEqual([]);
    });

    it('builds a pending registration record for unauthenticated submission', () => {
        const form = normalizeRegistrationForm({
            programName: 'Clinic',
            feeAmountCents: 5000,
            paymentSettings: { offlinePaymentEnabled: true },
            published: true,
            waiverText: 'Waiver'
        }, { teamId: 'team-1', formId: 'form-1' });
        const now = { sentinel: 'serverTimestamp' };

        expect(buildPendingRegistrationRecord({
            form,
            participant: collectFieldValues([{ id: 'playerName' }], { playerName: ' Sam ' }),
            guardian: collectFieldValues([{ id: 'email' }], { email: ' parent@example.com ' }),
            waiverAccepted: true,
            now
        })).toEqual({
            teamId: 'team-1',
            formId: 'form-1',
            programName: 'Clinic',
            feeAmountCents: 5000,
            currency: 'USD',
            paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: false },
            participant: { playerName: 'Sam' },
            guardian: { email: 'parent@example.com' },
            waiverAccepted: true,
            waiverText: 'Waiver',
            paymentPlan: {
                id: 'pay_full',
                type: 'pay_full',
                title: 'Pay in full',
                installmentCount: 1,
                totalBalanceDueCents: 5000,
                schedule: [{ label: 'Pay in full', dueDate: '', amountCents: 5000 }]
            },
            status: 'pending',
            submittedAt: now,
            source: 'public-registration',
            feeSnapshot: {
                currency: 'USD',
                quantity: 1,
                originalFeeAmountCents: 5000,
                subtotalAmountCents: 5000,
                appliedDiscounts: [],
                finalAmountDueCents: 5000
            }
        });
    });

    it('adds initial manual screening fields for background-check-enabled forms', () => {
        const form = normalizeRegistrationForm({
            programName: 'Volunteer Coach',
            published: true,
            backgroundCheck: { enabled: true, initialScreeningStatus: 'pending', providerName: 'Protect Youth Sports' }
        }, { teamId: 'team-1', formId: 'form-1' });

        expect(form.backgroundCheck).toEqual({
            enabled: true,
            initialScreeningStatus: 'pending',
            providerName: 'Protect Youth Sports'
        });
        expect(buildPendingRegistrationRecord({
            form,
            participant: {},
            guardian: {},
            waiverAccepted: true,
            now: { sentinel: 'serverTimestamp' }
        })).toMatchObject({
            screeningRequired: true,
            screeningStatus: 'pending',
            screeningProvider: 'Protect Youth Sports',
            screeningProviderReference: ''
        });
    });

    it('normalizes installment plans and snapshots selected schedules', () => {
        const form = normalizeRegistrationForm({
            programName: 'Clinic',
            feeAmountCents: 10000,
            published: true,
            installmentPlan: { enabled: true, installmentCount: 3, firstDueDate: '2026-06-01', intervalDays: 30 }
        }, { teamId: 'team-1', formId: 'form-1' });

        expect(getPaymentPlanChoices(form)).toEqual([
            { id: 'pay_full', type: 'pay_full', title: 'Pay in full' },
            { id: 'installments', type: 'installments', title: 'Installment plan' }
        ]);
        expect(buildInstallmentSchedule(10000, form.installmentPlan)).toEqual([
            { label: 'Installment 1', dueDate: '2026-06-01', amountCents: 3333 },
            { label: 'Installment 2', dueDate: '2026-07-01', amountCents: 3333 },
            { label: 'Installment 3', dueDate: '2026-07-31', amountCents: 3334 }
        ]);
        expect(validateRegistrationSubmission(form, { waiverAccepted: true, selectedPaymentPlanId: '' })).toEqual([
            'Please select a payment plan.'
        ]);

        const record = buildPendingRegistrationRecord({
            form,
            participant: {},
            guardian: {},
            waiverAccepted: true,
            selectedPaymentPlanId: 'installments',
            now: { sentinel: 'serverTimestamp' }
        });
        expect(record.paymentPlan).toEqual({
            id: 'installments',
            type: 'installments',
            title: 'Installment plan',
            installmentCount: 3,
            totalBalanceDueCents: 10000,
            schedule: [
                { label: 'Installment 1', dueDate: '2026-06-01', amountCents: 3333 },
                { label: 'Installment 2', dueDate: '2026-07-01', amountCents: 3333 },
                { label: 'Installment 3', dueDate: '2026-07-31', amountCents: 3334 }
            ]
        });
    });

    it('calculates eligible registration discounts for fee previews and snapshots', () => {
        const form = normalizeRegistrationForm({
            programName: 'Clinic',
            feeAmountCents: 10000,
            currency: 'USD',
            published: true,
            discountRules: [
                { id: 'early', type: 'early_bird', label: 'Early bird', amountType: 'fixed', amountValue: 2500, earlyBirdDeadline: '2026-03-01' },
                { id: 'siblings', type: 'quantity', label: 'Sibling/cart', amountType: 'percent', amountValue: 10, minimumQuantity: 2 }
            ]
        }, { teamId: 'team-1', formId: 'form-1' });

        const snapshot = calculateRegistrationFeeSnapshot(form, { quantity: 2, now: new Date('2026-02-15T12:00:00Z') });

        expect(snapshot).toEqual({
            currency: 'USD',
            quantity: 2,
            originalFeeAmountCents: 10000,
            subtotalAmountCents: 20000,
            appliedDiscounts: [
                { id: 'early', type: 'early_bird', label: 'Early bird', amountType: 'fixed', amountValue: 2500, amountCents: 2500 },
                { id: 'siblings', type: 'quantity', label: 'Sibling/cart', amountType: 'percent', amountValue: 10, amountCents: 1750 }
            ],
            finalAmountDueCents: 15750
        });
        expect(formatFeeSnapshotLines(snapshot).map(line => line.label)).toEqual([
            'Original fee',
            'Early bird',
            'Sibling/cart',
            'Final amount due'
        ]);
    });

    it('requires an active registration option when configured', () => {
        const form = normalizeRegistrationForm({
            programName: 'Clinic',
            published: true,
            registrationOptions: [
                { id: 'u10', title: 'U10', capacityLimit: 2, waitlistEnabled: true },
                { id: 'archived', title: 'Archived', active: false }
            ]
        }, { teamId: 'team-1', formId: 'form-1' });

        expect(form.registrationOptions[0]).toMatchObject({
            id: 'u10',
            countKey: 'u10',
            title: 'U10',
            capacityLimit: 2,
            waitlistEnabled: true,
            active: true
        });
        expect(validateRegistrationSubmission(form, { waiverAccepted: true })).toEqual([
            'Please select a registration option.'
        ]);
        expect(validateRegistrationSubmission(form, { waiverAccepted: true, selectedOptionId: 'u10' })).toEqual([]);
    });

    it('places selected option registrations into pending, waitlisted, or blocked states', () => {
        const form = normalizeRegistrationForm({
            programName: 'Clinic',
            published: true,
            registrationOptions: [
                { id: 'u10', title: 'U10', capacityLimit: 2, waitlistEnabled: true },
                { id: 'u12', title: 'U12', capacityLimit: 1, waitlistEnabled: false }
            ]
        }, { teamId: 'team-1', formId: 'form-1' });

        expect(decideRegistrationPlacement({
            form,
            selectedOptionId: 'u10',
            counts: { u10: { enrolled: 1, waitlisted: 0 } }
        })).toMatchObject({
            status: 'pending',
            nextCounts: { enrolled: 2, waitlisted: 0 }
        });

        expect(decideRegistrationPlacement({
            form,
            selectedOptionId: 'u10',
            counts: { u10: { enrolled: 2, waitlisted: 0 } }
        })).toMatchObject({
            status: 'waitlisted',
            nextCounts: { enrolled: 2, waitlisted: 1 }
        });

        expect(decideRegistrationPlacement({
            form,
            selectedOptionId: 'u12',
            counts: { u12: { enrolled: 1, waitlisted: 0 } }
        })).toMatchObject({
            status: 'blocked',
            reason: 'option-full',
            message: 'U12 is full and is not accepting waitlist registrations.'
        });
    });

    it('includes selected option metadata and waitlist lifecycle fields on records', () => {
        const form = normalizeRegistrationForm({
            programName: 'Clinic',
            feeAmountCents: 5000,
            published: true,
            registrationOptions: [{ id: 'u10', title: 'U10', capacityLimit: 1, waitlistEnabled: true }]
        }, { teamId: 'team-1', formId: 'form-1' });
        const now = { sentinel: 'serverTimestamp' };

        expect(buildPendingRegistrationRecord({
            form,
            participant: {},
            guardian: {},
            waiverAccepted: true,
            selectedOption: form.registrationOptions[0],
            status: 'waitlisted',
            now
        })).toMatchObject({
            status: 'waitlisted',
            waitlistedAt: now,
            selectedOption: {
                id: 'u10',
                countKey: 'u10',
                title: 'U10',
                feeAmountCents: 5000,
                capacityLimit: 1,
                waitlistEnabled: true
            }
        });
    });

    it('wires registration page to public form reads and pending registration writes', () => {
        const page = fs.readFileSync('registration.html', 'utf8');
        expect(page).toContain("doc(db, 'teams', teamId, 'registrationForms', formId)");
        expect(page).toContain("collection(db, 'teams', teamId, 'registrationForms', formId, 'registrations')");
        expect(page).toContain('registration-options-section');
        expect(page).toContain('registration-payment-section');
        expect(page).toContain('getRegistrationPaymentNotice');
        expect(page).toContain('hasOnlineRegistrationCheckout');
        expect(page).toContain('payment-plan-section');
        expect(page).toContain('getPaymentPlanChoices');
        expect(page).toContain('fee-summary-section');
        expect(page).toContain('calculateRegistrationFeeSnapshot');
        expect(page).toContain('const amountCents = Math.max(0, Number(feeSnapshot?.finalAmountDueCents || 0));');
        expect(page).toContain('? await submitRegistrationWithCapacity(submission)');
        expect(page).toContain(': await submitRegistrationWithoutCapacity(submission);');
        expect(page).toContain('registrationId: result.registrationId');
        expect(page).toContain('return { status: \'pending\', registrationId: registrationRef.id };');
        expect(page).toContain('return { status: placement.status, registrationId: registrationRef.id };');
        expect(page).toContain("paymentLoadingState.classList.add('hidden');");
        expect(page).toContain('runTransaction(db, async (transaction)');
        expect(page).toContain('decideRegistrationPlacement');
        expect(page).toContain('registrationCapacityUpdateId: registrationRef.id');
        expect(page).toContain('Registration form capacity tracking is not properly configured.');
        expect(page).toContain('option-full');
        expect(page).toContain('waiver-accepted');
        expect(page).toContain('confirmation-message');
        expect(page).toContain('labelText.textContent = field.label');
        expect(page).toContain("requiredMark.textContent = ' *'");
        expect(page.indexOf("const errorMessage = document.getElementById('error-message');")).toBeLessThan(page.indexOf('// Handle return from Stripe checkout'));

        const rules = fs.readFileSync('firestore.rules', 'utf8');
        expect(rules).toContain('match /registrationForms/{formId}');
        expect(rules).toContain('allow create: if (');
        expect(rules).toContain('function registrationFormPath(teamId, formId)');
        expect(rules).toContain('isPublishedRegistrationForm(get(formPath).data)');
        expect(rules).toContain("data.status in ['pending', 'waitlisted']");
        expect(rules).toContain("'paymentSettings'");
        expect(rules).toContain("'selectedOption'");
        expect(rules).toContain('isRegistrationPaymentSettingsPayloadValid');
        expect(rules).toContain("'paymentPlan'");
        expect(rules).toContain('isRegistrationPaymentPlanValid');
        expect(rules).toContain("'feeSnapshot'");
        expect(rules).toContain("'screeningRequired'");
        expect(rules).toContain("'screeningStatus'");
        expect(rules).toContain("data.screeningStatus == get(registrationFormPath(teamId, formId)).data.get('backgroundCheck', {}).get('initialScreeningStatus', 'pending')");
        expect(rules).toContain('isRegistrationFeeSnapshotValid');
        expect(rules).toContain('isPublicRegistrationCapacityCounterUpdate');
        expect(rules).toContain('registrationCapacityUpdateId');
        expect(rules).toContain('existsAfter(registrationPath)');
        expect(rules).toContain('isPublicPendingRegistrationCreate(teamId, formId, registrationId)');
        expect(rules).toContain("affectedKeys().hasOnly(['registrationOptionCounts', 'registrationCapacityUpdateId', 'updatedAt'])");
        expect(rules).toContain("afterOption.diff(beforeOption).affectedKeys().hasOnly(['enrolled', 'waitlisted'])");
        expect(rules).toContain('data.waiverAccepted == true');
        expect(rules).toContain('hasOnlyFlatStringValues(data.participant)');
        expect(rules).toContain('hasOnlyFlatStringValues(data.guardian)');
        expect(rules).toContain('data.keys().size() <= 20');
    });

    it('wires registration Stripe checkout to deployed functions', () => {
        const functionsSource = fs.readFileSync('functions/index.js', 'utf8');

        expect(functionsSource).toContain('exports.createStripeRegistrationCheckout');
        expect(functionsSource).toContain("product: 'registration'");
        expect(functionsSource).toContain('getRegistrationCheckoutAmountCents(registration)');
        expect(functionsSource).toContain("form.paymentSettings?.onlineCheckoutEnabled !== true");
        expect(functionsSource).toContain("checkoutStatus: 'open'");
        expect(functionsSource).toContain("paymentStatus: 'checkout_open'");
        expect(functionsSource).toContain('shouldProcessRegistrationCheckoutEvent(event)');
    });
});
