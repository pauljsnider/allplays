// tests/unit/team-fees-admin.test.js
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it, expect } from 'vitest'; // Import Vitest globals
import { buildManualPaymentUpdate, buildBalanceAdjustmentUpdate, buildOnlineRefundRequest, getRecipientRefundableCents, getRecipientStripePaymentRefs, isOnlineRefundEligible, buildOfflineRefundUpdate, buildTeamFeePaymentSummaryRows, serializeTeamFeePaymentSummaryCsv, buildTeamFeePaymentSummaryCsv, escapeCsvValue, registerTeamFeesAdminPageHandlers, normalizeTeamFeeDraft } from '../../js/team-fees-admin.js'; // Adjusted path

describe('team fees admin page routing', () => {
    it('reinitializes when same-page manage links update the hash', () => {
        const registrations = [];
        const fakeWindow = {
            addEventListener: (eventName, handler) => registrations.push({ eventName, handler })
        };

        registerTeamFeesAdminPageHandlers(fakeWindow);

        expect(registrations.map(({ eventName }) => eventName)).toEqual(['DOMContentLoaded', 'hashchange']);
        expect(registrations[1].handler).toBe(registrations[0].handler);
    });

    it('pins the team fees page shell and admin module to the latest cache-busted versions', () => {
        const adminSource = readFileSync(new URL('../../js/team-fees-admin.js', import.meta.url), 'utf8');
        const pageSource = readFileSync(new URL('../../team-fees.html', import.meta.url), 'utf8');

        expect(adminSource).toContain("import('./db.js?v=57')");
        expect(pageSource).toContain('<script type="module" src="./js/team-fees-admin.js?v=9"></script>');
    });
});

describe('create offline team fee form', () => {
    it('keeps advanced invoice controls collapsed by default and available after expansion', () => {
        const source = readFileSync(new URL('../../js/team-fees-admin.js', import.meta.url), 'utf8');
        const advancedSection = source.match(/<details id="advanced-invoice-details"[\s\S]*?<\/details>/)?.[0];

        expect(advancedSection).toBeTruthy();

        const { document } = new JSDOM(advancedSection).window;
        const details = document.querySelector('#advanced-invoice-details');
        const summary = details.querySelector('summary');

        expect(details.hasAttribute('open')).toBe(false);
        expect(details.open).toBe(false);
        expect(summary.textContent).toContain('Advanced invoice details');
        expect(details.querySelector('#add-line-item').textContent).toContain('Add item');
        expect(details.querySelector('#add-installment').textContent).toContain('Add installment');
    });
});

describe('normalizeTeamFeeDraft', () => {
    const simpleDraft = {
        title: 'Tournament dues',
        amount: '25.00',
        dueDate: '2026-06-01',
        recipientIds: ['player-1']
    };

    it('allows a simple offline fee without line items or installments', () => {
        const draft = normalizeTeamFeeDraft({
            ...simpleDraft,
            lineItems: [],
            installments: []
        });

        expect(draft).toMatchObject({
            title: 'Tournament dues',
            amountCents: 2500,
            dueDate: '2026-06-01',
            recipientIds: ['player-1'],
            lineItems: [],
            installments: []
        });
    });

    it('requires populated line items and installments to match the fee amount', () => {
        expect(normalizeTeamFeeDraft({
            ...simpleDraft,
            lineItems: [{ description: 'Gym rental', amount: '15.00' }, { description: 'Refs', amount: '10.00' }],
            installments: [{ dueDate: '2026-06-01', amount: '10.00' }, { dueDate: '2026-07-01', amount: '15.00' }]
        })).toMatchObject({
            lineItems: [
                { description: 'Gym rental', amountCents: 1500 },
                { description: 'Refs', amountCents: 1000 }
            ],
            installments: [
                { dueDate: '2026-06-01', amountCents: 1000 },
                { dueDate: '2026-07-01', amountCents: 1500 }
            ]
        });

        expect(() => normalizeTeamFeeDraft({
            ...simpleDraft,
            lineItems: [{ description: 'Gym rental', amount: '10.00' }]
        })).toThrow('Line items must add up to the total fee amount.');
        expect(() => normalizeTeamFeeDraft({
            ...simpleDraft,
            installments: [{ dueDate: '2026-06-01', amount: '10.00' }]
        })).toThrow('Installments must add up to the total fee amount.');
    });
});

describe('balance adjustment form copy', () => {
    it('explains that positive adjustments are credits and negative adjustments are charges', () => {
        const source = readFileSync(new URL('../../js/team-fees-admin.js', import.meta.url), 'utf8');

        expect(source).toContain('placeholder="20.00 credit or -5.00 charge"');
        expect(source).toContain('Positive amounts credit the account and reduce what is owed. Negative amounts add a charge.');
    });
});

