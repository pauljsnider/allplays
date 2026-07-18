import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

describe('admin telemetry event store dashboard', () => {
    it('shows all-event filters and app route aggregate containers', () => {
        const adminHtml = fs.readFileSync('admin.html', 'utf8');
        const dom = new JSDOM(adminHtml);
        const document = dom.window.document;

        expect(document.querySelector('#telemetry-top-routes')).toBeTruthy();
        expect(document.querySelector('#telemetry-page-filter')?.getAttribute('placeholder')).toBe('Filter by route or page...');
        expect(document.querySelector('#view-telemetry')?.textContent).toContain('System Event Telemetry');
        expect(document.querySelector('#view-telemetry')?.textContent).toContain('event store');

        const filterValues = Array.from(document.querySelectorAll('#telemetry-event-filter option'))
            .map((option) => option.value);
        expect(filterValues).toEqual(expect.arrayContaining([
            '',
            'page_view',
            'page_performance',
            'page_leave',
            'interaction_click',
            'interaction_change',
            'interaction_submit',
            'scroll_depth',
            'visibility_change',
            'auth_context',
            'js_error',
            'js_unhandled_rejection',
            'app_load_error',
            'public_rsvp_error',
            'interaction_rage_click',
            'app_initial_load',
            'app_ux_timing',
            'app_workflow_timing',
            'app_web_vital'
        ]));
    });

    it('loads route aggregates and renders effective routes for raw events', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');
        const dbJs = fs.readFileSync('js/db.js', 'utf8');
        const functionsJs = fs.readFileSync('functions/index.js', 'utf8');
        const rules = fs.readFileSync('firestore.rules', 'utf8');

        expect(dbJs).toContain('export async function getTelemetryRouteDaily');
        expect(dbJs).toContain("collection(db, 'telemetryRoutesDaily')");
        expect(adminJs).toContain('getTelemetryRouteDaily');
        expect(adminJs).toContain('function getTelemetryRoute(event)');
        expect(adminJs).toContain('function renderTopTelemetryRoutes()');
        expect(adminJs).toContain("renderTelemetryList('telemetry-top-routes'");
        expect(adminJs).toContain('renderTopTelemetryRoutes();');
        expect(adminJs).toContain('session.lastRoute || session.entryRoute || session.lastPage || session.entryPage');
        expect(adminJs).toContain('const route = getTelemetryRoute(event);');
        expect(functionsJs).toContain("db.collection('telemetryRoutesDaily')");
        expect(functionsJs).toContain('appRoute: event.appRoute || event.pagePath');
        expect(functionsJs).toContain('lastRoute: event.appRoute || event.pagePath');
        expect(rules).toContain('match /telemetryRoutesDaily/{routeId}');
        expect(rules).toContain('allow read: if isGlobalAdmin();');
    });
});
