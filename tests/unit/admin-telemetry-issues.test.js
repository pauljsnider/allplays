import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

describe('admin telemetry issue-first view', () => {
    it('shows issue signals first and includes drill-down filter options', () => {
        const adminHtml = fs.readFileSync('admin.html', 'utf8');
        const dom = new JSDOM(adminHtml);

        const needsAttention = dom.window.document.querySelector('#telemetry-needs-attention');
        expect(needsAttention).toBeTruthy();
        expect(adminHtml.indexOf('id="telemetry-needs-attention"')).toBeLessThan(adminHtml.indexOf('id="telemetry-total-events"'));

        const filterValues = Array.from(dom.window.document.querySelectorAll('#telemetry-event-filter option'))
            .map((option) => option.value);
        expect(filterValues).toContain('js_error');
        expect(filterValues).toContain('js_unhandled_rejection');
        expect(filterValues).toContain('app_load_error');
        expect(filterValues).toContain('interaction_rage_click');
    });

    it('renders issue counts from aggregate telemetry and recent examples from raw events', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminJs).toContain("{ name: 'js_error', label: 'JS errors' }");
        expect(adminJs).toContain("{ name: 'js_unhandled_rejection', label: 'Unhandled rejections' }");
        expect(adminJs).toContain("{ name: 'app_load_error', label: 'App errors' }");
        expect(adminJs).toContain("{ name: 'interaction_rage_click', label: 'Rage clicks' }");
        expect(adminJs).toContain('function renderTelemetryNeedsAttention()');
        expect(adminJs).toContain('function getTelemetryIssueCounts()');
        expect(adminJs).toContain('telemetryState.eventDaily.forEach((row) => {');
        expect(adminJs).toContain('const totalIssues = Array.from(issueCounts.values()).reduce((sum, count) => sum + count, 0);');
        expect(adminJs).toContain('const issueEvents = telemetryState.events.filter((event) => issueCounts.has(event.name));');
        expect(adminJs).toContain('No tracked errors or rage clicks recorded for this range.');
        expect(adminJs).toContain('grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3');
        expect(adminJs).toContain('renderTelemetryNeedsAttention();');
    });
});
