import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

    it('ignores app build output when discovering shipped HTML pages', () => {
        const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'allplays-coverage-map-'));

        try {
            mkdirSync(path.join(repoRoot, 'apps/app/dist'), { recursive: true });
            mkdirSync(path.join(repoRoot, 'apps/app/src/pages'), { recursive: true });
            mkdirSync(path.join(repoRoot, 'functions'), { recursive: true });

            writeFileSync(path.join(repoRoot, 'help.html'), '<h1>Help</h1>');
            writeFileSync(path.join(repoRoot, 'apps/app/bundle-visualizer.html'), '<h1>Generated bundle report</h1>');
            writeFileSync(path.join(repoRoot, 'apps/app/dist/index.html'), '<h1>Built app shell</h1>');
            writeFileSync(path.join(repoRoot, 'apps/app/src/pages/Home.tsx'), 'export function Home() { return null; }');
            writeFileSync(path.join(repoRoot, 'functions/index.js'), 'exports.exampleFunction = () => {};');

            const discovered = discoverRepositorySurfaces(repoRoot);

            expect(discovered.htmlPages).toEqual(['help.html']);
            expect(discovered.appPageFiles).toEqual(['apps/app/src/pages/Home.tsx']);
            expect(discovered.cloudFunctions).toEqual(['exampleFunction']);
        } finally {
            rmSync(repoRoot, { recursive: true, force: true });
        }
    });

    it('keeps the current follow-up gaps visible in the report output', () => {
        const report = buildCoverageReport();
        const formatted = formatCoverageReport(report);

        expect(report.tierGaps).toEqual([
            { feature: 'registration.provider-sync-checkout', tier: 'workflow' },
            { feature: 'officials.org-tournaments-drills', tier: 'workflow' }
        ]);
        expect(formatted).toContain('Known follow-up gaps:');
        expect(formatted).toContain('registration.provider-sync-checkout [workflow]');
        expect(formatted).toContain('fees.payments-team-pass [workflow]');
        expect(formatted).toContain('officials.org-tournaments-drills [workflow]');
    });
});
