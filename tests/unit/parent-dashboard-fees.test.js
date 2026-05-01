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

    it('normalizes paid, unpaid, canceled, and adjusted status styling', () => {
        const html = renderParentTeamFees([
            { title: 'Paid fee', status: 'paid', amountCents: 1000 },
            { title: 'Unpaid fee', status: 'unpaid', amountCents: 1000 },
            { title: 'Canceled fee', status: 'canceled', amountCents: 1000 },
            { title: 'Adjusted fee', status: 'adjusted', adjustedAmountCents: 500 }
        ]);

        expect(html).toContain('Paid');
        expect(html).toContain('bg-green-100');
        expect(html).toContain('Unpaid');
        expect(html).toContain('bg-red-100');
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
});
