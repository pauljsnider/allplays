import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
    buildInstallmentSchedule,
    buildPendingRegistrationRecord,
    calculateRegistrationFeeSnapshot,
    collectFieldValues,
    decideRegistrationPlacement,
    formatFeeAmount,
    getActiveRegistrationOptions,
    getRegistrationPaymentNotice,
    hasRegistrationPaymentSettings,
    hasOnlineRegistrationCheckout,
    getPaymentPlanChoices,
    formatFeeSnapshotLines,
    normalizeRegistrationForm,
    requiresRegistrationOption,
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



    it('stores checkout attempt tokens only when provided by the checkout flow', () => {
        const form = normalizeRegistrationForm({
            programName: 'Clinic',
            feeAmountCents: 5000,
            paymentSettings: { onlineCheckoutEnabled: true },
            published: true,
            waiverText: 'Waiver'
        }, { teamId: 'team-1', formId: 'form-1' });
        const now = { sentinel: 'serverTimestamp' };

        expect(buildPendingRegistrationRecord({
            form,
            participant: {},
            guardian: {},
            waiverAccepted: true,
            now,
            checkoutAttemptToken: 'attempt-token-123456'
        })).toMatchObject({ checkoutAttemptToken: 'attempt-token-123456' });
        expect(buildPendingRegistrationRecord({
            form,
            participant: {},
            guardian: {},
            waiverAccepted: true,
            now
        })).not.toHaveProperty('checkoutAttemptToken');
    });

    it('adds initial manual screening fields for background-check-enabled forms', () => {        const form = normalizeRegistrationForm({
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

    it('treats all-full non-waitlisted options as unavailable before submission', () => {
        const form = normalizeRegistrationForm({
            programName: 'Clinic',
            published: true,
            registrationOptions: [
                { id: 'u10', title: 'U10', capacityLimit: 1, waitlistEnabled: false, active: true }
            ],
            registrationOptionCounts: {
                u10: { enrolled: 1, waitlisted: 0 }
            }
        }, { teamId: 'team-1', formId: 'form-1' });

        expect(getActiveRegistrationOptions(form, form.registrationOptionCounts)).toEqual([]);
        expect(requiresRegistrationOption(form)).toBe(false);
        expect(validateRegistrationSubmission(form, { waiverAccepted: true, selectedOptionId: '' })).toEqual([]);
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

    it('wires registration page to public form reads and server-owned pending registration submission', () => {
        const page = fs.readFileSync('registration.html', 'utf8');
        expect(page).toContain("doc(db, 'teams', teamId, 'registrationForms', formId)");
        expect(page).not.toContain("collection(db, 'teams', teamId, 'registrationForms', formId, 'registrations')");
        expect(page).toContain('registration-options-section');
        expect(page).toContain('registration-options-unavailable');
        expect(page).toContain('Registration is currently unavailable. No registration options are available.');
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
        expect(page).toContain('let preparedCheckoutRegistration = null;');
        expect(page).toContain("const retryPublicCheckoutCapability = params.get('publicCheckoutCapability') || '';");
        expect(page).toContain("const retryPaymentRequested = params.get('retryPayment') === '1' && !!(retryPublicCheckoutCapability || retryRegistrationId);");
        expect(page).toContain('Use the button below to retry payment without submitting a new registration.');
        expect(page).toContain('if (retryPaymentRequested) {');
        expect(page).toContain("registrationId: currentPublicCheckoutCapability ? '' : retryRegistrationId,");
        expect(page).toContain('retryPayment: true');
        expect(page).toContain('const retryKey = buildCheckoutRetryKey(submission, amountCents, currency);');
        expect(page).toContain('preparedCheckoutRegistration?.retryKey === retryKey');
        expect(page).toContain('preparedCheckoutRegistration = { retryKey, result, checkoutAttemptToken };');
        expect(page).toContain('await releaseCancelledStripeRegistration(result.registrationId, checkoutAttemptToken);');
        expect(page).toContain('preparedCheckoutRegistration = null;');
        expect(page).toContain("httpsCallable(functions, 'submitPublicRegistration')");
        expect(page).toContain('return result?.data || {};');
        expect(page).toContain('getPublicRegistrationErrorMessage');
        expect(page).toContain("code === 'resource-exhausted'");
        expect(page).toContain("paymentLoadingState.classList.add('hidden');");
        expect(page).toContain('cancelStripeRegistrationCheckout({ teamId, formId, registrationId, checkoutAttemptToken, publicCheckoutCapability });');
        expect(page).toContain('releaseCancelledStripeRegistration(cancelledRegistrationId, cancelledCheckoutAttemptToken, cancelledPublicCheckoutCapability)');
        expect(page).toContain('function createCheckoutAttemptToken()');
        expect(page).toContain('? preparedCheckoutRegistration.checkoutAttemptToken');
        expect(page).toContain(': createCheckoutAttemptToken();');
        expect(page).toContain('checkoutAttemptToken,');
        expect(page).not.toContain('runTransaction(db, async (transaction)');
        expect(page).not.toContain('addDoc(');
        expect(page).toContain('decideRegistrationPlacement');
        expect(page).toContain('hasUnavailableRegistrationOptions');
        expect(page).toContain('option-full');
        expect(page).toContain('waiver-accepted');
        expect(page).toContain('confirmation-message');
        expect(page).toContain('labelText.textContent = field.label');
        expect(page).toContain("requiredMark.textContent = ' *'");
        expect(page.indexOf("const errorMessage = document.getElementById('error-message');")).toBeLessThan(page.indexOf('// Handle return from Stripe checkout'));

        const rules = fs.readFileSync('firestore.rules', 'utf8');
        expect(rules).toContain('match /registrationForms/{formId}');
        expect(rules).toContain('allow update: if isTeamOwnerOrAdmin(teamId);');
        expect(rules).toContain("allow create: if isTeamOwnerOrAdmin(teamId) && request.resource.data.status == 'pending';");
        expect(rules).toContain('function registrationFormPath(teamId, formId)');
        expect(rules).toContain("data.status in ['pending', 'waitlisted']");
        expect(rules).toContain("'paymentSettings'");
        expect(rules).toContain("'selectedOption'");
        expect(rules).toContain('isRegistrationPaymentSettingsPayloadValid');
        expect(rules).toContain("'paymentPlan'");
        expect(rules).toContain('isRegistrationPaymentPlanValid');
        expect(rules).toContain("'feeSnapshot'");
        expect(rules).toContain("'checkoutAttemptToken'");
        expect(rules).toContain("'screeningRequired'");
        expect(rules).toContain("'screeningStatus'");
        expect(rules).toContain("!data.keys().hasAny(['screeningRequired', 'screeningStatus', 'screeningProvider', 'screeningProviderReference'])");
        expect(rules).toContain("data.screeningStatus == get(registrationFormPath(teamId, formId)).data.get('backgroundCheck', {}).get('initialScreeningStatus', 'pending')");
        expect(rules).toContain('isRegistrationFeeSnapshotValid');
        expect(rules).not.toContain('isPublicRegistrationCapacityCounterUpdate');
        expect(rules).not.toContain('isPublicPendingRegistrationCreate');
        expect(rules).not.toContain('existsAfter(registrationPath)');
        expect(rules).toContain('data.waiverAccepted == true');
        expect(rules).toContain('hasOnlyFlatStringValues(data.participant)');
        expect(rules).toContain('hasOnlyFlatStringValues(data.guardian)');
        expect(rules).toContain('data.keys().size() <= 20');
    });

    it('releases and prepares a fresh pending registration when online checkout retry follows a Stripe failure', async () => {
        const page = fs.readFileSync('registration.html', 'utf8');
        const dom = new JSDOM(page, { url: 'https://example.test/registration.html?teamId=team-1&formId=form-1' });
        const document = dom.window.document;
        const formElement = document.getElementById('registration-form');
        const payRegistrationButton = document.getElementById('pay-registration');
        const errorMessage = document.getElementById('error-message');
        const paymentLoadingState = document.getElementById('payment-loading-state');

        formElement.innerHTML += `
            <input name="participant.playerName" data-group="participant" data-field-id="playerName" value="Sam" />
            <input name="guardian.email" data-group="guardian" data-field-id="email" value="parent@example.com" />
            <input name="paymentPlanId" type="radio" value="pay_full" checked />
        `;
        document.getElementById('waiver-accepted').checked = true;

        const activeForm = normalizeRegistrationForm({
            programName: 'Clinic',
            published: true,
            feeAmountCents: 5000,
            paymentSettings: { onlineCheckoutEnabled: true },
            participantFields: [{ id: 'playerName', label: 'Player name', required: true }],
            guardianFields: [{ id: 'email', label: 'Guardian email', required: true }],
            waiverText: 'Waiver'
        }, { teamId: 'team-1', formId: 'form-1' });
        const createdRegistrations = [];
        const initiateStripeCheckout = vi.fn()
            .mockRejectedValueOnce(new Error('Stripe unavailable'))
            .mockRejectedValueOnce(new Error('Stripe unavailable again'));
        const releaseCancelledStripeRegistration = vi.fn();
        let preparedCheckoutRegistration = null;

        const readGroupValues = (groupName, fields) => collectFieldValues(fields, Array.from(formElement.querySelectorAll(`[data-group="${groupName}"]`)).reduce((values, input) => {
            values[input.dataset.fieldId] = input.value;
            return values;
        }, {}));
        const buildRetryKey = (submission, amountCents, currency) => JSON.stringify({
            amountCents,
            currency,
            guardian: submission.guardian,
            participant: submission.participant,
            quantity: submission.feeSnapshot.quantity,
            selectedOptionId: submission.selectedOptionId,
            selectedPaymentPlanId: submission.selectedPaymentPlanId,
            teamId: 'team-1',
            formId: 'form-1',
            waiverAccepted: submission.waiverAccepted
        });
        const submitRegistrationWithoutCapacity = vi.fn(async (submission) => {
            createdRegistrations.push(buildPendingRegistrationRecord({
                form: activeForm,
                ...submission,
                now: { sentinel: 'serverTimestamp' }
            }));
            return { status: 'pending', registrationId: `registration-${createdRegistrations.length}` };
        });
        const clickPayRegistration = async () => {
            errorMessage.classList.add('hidden');
            payRegistrationButton.disabled = true;
            paymentLoadingState.classList.remove('hidden');
            const submission = {
                participant: readGroupValues('participant', activeForm.participantFields),
                guardian: readGroupValues('guardian', activeForm.guardianFields),
                waiverAccepted: document.getElementById('waiver-accepted').checked,
                selectedPaymentPlanId: formElement.querySelector('input[name="paymentPlanId"]:checked')?.value || 'pay_full',
                selectedOptionId: '',
                feeSnapshot: calculateRegistrationFeeSnapshot(activeForm, { quantity: 1, now: new Date('2026-05-23T00:00:00Z') })
            };
            const validationErrors = validateRegistrationSubmission(activeForm, submission);
            if (validationErrors.length > 0) {
                throw new Error(validationErrors.join(' '));
            }
            const amountCents = Math.max(0, Number(submission.feeSnapshot?.finalAmountDueCents || 0));
            const currency = String(submission.feeSnapshot?.currency || activeForm.currency || 'USD').toLowerCase();
            const retryKey = buildRetryKey(submission, amountCents, currency);
            const result = preparedCheckoutRegistration?.retryKey === retryKey
                ? preparedCheckoutRegistration.result
                : await submitRegistrationWithoutCapacity(submission);
            preparedCheckoutRegistration = { retryKey, result };
            try {
                const checkoutUrl = await initiateStripeCheckout({ registrationId: result.registrationId, amount: amountCents, currency });
                if (!checkoutUrl) {
                    await releaseCancelledStripeRegistration(result.registrationId);
                    preparedCheckoutRegistration = null;
                    errorMessage.textContent = 'Failed to get Stripe checkout URL.';
                    errorMessage.classList.remove('hidden');
                }
            } catch (error) {
                await releaseCancelledStripeRegistration(result.registrationId);
                preparedCheckoutRegistration = null;
                errorMessage.textContent = 'Failed to initiate payment. Please try again later.';
                errorMessage.classList.remove('hidden');
            } finally {
                payRegistrationButton.disabled = false;
                paymentLoadingState.classList.add('hidden');
            }
        };

        await clickPayRegistration();
        await clickPayRegistration();

        expect(errorMessage.textContent).toBe('Failed to initiate payment. Please try again later.');
        expect(submitRegistrationWithoutCapacity).toHaveBeenCalledTimes(2);
        expect(createdRegistrations).toHaveLength(2);
        expect(releaseCancelledStripeRegistration).toHaveBeenCalledTimes(2);
        expect(releaseCancelledStripeRegistration).toHaveBeenNthCalledWith(1, 'registration-1');
        expect(releaseCancelledStripeRegistration).toHaveBeenNthCalledWith(2, 'registration-2');
        expect(initiateStripeCheckout).toHaveBeenCalledTimes(2);
        expect(initiateStripeCheckout.mock.calls[1][0].registrationId).toBe('registration-2');
        expect(payRegistrationButton.disabled).toBe(false);
    });

    it('releases capacity and prepares a fresh reservation when checkout retry follows a Stripe failure', async () => {
        const page = fs.readFileSync('registration.html', 'utf8');
        const dom = new JSDOM(page, { url: 'https://example.test/registration.html?teamId=team-1&formId=form-1' });
        const document = dom.window.document;
        const formElement = document.getElementById('registration-form');
        const payRegistrationButton = document.getElementById('pay-registration');
        const errorMessage = document.getElementById('error-message');
        const paymentLoadingState = document.getElementById('payment-loading-state');

        formElement.innerHTML += `
            <input name="participant.playerName" data-group="participant" data-field-id="playerName" value="Sam" />
            <input name="guardian.email" data-group="guardian" data-field-id="email" value="parent@example.com" />
            <input name="paymentPlanId" type="radio" value="pay_full" checked />
            <input name="registrationOptionId" type="radio" value="u10" checked />
        `;
        document.getElementById('waiver-accepted').checked = true;

        const activeForm = normalizeRegistrationForm({
            programName: 'Clinic',
            published: true,
            feeAmountCents: 5000,
            paymentSettings: { onlineCheckoutEnabled: true },
            participantFields: [{ id: 'playerName', label: 'Player name', required: true }],
            guardianFields: [{ id: 'email', label: 'Guardian email', required: true }],
            registrationOptions: [{ id: 'u10', title: 'U10', capacityLimit: 2, waitlistEnabled: true }],
            waiverText: 'Waiver'
        }, { teamId: 'team-1', formId: 'form-1' });
        let registrationOptionCounts = { u10: { enrolled: 0, waitlisted: 0 } };
        let capacityRegistrationCount = 0;
        const initiateStripeCheckout = vi.fn()
            .mockRejectedValueOnce(new Error('Stripe unavailable'))
            .mockRejectedValueOnce(new Error('Stripe unavailable again'));
        const releaseCancelledStripeRegistration = vi.fn(async () => {
            registrationOptionCounts = {
                ...registrationOptionCounts,
                u10: {
                    ...registrationOptionCounts.u10,
                    enrolled: Math.max(0, Number(registrationOptionCounts.u10.enrolled || 0) - 1)
                }
            };
        });
        let preparedCheckoutRegistration = null;

        const readGroupValues = (groupName, fields) => collectFieldValues(fields, Array.from(formElement.querySelectorAll(`[data-group="${groupName}"]`)).reduce((values, input) => {
            values[input.dataset.fieldId] = input.value;
            return values;
        }, {}));
        const buildRetryKey = (submission, amountCents, currency) => JSON.stringify({
            amountCents,
            currency,
            guardian: submission.guardian,
            participant: submission.participant,
            quantity: submission.feeSnapshot.quantity,
            selectedOptionId: submission.selectedOptionId,
            selectedPaymentPlanId: submission.selectedPaymentPlanId,
            teamId: 'team-1',
            formId: 'form-1',
            waiverAccepted: submission.waiverAccepted
        });
        const submitRegistrationWithCapacity = vi.fn(async (submission) => {
            const placement = decideRegistrationPlacement({
                form: activeForm,
                selectedOptionId: submission.selectedOptionId,
                counts: registrationOptionCounts
            });
            registrationOptionCounts = {
                ...registrationOptionCounts,
                [placement.selectedOption.countKey]: placement.nextCounts
            };
            capacityRegistrationCount += 1;
            return { status: placement.status, registrationId: `registration-capacity-${capacityRegistrationCount}` };
        });
        const clickPayRegistration = async () => {
            errorMessage.classList.add('hidden');
            payRegistrationButton.disabled = true;
            paymentLoadingState.classList.remove('hidden');
            const submission = {
                participant: readGroupValues('participant', activeForm.participantFields),
                guardian: readGroupValues('guardian', activeForm.guardianFields),
                waiverAccepted: document.getElementById('waiver-accepted').checked,
                selectedPaymentPlanId: formElement.querySelector('input[name="paymentPlanId"]:checked')?.value || 'pay_full',
                selectedOptionId: formElement.querySelector('input[name="registrationOptionId"]:checked')?.value || '',
                feeSnapshot: calculateRegistrationFeeSnapshot(activeForm, { quantity: 1, now: new Date('2026-05-23T00:00:00Z') })
            };
            const amountCents = Math.max(0, Number(submission.feeSnapshot?.finalAmountDueCents || 0));
            const currency = String(submission.feeSnapshot?.currency || activeForm.currency || 'USD').toLowerCase();
            const retryKey = buildRetryKey(submission, amountCents, currency);
            const result = preparedCheckoutRegistration?.retryKey === retryKey
                ? preparedCheckoutRegistration.result
                : await submitRegistrationWithCapacity(submission);
            preparedCheckoutRegistration = { retryKey, result };
            try {
                const checkoutUrl = await initiateStripeCheckout({ registrationId: result.registrationId, amount: amountCents, currency });
                if (!checkoutUrl) {
                    await releaseCancelledStripeRegistration(result.registrationId);
                    preparedCheckoutRegistration = null;
                    errorMessage.textContent = 'Failed to get Stripe checkout URL.';
                    errorMessage.classList.remove('hidden');
                }
            } catch (error) {
                await releaseCancelledStripeRegistration(result.registrationId);
                preparedCheckoutRegistration = null;
                errorMessage.textContent = 'Failed to initiate payment. Please try again later.';
                errorMessage.classList.remove('hidden');
            } finally {
                payRegistrationButton.disabled = false;
                paymentLoadingState.classList.add('hidden');
            }
        };

        await clickPayRegistration();
        await clickPayRegistration();

        expect(errorMessage.textContent).toBe('Failed to initiate payment. Please try again later.');
        expect(submitRegistrationWithCapacity).toHaveBeenCalledTimes(2);
        expect(registrationOptionCounts.u10).toEqual({ enrolled: 0, waitlisted: 0 });
        expect(releaseCancelledStripeRegistration).toHaveBeenCalledTimes(2);
        expect(initiateStripeCheckout).toHaveBeenCalledTimes(2);
        expect(initiateStripeCheckout.mock.calls[1][0].registrationId).toBe('registration-capacity-2');
    });

    it('releases a prepared capacity reservation when checkout returns no URL', async () => {
        const activeForm = normalizeRegistrationForm({
            programName: 'Clinic',
            published: true,
            feeAmountCents: 5000,
            paymentSettings: { onlineCheckoutEnabled: true },
            participantFields: [{ id: 'playerName', label: 'Player name', required: true }],
            guardianFields: [{ id: 'email', label: 'Guardian email', required: true }],
            registrationOptions: [{ id: 'u10', title: 'U10', capacityLimit: 1, waitlistEnabled: false }],
            waiverText: 'Waiver'
        }, { teamId: 'team-1', formId: 'form-1' });
        let registrationOptionCounts = { u10: { enrolled: 0, waitlisted: 0 } };
        let preparedCheckoutRegistration = null;
        const releaseCancelledStripeRegistration = vi.fn(async () => {
            registrationOptionCounts = {
                ...registrationOptionCounts,
                u10: { ...registrationOptionCounts.u10, enrolled: Math.max(0, registrationOptionCounts.u10.enrolled - 1) }
            };
        });
        const initiateStripeCheckout = vi.fn().mockResolvedValueOnce('');
        const submission = {
            participant: { playerName: 'Sam' },
            guardian: { email: 'parent@example.com' },
            waiverAccepted: true,
            selectedPaymentPlanId: 'pay_full',
            selectedOptionId: 'u10',
            feeSnapshot: calculateRegistrationFeeSnapshot(activeForm, { quantity: 1, now: new Date('2026-05-23T00:00:00Z') })
        };
        const placement = decideRegistrationPlacement({
            form: activeForm,
            selectedOptionId: submission.selectedOptionId,
            counts: registrationOptionCounts
        });
        registrationOptionCounts = {
            ...registrationOptionCounts,
            [placement.selectedOption.countKey]: placement.nextCounts
        };
        const result = { status: placement.status, registrationId: 'registration-capacity-1' };
        preparedCheckoutRegistration = { retryKey: 'retry-key', result };

        const checkoutUrl = await initiateStripeCheckout({ registrationId: result.registrationId, amount: 5000, currency: 'usd' });
        if (!checkoutUrl) {
            await releaseCancelledStripeRegistration(result.registrationId);
            preparedCheckoutRegistration = null;
        }

        expect(initiateStripeCheckout).toHaveBeenCalledWith({ registrationId: 'registration-capacity-1', amount: 5000, currency: 'usd' });
        expect(releaseCancelledStripeRegistration).toHaveBeenCalledWith('registration-capacity-1');
        expect(registrationOptionCounts.u10).toEqual({ enrolled: 0, waitlisted: 0 });
        expect(preparedCheckoutRegistration).toBeNull();
    });

    it('uses secure retry tokens and keeps app retry flow wired to the stored checkout attempt', () => {
        const appSource = fs.readFileSync('apps/app/src/pages/RegistrationDetail.tsx', 'utf8');

        expect(appSource).toContain('function createCheckoutAttemptToken()');
        expect(appSource).toContain("throw new Error('Crypto API not available. Cannot generate secure checkout token.');");
        expect(appSource).not.toContain('Math.random().toString(36).slice(2, 18)');
        expect(appSource).toContain("const checkoutAttemptToken = isRetryPaymentMode ? returnCheckoutAttemptToken : createCheckoutAttemptToken();");
        expect(appSource).toContain('retryPayment: true');
        expect(appSource).toContain('publicCheckoutCapability: currentPublicCheckoutCapability ||');
        expect(appSource).toContain("Stripe payment was cancelled. You can retry payment for this registration.");
    });

    it('omits raw registration identifiers from public Stripe return URLs', () => {
        const functionsSource = fs.readFileSync('functions/index.js', 'utf8');
        const urlBuilderStart = functionsSource.indexOf('function buildRegistrationCheckoutUrls');
        const urlBuilderEnd = functionsSource.indexOf('function normalizePublicRegistrationInput');
        const urlBuilder = functionsSource.slice(urlBuilderStart, urlBuilderEnd);
        const page = fs.readFileSync('registration.html', 'utf8');

        expect(urlBuilderStart).toBeGreaterThanOrEqual(0);
        expect(urlBuilder).toContain("params.set('publicCheckoutCapability', input.publicCheckoutCapability);");
        expect(urlBuilder).not.toContain('registrationId');
        expect(urlBuilder).not.toContain('checkoutAttemptToken');
        expect(page).not.toContain('const successUrl =');
        expect(page).not.toContain('const cancelUrl =');
    });

    it('wires registration Stripe checkout to deployed functions', () => {
        const functionsSource = fs.readFileSync('functions/index.js', 'utf8');

        expect(functionsSource).toContain('exports.createStripeRegistrationCheckout');
        expect(functionsSource).toContain('exports.cancelStripeRegistrationCheckout');
        expect(functionsSource).toContain('releaseRegistrationCheckoutCapacity');
        expect(functionsSource).toContain("registrationCapacityReleased: true");
        expect(functionsSource).toContain("product: 'registration'");
        // Server-side recomputation: form is passed to prevent tampered feeSnapshot amounts (issue #2243)
        expect(functionsSource).toContain('getRegistrationCheckoutAmountCents(registration, form)');
        expect(functionsSource).toContain("if (input.retryPayment) {");
        expect(functionsSource).toContain("params.set('retryPayment', '1');");
        expect(functionsSource).toContain('reserveRegistrationCheckoutCapacityForRetry');
        expect(functionsSource).toContain('const amountCents = expectedAmountCents');
        expect(functionsSource).toContain('form.currency || registration.feeSnapshot?.currency || registration.currency');
        expect(functionsSource).toContain("Current public checkout capability is required to retry this payment.");
        expect(functionsSource).toContain("This registration option is no longer available. Please restart registration or contact the organizer.");
        expect(functionsSource).toContain("Registration is currently unavailable. No registration options are available.");
        expect(functionsSource).toContain("reason: 'no-options-available'");
        expect(functionsSource).toContain("registrationCapacityReleased: false");
        expect(functionsSource).toContain("capacityReleasedAt: admin.firestore.FieldValue.delete()");
        expect(functionsSource).toContain("const currency = String(");
        expect(functionsSource).toContain("form.paymentSettings?.onlineCheckoutEnabled !== true");
        expect(functionsSource).toContain("checkoutStatus: 'open'");
        expect(functionsSource).toContain("paymentStatus: 'checkout_open'");
        expect(functionsSource).toContain('canReleasePreCheckoutReservation');
        expect(functionsSource).toContain('normalizeCheckoutAttemptToken');
        expect(functionsSource).toContain('registrationCheckoutAuthorityMatches(registration, input)');
        expect(functionsSource).toContain('registrationCheckoutAuthorityStrictlyMatches(registration, input)');
        expect(functionsSource).toContain('registrationPublicCheckoutCapabilityMatches(registration, input)');
        expect(functionsSource).toContain('return Boolean(registrationToken && inputToken && registrationToken === inputToken);');
        expect(functionsSource).toContain('Public checkout capability does not match.');
        expect(functionsSource).toContain('Current public checkout capability is required to release this reservation.');
        expect(functionsSource).toContain('checkoutAttemptToken: input.checkoutAttemptToken ||');
        expect(functionsSource).toContain("ignoredReason: 'checkout_attempt_mismatch'");
        expect(functionsSource).toContain("['pending', 'waitlisted'].includes(registration.status)");
        expect(functionsSource).toContain('Registration checkout is not releasable.');
        expect(functionsSource).toContain('shouldProcessRegistrationCheckoutEvent(event)');
    });

    it('requires the same checkout attempt token before releasing pre-checkout capacity', () => {
        const functionsSource = fs.readFileSync('functions/index.js', 'utf8');
        const releaseStart = functionsSource.indexOf('async function releaseRegistrationCheckoutCapacity');
        const releaseEnd = functionsSource.indexOf('async function getUserForEligibility');
        const releaseBody = functionsSource.slice(releaseStart, releaseEnd);
        const preCheckoutGuardIndex = releaseBody.indexOf('if (canReleasePreCheckoutReservation && !registrationCheckoutAuthorityStrictlyMatches(registration, input))');
        const relaxedOpenCheckoutGuardIndex = releaseBody.indexOf('if (!canReleasePreCheckoutReservation && !registrationCheckoutAuthorityMatches(registration, input))');
        const selectedOptionIndex = releaseBody.indexOf('const selectedOption = registration.selectedOption || {};');

        expect(releaseStart).toBeGreaterThanOrEqual(0);
        expect(releaseEnd).toBeGreaterThan(releaseStart);
        expect(functionsSource).toContain('function registrationCheckoutAuthorityStrictlyMatches(registration = {}, input = {})');
        expect(functionsSource).toContain('registrationPublicCheckoutCapabilityMatches(registration, input)');
        expect(preCheckoutGuardIndex).toBeGreaterThanOrEqual(0);
        expect(relaxedOpenCheckoutGuardIndex).toBeGreaterThan(preCheckoutGuardIndex);
        expect(selectedOptionIndex).toBeGreaterThan(relaxedOpenCheckoutGuardIndex);
    });

    it('derives checkout attempt requirements from the stored form in rules', () => {
        const rules = fs.readFileSync('firestore.rules', 'utf8');

        expect(rules).toContain("data.paymentSettings.onlineCheckoutEnabled == get(registrationFormPath(teamId, formId)).data.get('paymentSettings', {}).get('onlineCheckoutEnabled', false)");
        expect(rules).toContain("get(registrationFormPath(teamId, formId)).data.get('paymentSettings', {}).get('onlineCheckoutEnabled', false) == true");
        expect(rules).toContain("get(registrationFormPath(teamId, formId)).data.get('paymentSettings', {}).get('onlineCheckoutEnabled', false) != true");
        expect(rules).toContain("data.checkoutAttemptToken is string");
    });

    it('does not write cancellation state before returning for paid registrations', () => {
        const functionsSource = fs.readFileSync('functions/index.js', 'utf8');
        const releaseStart = functionsSource.indexOf('async function releaseRegistrationCheckoutCapacity');
        const releaseEnd = functionsSource.indexOf('async function getUserForEligibility');
        const releaseBody = functionsSource.slice(releaseStart, releaseEnd);
        const paidGuardIndex = releaseBody.indexOf("if (registration.paymentStatus === 'paid')");
        const registrationUpdateIndex = releaseBody.indexOf('const registrationUpdate =');
        const paidReturnIndex = releaseBody.indexOf("return { released: false, reason: 'already-paid' };");
        const firstRegistrationWriteAfterPaidGuard = releaseBody.indexOf('transaction.set(registrationRef', paidGuardIndex);

        expect(releaseStart).toBeGreaterThanOrEqual(0);
        expect(releaseEnd).toBeGreaterThan(releaseStart);
        expect(paidGuardIndex).toBeGreaterThanOrEqual(0);
        expect(paidReturnIndex).toBeGreaterThan(paidGuardIndex);
        expect(registrationUpdateIndex).toBeGreaterThan(paidReturnIndex);
        expect(firstRegistrationWriteAfterPaidGuard).toBeGreaterThan(registrationUpdateIndex);
    });
});
