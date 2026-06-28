const TIMER_EVENT_NAMES = new Set([
    'app_initial_load',
    'app_ux_timing',
    'app_workflow_timing'
]);

const WEB_VITAL_DURATION_NAMES = new Set(['FCP', 'INP', 'LCP', 'TTFB']);

export const TRACKED_WORKFLOW_LOAD_LABELS = [
    'home today load',
    'home feed load',
    'home players load',
    'home teams load',
    'home friends load',
    'schedule load',
    'messages choose team load',
    'my teams team schedule load',
    'my teams team roster load',
    'my teams team insights load',
    'my teams team more load',
    'profile account load',
    'profile alerts load',
    'profile invites load',
    'profile security load'
];

function telemetryDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

export function getTelemetryPerformanceValue(event) {
    const properties = event?.properties || {};
    if (TIMER_EVENT_NAMES.has(event?.name)) {
        return toFiniteNumber(properties.durationMs);
    }
    if (event?.name === 'app_web_vital' && WEB_VITAL_DURATION_NAMES.has(String(properties.name || '').toUpperCase())) {
        return toFiniteNumber(properties.value);
    }
    return null;
}

export function getTelemetryPerformanceLabel(event) {
    const properties = event?.properties || {};
    if (event?.name === 'app_workflow_timing') return properties.workflowName || 'Workflow timer';
    if (event?.name === 'app_initial_load') return `${properties.loadName || 'App'} initial load`;
    if (event?.name === 'app_ux_timing') return properties.label || 'UX timer';
    if (event?.name === 'app_web_vital') return `Web vital ${properties.name || 'metric'}`;
    return event?.name || 'Performance event';
}

export function getTelemetryPerformanceRoute(event) {
    const properties = event?.properties || {};
    return event?.appRoute ||
        properties.completedRoute ||
        properties.targetRoute ||
        properties.route ||
        properties.appRoute ||
        event?.pagePath ||
        '';
}

export function getTelemetryPerformanceEvents(events = []) {
    return events
        .map((event) => {
            const durationMs = getTelemetryPerformanceValue(event);
            if (durationMs === null) return null;
            const createdAt = telemetryDate(event.createdAt) || telemetryDate(event.clientTimestamp);
            return {
                event,
                name: event.name,
                label: String(getTelemetryPerformanceLabel(event)),
                route: String(getTelemetryPerformanceRoute(event) || ''),
                durationMs,
                createdAt,
                sessionId: event.sessionId || '',
                userId: event.userId || '',
                outcome: event.properties?.outcome || '',
                platform: event.properties?.platform || ''
            };
        })
        .filter(Boolean);
}

export function percentile(values, percentileRank) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentileRank / 100) * sorted.length) - 1;
    return sorted[Math.min(Math.max(index, 0), sorted.length - 1)];
}

export function formatPerformanceDuration(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return '-';
    if (numeric < 1000) return `${Math.round(numeric)} ms`;
    return `${(numeric / 1000).toFixed(numeric >= 10000 ? 1 : 2)} s`;
}

export function buildTelemetryPerformanceSummary(events = [], options = {}) {
    const slowThresholdMs = Number(options.slowThresholdMs || 1500);
    const groupLimit = Math.max(1, Number(options.groupLimit || 8));
    const slowLimit = Math.max(1, Number(options.slowLimit || 8));
    const performanceEvents = getTelemetryPerformanceEvents(events);
    const durations = performanceEvents.map((item) => item.durationMs);
    const slowEvents = performanceEvents
        .filter((item) => item.durationMs >= slowThresholdMs)
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, slowLimit);

    const groups = new Map();
    performanceEvents.forEach((item) => {
        const key = item.route ? `${item.label} · ${item.route}` : item.label;
        const current = groups.get(key) || {
            key,
            label: item.label,
            route: item.route,
            count: 0,
            durations: [],
            slowCount: 0,
            maxMs: 0
        };
        current.count += 1;
        current.durations.push(item.durationMs);
        current.slowCount += item.durationMs >= slowThresholdMs ? 1 : 0;
        current.maxMs = Math.max(current.maxMs, item.durationMs);
        groups.set(key, current);
    });

    const groupRows = Array.from(groups.values())
        .map((group) => ({
            ...group,
            p50Ms: percentile(group.durations, 50),
            p95Ms: percentile(group.durations, 95)
        }))
        .sort((a, b) => b.p95Ms - a.p95Ms || b.count - a.count)
        .slice(0, groupLimit);

    return {
        count: performanceEvents.length,
        p50Ms: percentile(durations, 50),
        p95Ms: percentile(durations, 95),
        maxMs: durations.length ? Math.max(...durations) : 0,
        slowThresholdMs,
        slowCount: performanceEvents.filter((item) => item.durationMs >= slowThresholdMs).length,
        groups: groupRows,
        slowEvents
    };
}

export function buildTrackedWorkflowLoadSummary(events = [], options = {}) {
    const labels = Array.isArray(options.labels) && options.labels.length
        ? options.labels
        : TRACKED_WORKFLOW_LOAD_LABELS;
    const labelSet = new Set(labels);
    const rowsByLabel = new Map(labels.map((label) => [label, {
        label,
        count: 0,
        durations: [],
        routes: new Set(),
        latestAt: null,
        maxMs: 0,
        slowCount: 0
    }]));
    const slowThresholdMs = Number(options.slowThresholdMs || 1500);

    getTelemetryPerformanceEvents(events)
        .filter((item) => item.name === 'app_ux_timing' && labelSet.has(item.label))
        .forEach((item) => {
            const row = rowsByLabel.get(item.label);
            if (!row) return;
            row.count += 1;
            row.durations.push(item.durationMs);
            if (item.route) row.routes.add(item.route);
            row.maxMs = Math.max(row.maxMs, item.durationMs);
            row.slowCount += item.durationMs >= slowThresholdMs ? 1 : 0;
            if (item.createdAt && (!row.latestAt || item.createdAt.getTime() > row.latestAt.getTime())) {
                row.latestAt = item.createdAt;
            }
        });

    return labels.map((label) => {
        const row = rowsByLabel.get(label);
        return {
            label,
            count: row.count,
            p50Ms: percentile(row.durations, 50),
            p95Ms: percentile(row.durations, 95),
            maxMs: row.maxMs,
            slowCount: row.slowCount,
            route: Array.from(row.routes).slice(0, 3).join(', '),
            latestAt: row.latestAt
        };
    });
}
