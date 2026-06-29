import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentSource = readFileSync(resolve(process.cwd(), 'src/app/team-fees/team-fees.component.ts'), 'utf8');

describe('parent team fees outstanding balance display', () => {
    it('renders unpaid fee amounts from the same live balance used for checkout eligibility', () => {
        expect(componentSource).toContain('const balanceCents = getFeeBalanceCents(data);');
        expect(componentSource).toContain('const canPayOnline = !isPaid && !isCanceled && balanceCents > 0');
        expect(componentSource).toContain('amount: isPaid || isCanceled ? normalizeAmount(data) : balanceCents / 100');
    });

    it('includes admin-written balance fields in the live balance calculation', () => {
        expect(componentSource).toContain('data.remainingBalanceCents');
        expect(componentSource).toContain('data.amountDueCents');
    });
});
