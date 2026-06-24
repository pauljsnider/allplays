import { describe, expect, it } from 'vitest';
import {
    buildCoverageReport,
    discoverRepositorySurfaces,
    formatCoverageReport,
    reportHasBlockingFailures
} from '../../scripts/report-test-coverage-map.mjs';

describe('feature coverage map', () => {
    it('accounts for every shipped html page, React page file, and exported Cloud Function', () => {
        const report = buildCoverageReport();

        expect(report.invalidReferences).toEqual({
            duplicateFeatureIds: [],
            missingPathReferences: [],
            unknownFunctionReferences: []
        });
        expect(report.unmapped).toEqual({
            htmlPages: [],
            appPageFiles: [],
            cloudFunctions: []
        });
        expect(reportHasBlockingFailures(report)).toBe(false);
    });

    it('discovers the expected repository surface area', () => {
        const discovered = discoverRepositorySurfaces();

        expect(discovered.htmlPages).toContain('help.html');
        expect(discovered.htmlPages).toContain('registration.html');
        expect(discovered.htmlPages).toContain('workflow-track-game.html');
        expect(discovered.appPageFiles).toContain('apps/app/src/pages/ResetPassword.tsx');
        expect(discovered.appPageFiles).toContain('apps/app/src/pages/TeamFees.tsx');
        expect(discovered.cloudFunctions).toContain('submitPublicRegistration');
        expect(discovered.cloudFunctions).toContain('createStripeTeamFeeCheckout');
        expect(discovered.cloudFunctions).toContain('notifyTeamChatMessageCreated');
    });

    it('keeps the current follow-up gaps visible in the report output', () => {
        const report = buildCoverageReport();
        const formatted = formatCoverageReport(report);

        expect(report.tierGaps).toEqual([
            { feature: 'registration.provider-sync-checkout', tier: 'workflow' },
            { feature: 'fees.payments-team-pass', tier: 'workflow' },
            { feature: 'officials.org-tournaments-drills', tier: 'workflow' }
        ]);
        expect(formatted).toContain('Known follow-up gaps:');
        expect(formatted).toContain('registration.provider-sync-checkout [workflow]');
        expect(formatted).toContain('fees.payments-team-pass [workflow]');
        expect(formatted).toContain('officials.org-tournaments-drills [workflow]');
    });
});