describe('buildManualPaymentUpdate', () => {
    it('should correctly handle missing or invalid currentBalanceCents by defaulting to a high number to prevent premature "paid" status', () => {
        const paymentAmount = '5.00'; // $5.00 payment
        const paymentAmountCents = 500;
        const date = '2026-01-01';
        const actorId = 'test-user';

        // Case 1: currentBalanceCents is undefined
        let updates = buildManualPaymentUpdate({
            amount: paymentAmount,
            date,
            actorId,
            currentBalanceCents: undefined, // Simulates missing data-balance-cents
            currentPaidCents: '0'
        });

        expect(updates.amountPaidCents).toBe(paymentAmountCents);
        // remainingBalanceCents should be MAX_SAFE_INTEGER - paymentAmountCents
        expect(updates.remainingBalanceCents).toBe(Number.MAX_SAFE_INTEGER - paymentAmountCents);
        expect(updates.status).toBe('partial'); // Should not be 'paid' if the actual balance is unknown but a payment was made

        // Case 2: currentBalanceCents is NaN
        updates = buildManualPaymentUpdate({
            amount: paymentAmount,
            date,
            actorId,
            currentBalanceCents: 'invalid-string', // Will convert to NaN
            currentPaidCents: '0'
        });

        expect(updates.amountPaidCents).toBe(paymentAmountCents);
        expect(updates.remainingBalanceCents).toBe(Number.MAX_SAFE_INTEGER - paymentAmountCents);
        expect(updates.status).toBe('partial');

        // Case 3: currentBalanceCents is 0, so additional payments are rejected
        expect(() => buildManualPaymentUpdate({
            amount: paymentAmount,
            date,
            actorId,
            currentBalanceCents: '0',
            currentPaidCents: '0'
        })).toThrow('cannot exceed the remaining balance');

        // Case 4: Valid currentBalanceCents (partial payment scenario)
        const initialBalanceCents = 1000; // $10.00 outstanding
        updates = buildManualPaymentUpdate({
            amount: paymentAmount, // $5.00 payment
            date,
            actorId,
            currentBalanceCents: initialBalanceCents.toString(),
            currentPaidCents: '0'
        });
        expect(updates.amountPaidCents).toBe(paymentAmountCents); // 500
        expect(updates.remainingBalanceCents).toBe(initialBalanceCents - paymentAmountCents); // 1000 - 500 = 500
        expect(updates.status).toBe('partial');
    });

    it('rejects manual payments that exceed the remaining balance', () => {
        expect(() => buildManualPaymentUpdate({
            amount: '25.01',
            date: '2026-06-09',
            currentBalanceCents: '2500',
            currentPaidCents: '0'
        })).toThrow('cannot exceed the remaining balance');

        expect(() => buildManualPaymentUpdate({
            amount: '10.01',
            date: '2026-06-09',
            currentBalanceCents: '2500',
            currentPaidCents: '1500'
        })).toThrow('cannot exceed the remaining balance');
    });
});

describe('buildBalanceAdjustmentUpdate', () => {
    it('treats positive adjustments as credits that reduce the amount owed', () => {
        const updates = buildBalanceAdjustmentUpdate({
            amount: '20.00',
            note: 'Scholarship credit',
            actorId: 'admin-1',
            currentBalanceCents: '15000',
            currentPaidCents: '0'
        });

        expect(updates.status).toBe('unpaid');
        expect(updates.amountDueCents).toBe(13000);
        expect(updates.remainingBalanceCents).toBe(13000);
        expect(updates.adjustment).toMatchObject({
            amountCents: 2000,
            previousAmountDueCents: 15000,
            amountDueCents: 13000
        });
        expect(updates.ledgerEntries).toEqual([
            expect.objectContaining({
                type: 'balance_adjustment',
                amountCents: 2000,
                previousAmountDueCents: 15000,
                amountDueCents: 13000
            })
        ]);
        expect(updates.adminBilling).toEqual(expect.objectContaining({
            type: 'balance_adjustment',
            reason: 'Scholarship credit',
            adjustedBy: 'admin-1'
        }));
    });

    it('treats negative adjustments as charges that increase the amount owed', () => {
        const updates = buildBalanceAdjustmentUpdate({
            amount: '-5.00',
            note: 'Late registration surcharge',
            actorId: 'admin-1',
            currentBalanceCents: '15000',
            currentPaidCents: '0'
        });

        expect(updates.amountDueCents).toBe(15500);
        expect(updates.remainingBalanceCents).toBe(15500);
        expect(updates.adjustment.amountCents).toBe(-500);
    });
});

