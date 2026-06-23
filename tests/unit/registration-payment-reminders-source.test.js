import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('registration failed payment reminder wiring', () => {
    it('queues the initial failed-payment email exactly once per Stripe event id', () => {
        expect(source).toContain('const eventRef = firestore.doc(`stripeEvents/${event.id}`);');
        expect(source).toContain("if (event.type === 'checkout.session.async_payment_failed') {");
        expect(source).toContain("sequence: 'initial'");
        expect(source).toContain('buildRegistrationPaymentReminderMailDocId({');
        expect(source).toContain('stripeEventId: event.id');
        expect(source).toContain('transaction.set(buildRegistrationReminderMailRef(mailDocId), buildRegistrationReminderMailJob({');
    });

    it('records auditable reminder metadata on the registration and resolves it when paid', () => {
        expect(source).toContain('paymentReminder: {');
        expect(source).toContain('buildRegistrationFailedPaymentReminderState({');
        expect(source).toContain("transaction.update(registrationRef, buildRegistrationReminderStopUpdate({ reason: 'paid', nowIso: queuedAtIso }));");
        expect(source).toContain("'paymentReminder.nextReminderAt': admin.firestore.FieldValue.delete()");
    });

    it('schedules follow-up reminders and stops them once the registration is no longer collectible', () => {
        expect(source).toContain('exports.queueDueRegistrationFailedPaymentReminders = functions.pubsub');
        expect(source).toContain(".schedule('every 6 hours')");
        expect(source).toContain(".collectionGroup('registrations')");
        expect(source).toContain(".where('paymentReminder.nextReminderAt', '<=', dueIso)");
        expect(source).toContain(".orderBy('paymentReminder.nextReminderAt')");
        expect(source).toContain('query = query.startAfter(cursor);');
        expect(source).toContain('drainDueReminderPages({');
        expect(source).toContain('REGISTRATION_PAYMENT_REMINDER_MAX_PAGES_PER_RUN');
        expect(source).toContain('REGISTRATION_PAYMENT_REMINDER_MAX_RUNTIME_MS');
        expect(source).toContain('queuedCount');
        expect(source).not.toContain(".where('paymentReminder.nextReminderAt', '<=', nowIso)\n    .limit(50)\n    .get();");
        expect(source).toContain('shouldStopRegistrationPaymentReminders(registration)');
        expect(source).toContain("sequence: `followup_${reminderNumber}`");
    });
});
