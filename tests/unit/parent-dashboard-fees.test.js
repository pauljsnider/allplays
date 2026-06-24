import { describe, expect, it } from 'vitest';
import {
    formatParentFeeAmount,
    formatParentFeeDueDate,
    handleParentTeamFeeCheckoutClick,
    normalizeParentFeeRecord,
    normalizeParentFeeStatus,
    renderParentTeamFees,
    sanitizeParentFeeRecipientRecord,
    sortParentFeeRecords
} from '../../js/parent-dashboard-fees.js';

describe('parent dashboard team fees', () => {
    it('renders assigned fee details with offline payment instructions', () => {
        const html = renderParentTeamFees([
            {
                feeTitle: 'Tournament dues',
                teamName: '12U Tigers',
                playerName: 'Sam',
                amountCents: 12500,
                dueDate: '2026-06-01',
                notes: 'Includes field rental.',
                offlinePaymentInstructions: 'Bring cash or check to practice.',
                status: 'unpaid'
            }
        ]);

        expect(html).toContain('Tournament dues');
        expect(html).toContain('12U Tigers');
        expect(html).toContain('For Sam');
        expect(html).toContain('$125.00');
        expect(html).toContain('Includes field rental.');
        expect(html).toContain('Bring cash or check to practice.');
        expect(html).toContain('Unpaid');
        expect(html).toContain('border-l-red-500');
        expect(html).not.toContain('Pay online');
    });

    it('renders Pay online for online Stripe team fees with checkout context', () => {
        const html = renderParentTeamFees([
            {
                feeTitle: 'Tournament dues',
                teamName: '12U Tigers',
                playerName: 'Sam',
                amountCents: 12500,
                balanceDueCents: 12500,
                dueDate: '2026-06-01',
                status: 'unpaid',
                collectionMode: 'online_stripe',
                teamId: 'team-1',
                batchId: 'batch-1',
                recipientId: 'player-1'
            }
        ]);

        expect(html).toContain('Pay online');
        expect(html).toContain('data-team-fee-checkout="true"');
        expect(html).toContain('data-team-id="team-1"');
        expect(html).not.toContain('Offline payment:');
    });

    it('normalizes paid, unpaid, partial, canceled, and adjusted status styling', () => {
        const html = renderParentTeamFees([
            { title: 'Paid fee', status: 'paid', amountCents: 1000 },
            { title: 'Unpaid fee', status: 'unpaid', amountCents: 1000 },
            { title: 'Partial fee', status: 'partial', amountCents: 1000 },
            { title: 'Legacy partial fee', status: 'partially_paid', amountCents: 1000 },
            { title: 'Canceled fee', status: 'canceled', amountCents: 1000 },
            { title: 'Adjusted fee', status: 'adjusted', adjustedAmountCents: 500 }
        ]);

        expect(html).toContain('Paid');
        expect(html).toContain('bg-green-100');
        expect(html).toContain('Unpaid');
        expect(html).toContain('bg-red-100');
        expect(html).toContain('Partially paid');
        expect(html).toContain('bg-blue-100');
        expect(normalizeParentFeeStatus('partial')).toBe('partial');
        expect(normalizeParentFeeStatus('partially_paid')).toBe('partially_paid');
        expect(html).toContain('Canceled');
        expect(html).toContain('bg-gray-100');
        expect(html).toContain('Adjusted');
        expect(html).toContain('bg-amber-100');
        expect(formatParentFeeAmount({ adjustedAmountCents: 500, amountCents: 1000 })).toBe('$5.00');
    });

    it('sorts by due date and safely handles missing values', () => {
        const sorted = sortParentFeeRecords([
            { title: 'No date' },
            { title: 'Later', dueDate: '2026-07-01' },
            { title: 'Sooner', dueDate: '2026-06-01' }
        ]);

        expect(sorted.map((fee) => fee.title)).toEqual(['Sooner', 'Later', 'No date']);
        expect(normalizeParentFeeStatus('unknown')).toBe('unpaid');
        expect(formatParentFeeAmount({})).toBe('Amount not set');
        expect(formatParentFeeDueDate(null)).toBe('No due date');
        expect(renderParentTeamFees([])).toBe('');
    });

    it('keeps date-only due dates on the intended local calendar date', () => {
        const previousTimeZone = process.env.TZ;
        process.env.TZ = 'America/Chicago';

        try {
            expect(formatParentFeeDueDate('2026-06-01')).toBe('Jun 1, 2026');
            expect(sortParentFeeRecords([
                { title: 'Later', dueDate: '2026-06-02' },
                { title: 'Sooner', dueDate: '2026-06-01' }
            ]).map((fee) => fee.title)).toEqual(['Sooner', 'Later']);
        } finally {
            process.env.TZ = previousTimeZone;
        }
    });

    it('renders a fee detail view with totals, balances, line items, installments, and receipts', () => {
        const html = renderParentTeamFees([
            {
                title: 'Spring team invoice',
                amountCents: 30000,
                paidAmountCents: 10000,
                lineItems: [
                    { description: 'Uniform kit', quantity: 1, amountCents: 12500 },
                    { name: 'Tournament entry', amountCents: 17500, dueDate: '2026-06-15' }
                ],
                installmentSchedule: [
                    { label: 'Deposit', dueDate: '2026-06-01', amountCents: 10000, paid: true },
                    { label: 'Final payment', dueDate: '2026-07-01', amountCents: 20000, status: 'unpaid' }
                ],
                ledgerEntries: [
                    { type: 'payment', paidAt: '2026-06-01', amountCents: 10000, receiptNumber: 'Receipt #101', status: 'posted' }
                ]
            }
        ]);

        expect(html).toContain('View fee details');
        expect(html).toContain('Total amount');
        expect(html).toContain('$300.00');
        expect(html).toContain('Paid');
        expect(html).toContain('$100.00');
        expect(html).toContain('Invoice line items');
        expect(html).toContain('Uniform kit');
        expect(html).toContain('Qty 1');
        expect(html).toContain('Tournament entry');
        expect(html).toContain('Due Jun 15, 2026');
        expect(html).toContain('Remaining balance');
        expect(html).toContain('$200.00');
        expect(html).toContain('Installment schedule');
        expect(html).toContain('Deposit');
        expect(html).toContain('Final payment');
        expect(html).toContain('Paid');
        expect(html).toContain('Unpaid');
        expect(html).toContain('Receipts & activity');
        expect(html).toContain('payment');
        expect(html).toContain('Receipt #101');
    });

    it('falls back to populated fee aliases when primary arrays are empty', () => {
        const html = renderParentTeamFees([
            {
                title: 'Alias-backed invoice',
                amountCents: 17500,
                lineItems: [],
                invoiceLineItems: [
                    { description: 'Warmup shirt', quantity: 2, amountCents: 7500 }
                ],
                installments: [],
                installmentSchedule: [
                    { label: 'Opening payment', dueDate: '2026-06-10', amountCents: 10000 }
                ]
            }
        ]);

        expect(html).toContain('Warmup shirt');
        expect(html).toContain('Qty 2');
        expect(html).toContain('Opening payment');
        expect(html).toContain('Due Jun 10, 2026');
    });

    it('renders refund ledger activity without exposing admin-only notes', () => {
        const html = renderParentTeamFees([
            {
                title: 'Refunded invoice',
                amountCents: 30000,
                paidAmountCents: 20000,
                balanceDueCents: 10000,
                ledgerEntries: [
                    { type: 'offline_payment', paymentDate: '2026-06-01', amountCents: 30000, receiptNumber: 'Receipt #202', status: 'posted' },
                    {
                        type: 'offline_refund',
                        refundDate: '2026-06-10',
                        refundAmountCents: 10000,
                        offlineMethod: 'check',
                        refundStatus: 'completed',
                        publicNote: 'Uniform returned',
                        internalNote: 'Admin-only reconciliation detail',
                        note: 'Private admin refund note',
                        recordedBy: 'admin-123'
                    }
                ]
            }
        ]);

        expect(html).toContain('Receipts & activity');
        expect(html).toContain('Refund');
        expect(html).toContain('-$100.00');
        expect(html).toContain('Jun 10, 2026');
        expect(html).toContain('check');
        expect(html).toContain('completed');
        expect(html).toContain('Uniform returned');
        expect(html).toContain('Paid');
        expect(html).toContain('$200.00');
        expect(html).toContain('Remaining balance');
        expect(html).toContain('$100.00');
        expect(html).not.toContain('Admin-only reconciliation detail');
        expect(html).not.toContain('Private admin refund note');
        expect(html).not.toContain('admin-123');
    });

    it('keeps already-safe parent fee records intact without needing private-field stripping', () => {
        const rawFee = {
            id: 'recipient-1',
            title: 'Parent-safe billing data',
            amountCents: 10000,
            status: 'paid',
            receiptMetadata: {
                provider: 'stripe',
                amountPaidCents: 10000
            },
            ledgerEntries: [
                {
                    type: 'stripe_refund',
                    amountCents: 2500,
                    publicNote: 'Uniform returned'
                }
            ]
        };

        const sanitized = sanitizeParentFeeRecipientRecord(rawFee);
        const normalized = normalizeParentFeeRecord(rawFee);

        expect(sanitized).toEqual(rawFee);
        expect(normalized.receiptMetadata).toEqual({
            provider: 'stripe',
            amountPaidCents: 10000
        });
        expect(normalized.ledgerEntries[0]).toEqual({
            type: 'stripe_refund',
            amountCents: 2500,
            publicNote: 'Uniform returned'
        });
    });

    it('renders Pay online only for Stripe collection fees with an unpaid balance', () => {
        const manualOnlyHtml = renderParentTeamFees([
            { title: 'Manual collection', collectionMode: 'offline_manual', teamId: 'team-1', batchId: 'batch-1', id: 'recipient-1', amountCents: 1000 }
        ]);
        const manualWithCheckoutUrlHtml = renderParentTeamFees([
            { title: 'Manual with stale URL', collectionMode: 'offline_manual', amountCents: 1000, checkoutUrl: 'https://pay.example/offline' }
        ]);
        const onlineCheckoutHtml = renderParentTeamFees([
            { title: 'Online collection', collectionMode: 'online_stripe', teamId: 'team-1', batchId: 'batch-1', id: 'recipient-1', amountCents: 1000 }
        ]);
        const checkoutHtml = renderParentTeamFees([
            { title: 'Online collection', collectionMode: 'online_stripe', amountCents: 1000, checkoutUrl: 'https://pay.example/checkout' }
        ]);
        const partialPaymentLinkHtml = renderParentTeamFees([
            { title: 'Partial collection', collectionMode: 'online_stripe', amountCents: 2000, paidAmountCents: 1000, status: 'partially_paid', paymentLink: 'https://pay.example/remaining' }
        ]);
        const paidHtml = renderParentTeamFees([
            { title: 'Paid collection', collectionMode: 'online_stripe', amountCents: 1000, balanceDueCents: 0, status: 'paid', checkoutUrl: 'https://pay.example/paid' }
        ]);
        const adjustedHtml = renderParentTeamFees([
            { title: 'Adjusted collection', collectionMode: 'online_stripe', amountCents: 1000, status: 'adjusted', checkoutUrl: 'https://pay.example/adjusted' }
        ]);
        const missingContextHtml = renderParentTeamFees([
            { title: 'No context collection', collectionMode: 'online_stripe', amountCents: 1000 }
        ]);

        expect(manualOnlyHtml).not.toContain('Pay online');
        expect(manualOnlyHtml).not.toContain('data-team-fee-checkout="true"');
        expect(manualWithCheckoutUrlHtml).not.toContain('Pay online');
        expect(manualWithCheckoutUrlHtml).not.toContain('https://pay.example/offline');
        expect(onlineCheckoutHtml).toContain('data-team-fee-checkout="true"');
        expect(onlineCheckoutHtml).toContain('data-team-id="team-1"');
        expect(onlineCheckoutHtml).toContain('data-batch-id="batch-1"');
        expect(onlineCheckoutHtml).toContain('data-recipient-id="recipient-1"');
        expect(onlineCheckoutHtml).toContain('>Pay online</button>');
        expect(checkoutHtml).toContain('>Pay online</a>');
        expect(checkoutHtml).toContain('https://pay.example/checkout');
        expect(partialPaymentLinkHtml).toContain('>Pay online</a>');
        expect(partialPaymentLinkHtml).toContain('https://pay.example/remaining');
        expect(paidHtml).not.toContain('Pay online');
        expect(adjustedHtml).not.toContain('Pay online');
        expect(missingContextHtml).not.toContain('data-team-fee-checkout="true"');
    });

    it('handles parent dashboard checkout clicks and redirects to Stripe', async () => {
        const errorEl = {
            textContent: '',
            classList: {
                add: () => {},
                remove: () => {}
            }
        };
        const card = {
            querySelector: (selector) => selector === '[data-team-fee-checkout-error]' ? errorEl : null
        };
        const button = {
            dataset: { teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' },
            disabled: false,
            textContent: 'Pay online',
            closest: (selector) => selector === '.team-fee-card' ? card : null
        };
        const event = {
            target: {
                closest: (selector) => selector === '[data-team-fee-checkout="true"]' ? button : null
            }
        };
        const calls = [];
        const locationTarget = { href: '' };

        const handled = await handleParentTeamFeeCheckoutClick(event, {
            initiateCheckout: async (params) => {
                calls.push(params);
                return 'https://checkout.stripe.com/team-fee-session';
            },
            locationTarget
        });

        expect(handled).toBe(true);
        expect(calls).toEqual([{ teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' }]);
        expect(locationTarget.href).toBe('https://checkout.stripe.com/team-fee-session');
    });

    it('restores the checkout button and shows an inline error when checkout fails', async () => {
        const classes = new Set(['hidden']);
        const errorEl = {
            textContent: '',
            classList: {
                add: (className) => classes.add(className),
                remove: (className) => classes.delete(className)
            }
        };
        const card = {
            querySelector: (selector) => selector === '[data-team-fee-checkout-error]' ? errorEl : null
        };
        const button = {
            dataset: { teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' },
            disabled: false,
            textContent: 'Pay online',
            closest: (selector) => selector === '.team-fee-card' ? card : null
        };
        const event = {
            target: {
                closest: (selector) => selector === '[data-team-fee-checkout="true"]' ? button : null
            }
        };

        await handleParentTeamFeeCheckoutClick(event, {
            initiateCheckout: async () => {
                throw new Error('Stripe is unavailable.');
            },
            locationTarget: { href: '' }
        });

        expect(button.disabled).toBe(false);
        expect(button.textContent).toBe('Pay online');
        expect(errorEl.textContent).toBe('Stripe is unavailable.');
        expect(classes.has('hidden')).toBe(false);
    });
});