describe('online team fee refunds', () => {
    it('builds callable refund requests in cents', () => {
        const request = buildOnlineRefundRequest({
            teamId: ' team_1 ',
            batchId: ' batch_1 ',
            recipientId: ' recipient_1 ',
            amount: '12.34',
            reason: ' duplicate payment '
        });
        expect(request).toMatchObject({
            teamId: 'team_1',
            batchId: 'batch_1',
            recipientId: 'recipient_1',
            amountCents: 1234,
            reason: 'duplicate payment'
        });
        expect(request.refundRequestId).toEqual(expect.any(String));
    });

    it('detects eligible Stripe payments and remaining refundable amount', () => {
        const recipient = {
            paymentProvider: 'stripe',
            amountPaidCents: 10000,
            refundedAmountCents: 2500,
            hasAdminBilling: true
        };

        expect(getRecipientRefundableCents(recipient)).toBe(10000);
        expect(getRecipientStripePaymentRefs(recipient)).toEqual({ paymentIntentId: '', chargeId: '' });
        expect(isOnlineRefundEligible(recipient)).toBe(true);
        expect(isOnlineRefundEligible({ ...recipient, hasAdminBilling: false, stripePaymentIntentId: 'pi_root' })).toBe(true);
        expect(isOnlineRefundEligible({ ...recipient, hasAdminBilling: false, stripePaymentIntentId: '', stripeChargeId: '', adminBilling: { stripePaymentIntentId: 'pi_private' } })).toBe(true);
        expect(isOnlineRefundEligible({ ...recipient, hasAdminBilling: false, stripePaymentIntentId: '', stripeChargeId: '', adminBilling: {} })).toBe(false);
        expect(isOnlineRefundEligible({ ...recipient, paymentProvider: 'manual' })).toBe(false);
    });
});

describe('buildOfflineRefundUpdate', () => {
    it('records a partial offline refund and reopens the remaining balance', () => {
        const updates = buildOfflineRefundUpdate({
            refundType: 'partial',
            amount: '4.00',
            method: 'cash',
            note: 'Refunded duplicate cash collection.',
            actorId: 'admin-1',
            currentBalanceCents: '1000',
            currentPaidCents: '1000'
        });

        expect(updates.status).toBe('partial');
        expect(updates.amountPaidCents).toBe(600);
        expect(updates.remainingBalanceCents).toBe(400);
        expect(updates.paidAt).toBeNull();
        expect(updates.refunded).toMatchObject({
            amountCents: 400,
            refundType: 'partial',
            refundMethod: 'cash'
        });
        expect(updates.ledgerEntries).toEqual([
            expect.objectContaining({
                type: 'offline_refund',
                amountCents: -400,
                refundAmountCents: 400,
                refundMethod: 'cash'
            })
        ]);
        expect(updates.adminBilling).toEqual(expect.objectContaining({
            type: 'offline_refund',
            note: 'Refunded duplicate cash collection.',
            recordedBy: 'admin-1'
        }));
    });

    it('records a full offline check refund and resets paid status to unpaid', () => {
        const updates = buildOfflineRefundUpdate({
            refundType: 'full',
            method: 'check',
            note: 'Check refund issued.',
            actorId: 'admin-2',
            currentBalanceCents: '2500',
            currentPaidCents: '2500'
        });

        expect(updates.status).toBe('unpaid');
        expect(updates.amountPaidCents).toBe(0);
        expect(updates.remainingBalanceCents).toBe(2500);
        expect(updates.paidAt).toBeNull();
        expect(updates.ledgerEntries[0]).toMatchObject({
            type: 'offline_refund',
            amountCents: -2500,
            refundAmountCents: 2500,
            refundType: 'full',
            refundMethod: 'check'
        });
    });

    it('requires a note, offline method, and refund amount no larger than paid', () => {
        expect(() => buildOfflineRefundUpdate({ refundType: 'partial', amount: '6.00', method: 'cash', note: 'Too much', currentBalanceCents: '1000', currentPaidCents: '500' })).toThrow('Refund amount cannot exceed');
        expect(() => buildOfflineRefundUpdate({ refundType: 'partial', amount: '1.00', method: 'card', note: 'Bad method', currentBalanceCents: '1000', currentPaidCents: '500' })).toThrow('Select cash or check');
        expect(() => buildOfflineRefundUpdate({ refundType: 'partial', amount: '1.00', method: 'cash', note: '', currentBalanceCents: '1000', currentPaidCents: '500' })).toThrow('Enter an admin note');
    });
});


