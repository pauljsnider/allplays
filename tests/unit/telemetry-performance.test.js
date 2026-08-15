import { describe, expect, it } from 'vitest';
import {
    TRACKED_WORKFLOW_LOAD_LABELS,
    buildTrackedWorkflowLoadSummary,
    buildTelemetryPerformanceSummary,
    formatPerformanceDuration,
    formatPerformanceValue,
    getTelemetryPerformanceEvents,
    getTelemetryPerformanceLabel,
    getTelemetryPerformanceMetric,
    getTelemetryPerformanceRoute,
    getTelemetryPerformanceValue,
    percentile
} from '../../js/telemetry-performance.js';

function telemetryEvent(name, properties, overrides = {}) {
    return {
        id: overrides.id || `${name}-${properties.durationMs || properties.value || Math.random()}`,
        name,
        pagePath: overrides.pagePath || '/app/#/schedule',
        appRoute: overrides.appRoute || '',
        sessionId: overrides.sessionId || 'session-1',
        userId: overrides.userId || '',
        clientTimestamp: overrides.clientTimestamp || '2030-06-01T12:00:00.000Z',
        properties
    };
}

describe('telemetry performance summaries', () => {
    it('compares only metrics that have an explicit metric-specific budget', () => {
        const summary = buildTelemetryPerformanceSummary([
            telemetryEvent('app_ux_timing', { label: 'warm resume to interactive', durationMs: 1000, outcome: 'success' }),
            telemetryEvent('app_ux_timing', { label: 'rsvp tap latency', durationMs: 700, outcome: 'success' }),
            telemetryEvent('app_ux_timing', { label: 'chat send latency', durationMs: 1200, outcome: 'success' }),
            telemetryEvent('app_workflow_timing', { workflowName: 'schedule create game', durationMs: 2200, outcome: 'success' }),
            telemetryEvent('app_web_vital', { name: 'LCP', value: 2600, id: 'lcp-1' }),
            telemetryEvent('app_web_vital', { name: 'CLS', value: 0.05, id: 'cls-1' }),
            telemetryEvent('page_view', { durationMs: 9999 })
        ], { groupLimit: 10, overBudgetLimit: 10 });

        expect(summary.count).toBe(6);
        expect(summary.p50Ms).toBe(1200);
        expect(summary.p95Ms).toBe(2600);
        expect(summary.maxMs).toBe(2600);
        expect(summary.budgetedCount).toBe(5);
        expect(summary.withinBudgetCount).toBe(2);
        expect(summary.overBudgetCount).toBe(3);
        expect(summary.unbudgetedCount).toBe(1);
        expect(summary.groups[0]).toMatchObject({
            label: 'chat send latency',
            count: 1,
            p95Ms: 1200,
            budgetValue: 800,
            overBudgetCount: 1
        });
        expect(summary.overBudgetEvents.map((item) => item.label)).toEqual([
            'chat send latency',
            'rsvp tap latency',
            'Web vital LCP'
        ]);
    });

    it('keeps millisecond and unitless web-vital values in separate units', () => {
        const lcp = telemetryEvent('app_web_vital', { name: 'LCP', value: 1600, id: 'lcp-1' });
        const cls = telemetryEvent('app_web_vital', { name: 'CLS', value: 0.02, id: 'cls-1' });

        expect(getTelemetryPerformanceValue(lcp)).toBe(1600);
        expect(getTelemetryPerformanceLabel(lcp)).toBe('Web vital LCP');
        expect(getTelemetryPerformanceValue(cls)).toBe(0.02);
        expect(getTelemetryPerformanceMetric(cls)).toEqual({
            value: 0.02,
            unit: 'score',
            budgetValue: 0.1,
            overBudget: false
        });
        expect(getTelemetryPerformanceEvents([lcp, cls])).toHaveLength(2);
    });

    it('ignores timer events whose metric value is missing or blank', () => {
        const missing = telemetryEvent('app_ux_timing', { label: 'warm resume to interactive' });
        const blank = telemetryEvent('app_ux_timing', { label: 'warm resume to interactive', durationMs: '' });

        expect(getTelemetryPerformanceMetric(missing)).toBeNull();
        expect(getTelemetryPerformanceMetric(blank)).toBeNull();
        expect(buildTelemetryPerformanceSummary([missing, blank]).count).toBe(0);
    });

    it('does not combine identically labeled events from different timer categories', () => {
        const ux = telemetryEvent('app_ux_timing', { label: 'shared label', durationMs: 100 });
        const workflow = telemetryEvent('app_workflow_timing', { workflowName: 'shared label', durationMs: 900 });

        const summary = buildTelemetryPerformanceSummary([ux, workflow], { groupLimit: 10 });

        expect(summary.groups).toHaveLength(2);
        expect(summary.groups.map((group) => group.name)).toEqual(expect.arrayContaining([
            'app_ux_timing',
            'app_workflow_timing'
        ]));
    });

    it('uses platform-specific startup budgets', () => {
        const ios = telemetryEvent('app_ux_timing', {
            label: 'app start to home first meaningful render',
            durationMs: 2200,
            platform: 'ios'
        });
        const android = telemetryEvent('app_ux_timing', {
            label: 'app start to home first meaningful render',
            durationMs: 2200,
            platform: 'android'
        });
        const web = telemetryEvent('app_ux_timing', {
            label: 'app start to home first meaningful render',
            durationMs: 2700,
            platform: 'web'
        });
        const untagged = telemetryEvent('app_ux_timing', {
            label: 'app start to home first meaningful render',
            durationMs: 2700
        });
        const unknown = telemetryEvent('app_ux_timing', {
            label: 'app start to home first meaningful render',
            durationMs: 2700,
            platform: 'desktop'
        });

        expect(getTelemetryPerformanceMetric(ios)).toMatchObject({ budgetValue: 2000, overBudget: true });
        expect(getTelemetryPerformanceMetric(android)).toMatchObject({ budgetValue: 3000, overBudget: false });
        expect(getTelemetryPerformanceMetric(web)).toMatchObject({ budgetValue: 2500, overBudget: true });
        expect(getTelemetryPerformanceMetric(untagged)).toMatchObject({ budgetValue: null, overBudget: null });
        expect(getTelemetryPerformanceMetric(unknown)).toMatchObject({ budgetValue: null, overBudget: null });

        const summary = buildTelemetryPerformanceSummary([ios, android, web, untagged, unknown], { groupLimit: 10 });
        expect(summary.budgetedCount).toBe(3);
        expect(summary.unbudgetedCount).toBe(2);
        expect(summary.groups).toEqual(expect.arrayContaining([
            expect.objectContaining({ platform: 'ios', budgetValue: 2000, overBudgetCount: 1 }),
            expect.objectContaining({ platform: 'android', budgetValue: 3000, overBudgetCount: 0 }),
            expect.objectContaining({ platform: 'web', budgetValue: 2500, overBudgetCount: 1 })
        ]));
    });

    it('uses explicit app and workflow routes before legacy page paths', () => {
        expect(getTelemetryPerformanceRoute(telemetryEvent('app_workflow_timing', {
            workflowName: 'parent core workflow drill in',
            durationMs: 300,
            completedRoute: '/players/team-1/player-1',
            targetRoute: '/players/team-1/player-1'
        }))).toBe('/players/team-1/player-1');

        expect(getTelemetryPerformanceRoute(telemetryEvent('app_initial_load', {
            loadName: 'home',
            durationMs: 100
        }, {
            appRoute: '/home',
            pagePath: '/'
        }))).toBe('/home');
    });

    it('formats percentiles and durations for admin display', () => {
        expect(percentile([10, 20, 30, 40], 50)).toBe(20);
        expect(percentile([10, 20, 30, 40], 95)).toBe(40);
        expect(formatPerformanceDuration(999)).toBe('999 ms');
        expect(formatPerformanceDuration(1500)).toBe('1.50 s');
        expect(formatPerformanceDuration(12500)).toBe('12.5 s');
        expect(formatPerformanceValue(0.024, 'score')).toBe('0.024');
    });

    it('builds DB-backed dashboard rows for every tracked workflow load timer', () => {
        const rows = buildTrackedWorkflowLoadSummary([
            telemetryEvent('app_ux_timing', { label: 'home today load', durationMs: 120, outcome: 'success' }, { appRoute: '/home' }),
            telemetryEvent('app_ux_timing', { label: 'home today load', durationMs: 240, outcome: 'success' }, { appRoute: '/home' }),
            telemetryEvent('app_ux_timing', { label: 'profile security load', durationMs: 80, outcome: 'success' }, { appRoute: '/profile?section=security' }),
            telemetryEvent('app_ux_timing', { label: 'untracked load', durationMs: 900, outcome: 'success' }, { appRoute: '/other' })
        ]);

        expect(rows.map((row) => row.label)).toEqual(TRACKED_WORKFLOW_LOAD_LABELS);
        expect(rows.find((row) => row.label === 'home today load')).toMatchObject({
            count: 2,
            p50Ms: 120,
            p95Ms: 240,
            maxMs: 240,
            budgetMs: 1500,
            route: '/home'
        });
        expect(rows.find((row) => row.label === 'profile security load')).toMatchObject({
            count: 1,
            p50Ms: 80,
            p95Ms: 80,
            maxMs: 80,
            route: '/profile?section=security'
        });
        expect(rows.find((row) => row.label === 'my teams team roster load')).toMatchObject({
            count: 0,
            p50Ms: 0,
            p95Ms: 0,
            maxMs: 0,
            route: ''
        });
    });
});
