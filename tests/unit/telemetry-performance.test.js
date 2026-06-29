import { describe, expect, it } from 'vitest';
import {
    TRACKED_WORKFLOW_LOAD_LABELS,
    buildTrackedWorkflowLoadSummary,
    buildTelemetryPerformanceSummary,
    formatPerformanceDuration,
    getTelemetryPerformanceEvents,
    getTelemetryPerformanceLabel,
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
    it('summarizes timer events into p50, p95, slow counts, and grouped rows', () => {
        const summary = buildTelemetryPerformanceSummary([
            telemetryEvent('app_initial_load', { loadName: 'home', durationMs: 100, outcome: 'success' }, { pagePath: '/app/#/' }),
            telemetryEvent('app_ux_timing', { label: 'schedule mount load', durationMs: 500, outcome: 'success' }),
            telemetryEvent('app_workflow_timing', { workflowName: 'schedule create game', durationMs: 1200, outcome: 'success' }),
            telemetryEvent('app_workflow_timing', { workflowName: 'schedule create game', durationMs: 2200, outcome: 'success' }),
            telemetryEvent('app_workflow_timing', { workflowName: 'team media photo upload', durationMs: 5000, outcome: 'success' }, { pagePath: '/app/#/team-media' }),
            telemetryEvent('page_view', { durationMs: 9999 })
        ], { slowThresholdMs: 1500, groupLimit: 10, slowLimit: 10 });

        expect(summary.count).toBe(5);
        expect(summary.p50Ms).toBe(1200);
        expect(summary.p95Ms).toBe(5000);
        expect(summary.maxMs).toBe(5000);
        expect(summary.slowCount).toBe(2);
        expect(summary.groups[0]).toMatchObject({
            label: 'team media photo upload',
            route: '/app/#/team-media',
            count: 1,
            p95Ms: 5000,
            slowCount: 1
        });
        expect(summary.slowEvents.map((item) => item.durationMs)).toEqual([5000, 2200]);
    });

    it('includes millisecond web vitals and ignores unitless CLS values', () => {
        const lcp = telemetryEvent('app_web_vital', { name: 'LCP', value: 1600, id: 'lcp-1' });
        const cls = telemetryEvent('app_web_vital', { name: 'CLS', value: 0.02, id: 'cls-1' });

        expect(getTelemetryPerformanceValue(lcp)).toBe(1600);
        expect(getTelemetryPerformanceLabel(lcp)).toBe('Web vital LCP');
        expect(getTelemetryPerformanceValue(cls)).toBeNull();
        expect(getTelemetryPerformanceEvents([lcp, cls])).toHaveLength(1);
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
