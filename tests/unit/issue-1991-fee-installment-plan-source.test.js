import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const teamFeesServiceSource = readFileSync(new URL('../../apps/app/src/lib/teamFeesService.ts', import.meta.url), 'utf8');
const teamFeesServiceTestSource = readFileSync(new URL('./app-team-fees-service.test.ts', import.meta.url), 'utf8');
const legacyFeesAdminSource = readFileSync(new URL('../../js/team-fees-admin.js', import.meta.url), 'utf8');
const registrationFlowSource = readFileSync(new URL('../../js/registration-flow.js', import.meta.url), 'utf8');
const registrationFlowTestSource = readFileSync(new URL('./registration-flow.test.js', import.meta.url), 'utf8');

describe('issue 1991 fee installment plan source contract', () => {
    it('keeps app team-fee installment preview math bounded and deterministic', () => {
        expect(teamFeesServiceSource).toContain('export type TeamFeeInstallmentScheduleInput');
        expect(teamFeesServiceSource).toContain('export type TeamFeeInstallmentPreview');
        expect(teamFeesServiceSource).toContain('export function buildTeamFeeInstallmentSchedule');
        expect(teamFeesServiceSource).toContain('throw new Error(\'Enter an amount greater than $0 before creating a payment plan.\');');
        expect(teamFeesServiceSource).toContain('throw new Error(\'Choose between 2 and 12 installments.\');');
        expect(teamFeesServiceSource).toContain('throw new Error(\'Installment spacing must be between 1 and 366 days.\');');
        expect(teamFeesServiceSource).toContain('const remainderCents = totalAmountCents % count;');
        expect(teamFeesServiceSource).toContain('label: `Installment ${index + 1} of ${count}`');
    });

    it('keeps legacy fee admin installment rows and total validation intact', () => {
        expect(legacyFeesAdminSource).toContain('const installments = normalizeInvoiceEntries(formValues.installments, {');
        expect(legacyFeesAdminSource).toContain("missingMessage: 'Complete each installment due date and amount before saving.'");
        expect(legacyFeesAdminSource).toContain('if (installments.length && sumCents(installments) !== amountCents)');
        expect(legacyFeesAdminSource).toContain('id="add-installment"');
        expect(legacyFeesAdminSource).toContain('id="installments-list"');
        expect(legacyFeesAdminSource).toContain('renderInvoiceRow(\'installment\')');
        expect(legacyFeesAdminSource).toContain('data-installment-row');
    });

    it('keeps related registration payment-plan support and tests in place', () => {
        expect(registrationFlowSource).toContain('export function getPaymentPlanChoices');
        expect(registrationFlowSource).toContain('export function buildPaymentPlanSnapshot');
        expect(registrationFlowSource).toContain("id: useInstallments ? 'installments' : 'pay_full'");
        expect(teamFeesServiceTestSource).toContain('builds rounded installment previews for payment plan setup');
        expect(teamFeesServiceTestSource).toContain('defaults null installment spacing to 30 days');
        expect(teamFeesServiceTestSource).toContain('rejects invalid installment plan inputs');
        expect(registrationFlowTestSource).toContain('normalizes installment plans and snapshots selected schedules');
    });
});
