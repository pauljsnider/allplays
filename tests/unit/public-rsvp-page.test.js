import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readPublicRsvpPage() {
    return readFileSync(new URL('../../public-rsvp.html', import.meta.url), 'utf8');
}

describe('public RSVP page', () => {
    it('shows public confirmation states without requiring sign in', () => {
        const source = readPublicRsvpPage();

        expect(source).toContain('ALL PLAYS RSVP');
        expect(source).toContain('id="rsvp-form"');
        expect(source).toContain('value="going"');
        expect(source).toContain('value="maybe"');
        expect(source).toContain('value="not_going"');
        expect(source).toContain('No sign-in required');
    });

    it('calls public RSVP validation and submit endpoints with a safe error state', () => {
        const source = readPublicRsvpPage();

        expect(source).toContain('getPublicRsvp?token=');
        expect(source).toContain("callPublicRsvp('submitPublicRsvp'");
        expect(source).toContain('id="error-state"');
        expect(source).toContain('For privacy, this page only shows event details after a valid RSVP link is confirmed.');
        expect(source).toContain('The link is invalid, expired, or no longer available.');
    });

    it('reports init and submit failures through fail-open telemetry without RSVP secrets or PII', () => {
        const source = readPublicRsvpPage();
        const reporterStart = source.indexOf('function reportPublicRsvpFailure(stage, error = {})');
        const reporterEnd = source.indexOf('function buildPublicRsvpRequestError', reporterStart);
        const reporterSource = source.slice(reporterStart, reporterEnd);

        expect(source).not.toContain('<script type="module" src="/js/telemetry.js?v=2"></script>');
        expect(source).not.toContain("import('./js/telemetry.js");
        expect(source).toContain("publicRsvpTelemetryModulePromise = import('./js/public-rsvp-telemetry.js?v=2');");
        expect(source).toContain('<form id="rsvp-form" data-telemetry-ignore');
        expect(source).not.toContain("import { captureTelemetryEvent }");
        expect(reporterStart).toBeGreaterThanOrEqual(0);
        expect(reporterEnd).toBeGreaterThan(reporterStart);
        expect(reporterSource).toContain('.then(({ capturePublicRsvpFailure }) => capturePublicRsvpFailure(properties))');
        expect(reporterSource).not.toContain('window.AllPlaysTelemetry');
        expect(reporterSource).toContain("const normalizedStage = stage === 'submit' ? 'submit' : 'init'");
        expect(reporterSource).toContain("label: normalizedStage === 'submit' ? 'Public RSVP submit' : 'Public RSVP init'");
        expect(reporterSource).toContain('stage: normalizedStage,');
        expect(reporterSource).toContain('failureKind,');
        expect(reporterSource).toContain('httpStatus,');
        expect(reporterSource).toContain('online: navigator.onLine !== false');
        expect(reporterSource).toContain('} catch {');
        expect(reporterSource).not.toContain('window.location');
        expect(reporterSource).not.toContain('URLSearchParams');
        expect(reporterSource).not.toContain('requestedResponse');
        expect(reporterSource).not.toContain('error.message');
        expect(reporterSource).not.toContain('payload');
        expect(reporterSource).not.toContain('selected');
        expect(reporterSource).not.toContain('teamName');
        expect(reporterSource).not.toContain('childName');

        expect(source).toContain("reportPublicRsvpFailure('init', { publicRsvpFailureKind: 'missing_token' });");
        expect(source).toContain("reportPublicRsvpFailure('init', error);");
        expect(source).toContain("reportPublicRsvpFailure('submit', error);");
    });
});