describe('team fee payment summary export', () => {
    it('escapes CSV values with commas, quotes, and newlines', () => {
        expect(escapeCsvValue('Smith, Jane')).toBe('"Smith, Jane"');
        expect(escapeCsvValue('Coach said "paid"')).toBe('"Coach said ""paid"""');
        expect(escapeCsvValue('line one\nline two')).toBe('"line one\nline two"');
    });

    it('neutralizes spreadsheet formula injection patterns', () => {
        expect(escapeCsvValue('=IMPORTXML("https://example.com")')).toBe('"\'=IMPORTXML(""https://example.com"")"');
        expect(escapeCsvValue('+cmd')).toBe("'+cmd");
        expect(escapeCsvValue('-10')).toBe("'-10");
        expect(escapeCsvValue('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
        expect(escapeCsvValue('notes|=HYPERLINK("https://example.com")')).toBe('"\'notes|=HYPERLINK(""https://example.com"")"');
        expect(escapeCsvValue('plain text')).toBe('plain text');
    });

    it('builds rows for paid, partial, unpaid, canceled, and refunded states', () => {
        const rows = buildTeamFeePaymentSummaryRows([
            {
                playerName: 'Paid Player',
                playerId: 'p1',
                status: 'paid',
                amountCents: 10000,
                amountPaidCents: 10000,
                dueDate: '2026-06-01',
                collectionMode: 'offline_manual',
                paidAt: '2026-05-01T10:00:00Z',
                notes: 'cash collection'
            },
            {
                playerName: 'Partial Player',
                playerId: 'p2',
                status: 'partial',
                amountCents: 10000,
                amountDueCents: 10000,
                amountPaidCents: 2500,
                paymentLedger: [{ type: 'offline_payment', amountCents: 2500, paymentDate: '2026-05-02' }]
            },
            {
                playerName: 'Unpaid Player',
                playerId: 'p3',
                status: 'unpaid',
                amountCents: 10000,
                amountPaidCents: 0
            },
            {
                playerName: 'Canceled Player',
                playerId: 'p4',
                status: 'canceled',
                amountCents: 10000,
                amountPaidCents: 0,
                canceled: { note: 'waived' }
            },
            {
                playerName: 'Refunded Player',
                playerId: 'p5',
                status: 'partial',
                amountCents: 10000,
                amountDueCents: 10000,
                amountPaidCents: 6000,
                refundedAmountCents: 4000,
                ledgerEntries: [{ type: 'offline_refund', refundAmountCents: 4000, refundDate: '2026-05-03', note: 'duplicate' }],
                refunded: { note: 'duplicate' }
            }
        ]);

        expect(rows).toEqual([
            expect.objectContaining({ recipientName: 'Paid Player', playerName: 'Paid Player', playerId: 'p1', status: 'Paid', assignedAmount: '100.00', paidAmount: '100.00', outstandingAmount: '0.00', refundedAmount: '0.00', lastPaymentDate: '2026-05-01', adminNotes: 'cash collection' }),
            expect.objectContaining({ recipientName: 'Partial Player', status: 'Partial', assignedAmount: '100.00', paidAmount: '25.00', outstandingAmount: '75.00', lastPaymentDate: '2026-05-02' }),
            expect.objectContaining({ recipientName: 'Unpaid Player', status: 'Unpaid', paidAmount: '0.00', outstandingAmount: '100.00' }),
            expect.objectContaining({ recipientName: 'Canceled Player', status: 'Canceled', paidAmount: '0.00', outstandingAmount: '0.00', adminNotes: 'waived' }),
            expect.objectContaining({ recipientName: 'Refunded Player', status: 'Partial', paidAmount: '60.00', outstandingAmount: '40.00', refundedAmount: '40.00', lastRefundDate: '2026-05-03', adminNotes: 'duplicate' })
        ]);
    });

    it('serializes a header-only CSV for empty recipient lists', () => {
        const csv = buildTeamFeePaymentSummaryCsv([]);
        expect(csv).toBe('Recipient name,Player name,Player ID,Status,Assigned amount,Paid amount,Outstanding amount,Refunded amount,Due date,Collection mode,Last payment date,Last refund date,Admin notes,Reference');
    });

    it('serializes generated rows as escaped CSV', () => {
        const csv = serializeTeamFeePaymentSummaryCsv([
            {
                recipientName: 'Doe, Jane',
                playerName: 'Jane "Shooter" Doe',
                playerId: 'p1',
                status: 'Paid',
                assignedAmount: '25.00',
                paidAmount: '25.00',
                outstandingAmount: '0.00',
                refundedAmount: '0.00',
                dueDate: '2026-06-01',
                collectionMode: 'offline_manual',
                lastPaymentDate: '2026-05-01',
                lastRefundDate: '',
                adminNotes: 'paid in full\nreceipt attached',
                reference: 'REF-1'
            }
        ]);

        expect(csv).toContain('\n"Doe, Jane","Jane ""Shooter"" Doe",p1,Paid,25.00,25.00,0.00,0.00,2026-06-01,offline_manual,2026-05-01,,"paid in full\nreceipt attached",REF-1');
    });
});
