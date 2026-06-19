import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    REGISTRATION_PAYMENT_REMINDER_CADENCE_DAYS,
    buildQueuedReminderAuditEntry,
    buildRegistrationFailedPaymentReminderState,
    buildRegistrationPaymentReminderMailDocId,
    buildRegistrationPaymentReminderMessage,
    buildRegistrationPaymentRetryUrl,
    shouldStopRegistrationPaymentReminders
} = require('../../functions/registration-payment-reminders-core.cjs');

describe('registration payment reminder helpers', () => {
    it('builds a retry URL back to the registration payment flow', () => {
        expect(buildRegistrationPaymentRetryUrl('https://allplays.ai/', {
            teamId: 'team_123',
            formId: 'form_456',
            publicCheckoutCapability: 'publiccapabilitytoken1234567890'
        })).toBe('https://allplays.ai/registration.html?teamId=team_123&formId=form_456&retryPayment=1&publicCheckoutCapability=publiccapabilitytoken1234567890');
    });

    it('does not build a retry URL when the public checkout capability is missing', () => {
        expect(buildRegistrationPaymentRetryUrl('https://allplays.ai/', {
            teamId: 'team_123',
            formId: 'form_456',
            registrationId: 'reg_789'
        })).toBe('');
    });

    it('builds failed payment reminder content with the program, amount due, and retry link', () => {
        const message = buildRegistrationPaymentReminderMessage({
            programName: 'Summer Skills Camp',
            amountDueCents: 12500,
            currency: 'USD',
            retryUrl: 'https://allplays.ai/registration.html?teamId=team_123&formId=form_456&retryPayment=1&publicCheckoutCapability=publiccapabilitytoken1234567890'
        });

        expect(message.subject).toBe('Payment reminder: Summer Skills Camp');
        expect(message.text).toContain('Program: Summer Skills Camp');
        expect(message.text).toContain('Amount due: $125.00');
        expect(message.text).toContain('Retry payment: https://allplays.ai/registration.html?teamId=team_123&formId=form_456&retryPayment=1&publicCheckoutCapability=publiccapabilitytoken1234567890');
        expect(message.html).toContain('href="https://allplays.ai/registration.html?teamId=team_123&amp;formId=form_456&amp;retryPayment=1&amp;publicCheckoutCapability=publiccapabilitytoken1234567890"');
        expect(message.html).toContain('Summer Skills Camp');
    });

    it('omits retry links that do not use http or https', () => {
        const message = buildRegistrationPaymentReminderMessage({
            programName: 'Summer Skills Camp',
            amountDueCents: 12500,
            currency: 'USD',
            retryUrl: 'javascript:alert(1)'
        });

        expect(message.text).not.toContain('Retry payment:');
        expect(message.html).not.toContain('href=');
        expect(message.html).not.toContain('Retry payment');
    });

    it('creates auditable failed payment reminder state from the webhook event id', () => {
        const state = buildRegistrationFailedPaymentReminderState({
            registration: {
                feeSnapshot: { finalAmountDueCents: 9800 },
                guardian: { email: 'Parent@Example.com' },
                programName: 'Fall Soccer'
            },
            input: {
                teamId: 'team_123',
                formId: 'form_456',
                registrationId: 'reg_789',
                publicCheckoutCapability: 'publiccapabilitytoken1234567890'
            },
            eventId: 'evt_123',
            appUrl: 'https://allplays.ai',
            queuedAtIso: '2026-06-01T15:23:00.000Z',
            mailDocId: 'registrationPayment_team_123_form_456_reg_789_evt_123_initial'
        });

        expect(state).toMatchObject({
            status: 'active',
            cadenceDays: REGISTRATION_PAYMENT_REMINDER_CADENCE_DAYS,
            reminderCount: 1,
            recipientEmail: 'parent@example.com',
            amountDueCents: 9800,
            lastEventId: 'evt_123',
            lastMailId: 'registrationPayment_team_123_form_456_reg_789_evt_123_initial',
            lastReminderKind: 'initial'
        });
        expect(state.retryUrl).toContain('retryPayment=1');
        expect(state.nextReminderAt).toBe('2026-06-04T15:23:00.000Z');
        expect(state.lastAudit).toEqual(buildQueuedReminderAuditEntry({
            kind: 'initial',
            eventId: 'evt_123',
            mailDocId: 'registrationPayment_team_123_form_456_reg_789_evt_123_initial',
            queuedAtIso: '2026-06-01T15:23:00.000Z'
        }));
    });

    it('builds deterministic mail ids and stops reminders once registrations are closed or paid', () => {
        expect(buildRegistrationPaymentReminderMailDocId({
            teamId: 'team_123',
            formId: 'form_456',
            registrationId: 'reg_789',
            eventId: 'evt_123',
            sequence: 'followup_2'
        })).toBe('registrationPayment_team_123_form_456_reg_789_evt_123_followup_2');

        expect(shouldStopRegistrationPaymentReminders({ paymentStatus: 'paid' })).toBe(true);
        expect(shouldStopRegistrationPaymentReminders({ paymentStatus: 'checkout_expired' })).toBe(true);
        expect(shouldStopRegistrationPaymentReminders({ status: 'cancelled' })).toBe(true);
        expect(shouldStopRegistrationPaymentReminders({ paymentStatus: 'payment_failed', status: 'pending' })).toBe(false);
    });
});
