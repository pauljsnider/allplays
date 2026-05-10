import { describe, expect, it } from 'vitest';
import {
    formatParentFeeAmount,
    formatParentFeeDueDate,
    normalizeParentFeeStatus,
    renderParentTeamFees,
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

    it('only renders a Pay action for unpaid or partially paid fees with a checkout or payment link', () => {
        const manualOnlyHtml = renderParentTeamFees([
            { title: 'Manual collection', amountCents: 1000 }
        ]);
        const checkoutHtml = renderParentTeamFees([
            { title: 'Online collection', amountCents: 1000, checkoutUrl: 'https://pay.example/checkout' }
        ]);
        const partialPaymentLinkHtml = renderParentTeamFees([
            { title: 'Partial collection', amountCents: 2000, paidAmountCents: 1000, status: 'partially_paid', paymentLink: 'https://pay.example/remaining' }
        ]);
        const paidHtml = renderParentTeamFees([
            { title: 'Paid collection', amountCents: 1000, balanceDueCents: 0, status: 'paid', checkoutUrl: 'https://pay.example/paid' }
        ]);
        const adjustedHtml = renderParentTeamFees([
            { title: 'Adjusted collection', amountCents: 1000, status: 'adjusted', checkoutUrl: 'https://pay.example/adjusted' }
        ]);

        expect(manualOnlyHtml).not.toContain('>Pay</a>');
        expect(checkoutHtml).toContain('>Pay</a>');
        expect(checkoutHtml).toContain('https://pay.example/checkout');
        expect(partialPaymentLinkHtml).toContain('>Pay</a>');
        expect(partialPaymentLinkHtml).toContain('https://pay.example/remaining');
        expect(paidHtml).not.toContain('>Pay</a>');
        expect(adjustedHtml).not.toContain('>Pay</a>');
    });
});
