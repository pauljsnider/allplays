import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

describe('admin telemetry performance view', () => {
    it('shows app performance filters and summary containers', () => {
        const adminHtml = fs.readFileSync('admin.html', 'utf8');
        const dom = new JSDOM(adminHtml);
        const document = dom.window.document;

        expect(document.querySelector('#telemetry-performance-samples')).toBeTruthy();
        expect(document.querySelector('#telemetry-performance-p50')).toBeTruthy();
        expect(document.querySelector('#telemetry-performance-p95')).toBeTruthy();
        expect(document.querySelector('#telemetry-performance-slow')).toBeTruthy();
        expect(document.querySelector('#telemetry-performance-groups')).toBeTruthy();
        expect(document.querySelector('#telemetry-performance-slow-events')).toBeTruthy();
        expect(document.querySelector('#telemetry-performance-tracked-workflows')).toBeTruthy();

        const filterValues = Array.from(document.querySelectorAll('#telemetry-event-filter option'))
            .map((option) => option.value);
        expect(filterValues).toContain('app_initial_load');
        expect(filterValues).toContain('app_ux_timing');
        expect(filterValues).toContain('app_workflow_timing');
        expect(filterValues).toContain('app_web_vital');
    });

    it('wires the admin telemetry tab to performance summaries', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminJs).toContain("from './telemetry-performance.js?v=3'");
        expect(adminJs).toContain('function renderTelemetryPerformance()');
        expect(adminJs).toContain('buildTelemetryPerformanceSummary(telemetryState.events');
        expect(adminJs).toContain('buildTrackedWorkflowLoadSummary(telemetryState.events');
        expect(adminJs).toContain("setTelemetryText('telemetry-performance-p95', formatPerformanceDuration(summary.p95Ms));");
        expect(adminJs).toContain("renderTelemetryList('telemetry-performance-tracked-workflows'");
        expect(adminJs).toContain('renderTelemetryPerformance();');
        expect(adminJs).toContain('renderTelemetryPerformanceEmpty(errorMessage);');
    });
});
