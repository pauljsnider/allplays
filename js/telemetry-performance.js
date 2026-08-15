const TIMER_EVENT_NAMES = new Set([
    'app_initial_load',
    'app_ux_timing',
    'app_workflow_timing'
]);

const WEB_VITAL_BUDGETS = new Map([
    ['CLS', { value: 0.1, unit: 'score' }],
    ['FCP', { value: 1800, unit: 'ms' }],
    ['INP', { value: 200, unit: 'ms' }],
    ['LCP', { value: 2500, unit: 'ms' }],
    ['TTFB', { value: 800, unit: 'ms' }]
]);

const UX_BUDGETS_MS = new Map([
    ['warm resume to interactive', 1500],
    ['rsvp tap latency', 600],
    ['chat send latency', 800]
]);

export const TRACKED_WORKFLOW_LOAD_BUDGET_MS = 1500;

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
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

export function getTelemetryPerformanceValue(event) {
    return getTelemetryPerformanceMetric(event)?.value ?? null;
}

export function getTelemetryPerformanceMetric(event) {
    const properties = event?.properties || {};
    if (TIMER_EVENT_NAMES.has(event?.name)) {
        const value = toFiniteNumber(properties.durationMs);
        if (value === null) return null;
        const budgetValue = getTimerBudgetMs(event);
        return {
            value,
            unit: 'ms',
            budgetValue,
            overBudget: budgetValue === null ? null : value > budgetValue
        };
    }
    if (event?.name === 'app_web_vital') {
        const vitalName = String(properties.name || '').toUpperCase();
        const budget = WEB_VITAL_BUDGETS.get(vitalName);
        const value = toFiniteNumber(properties.value);
        if (!budget || value === null) return null;
        return {
            value,
            unit: budget.unit,
            budgetValue: budget.value,
            overBudget: value > budget.value
        };
    }
    return null;
}

function getTimerBudgetMs(event) {
    if (event?.name !== 'app_ux_timing') return null;
    const label = String(event.properties?.label || '');
    if (label === 'app start to home first meaningful render') {
        const platform = String(event.properties?.platform || '').toLowerCase();
        if (platform === 'ios') return 2000;
        if (platform === 'android') return 3000;
        return 2500;
    }
    if (UX_BUDGETS_MS.has(label)) return UX_BUDGETS_MS.get(label);
    if (TRACKED_WORKFLOW_LOAD_LABELS.includes(label)) return TRACKED_WORKFLOW_LOAD_BUDGET_MS;
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
            const metric = getTelemetryPerformanceMetric(event);
            if (!metric) return null;
            const createdAt = telemetryDate(event.createdAt) || telemetryDate(event.clientTimestamp);
            return {
                event,
                name: event.name,
                label: String(getTelemetryPerformanceLabel(event)),
                route: String(getTelemetryPerformanceRoute(event) || ''),
                value: metric.value,
                unit: metric.unit,
                durationMs: metric.unit === 'ms' ? metric.value : null,
                budgetValue: metric.budgetValue,
                overBudget: metric.overBudget,
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

export function formatPerformanceValue(value, unit = 'ms') {
    if (unit === 'score') {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric.toFixed(3) : '-';
    }
    return formatPerformanceDuration(value);
}

export function buildTelemetryPerformanceSummary(events = [], options = {}) {
    const groupLimit = Math.max(1, Number(options.groupLimit || 8));
    const overBudgetLimit = Math.max(1, Number(options.overBudgetLimit || options.slowLimit || 8));
    const performanceEvents = getTelemetryPerformanceEvents(events);
    const durationEvents = performanceEvents.filter((item) => item.unit === 'ms');
    const durations = durationEvents.map((item) => item.value);
    const budgetedEvents = performanceEvents.filter((item) => item.budgetValue !== null);
    const overBudgetEvents = budgetedEvents
        .filter((item) => item.overBudget)
        .sort((a, b) => (
            (b.value / b.budgetValue) - (a.value / a.budgetValue)
            || b.value - a.value
        ))
        .slice(0, overBudgetLimit);

    const groups = new Map();
    performanceEvents.forEach((item) => {
        const key = [item.name, item.label, item.route, item.platform].filter(Boolean).join(' · ');
        const current = groups.get(key) || {
            key,
            name: item.name,
            label: item.label,
            route: item.route,
            platform: item.platform,
            unit: item.unit,
            budgetValue: item.budgetValue,
            count: 0,
            values: [],
            overBudgetCount: 0,
            maxValue: 0
        };
        current.count += 1;
        current.values.push(item.value);
        current.overBudgetCount += item.overBudget ? 1 : 0;
        current.maxValue = Math.max(current.maxValue, item.value);
        groups.set(key, current);
    });

    const groupRows = Array.from(groups.values())
        .map((group) => ({
            ...group,
            p50Value: percentile(group.values, 50),
            p95Value: percentile(group.values, 95),
            p50Ms: group.unit === 'ms' ? percentile(group.values, 50) : null,
            p95Ms: group.unit === 'ms' ? percentile(group.values, 95) : null,
            maxMs: group.unit === 'ms' ? group.maxValue : null
        }))
        .sort((a, b) => (
            b.overBudgetCount - a.overBudgetCount
            || (b.budgetValue ? b.p95Value / b.budgetValue : 0) - (a.budgetValue ? a.p95Value / a.budgetValue : 0)
            || b.count - a.count
        ))
        .slice(0, groupLimit);

    return {
        count: performanceEvents.length,
        durationCount: durationEvents.length,
        p50Ms: percentile(durations, 50),
        p95Ms: percentile(durations, 95),
        maxMs: durations.length ? Math.max(...durations) : 0,
        budgetedCount: budgetedEvents.length,
        withinBudgetCount: budgetedEvents.filter((item) => !item.overBudget).length,
        overBudgetCount: budgetedEvents.filter((item) => item.overBudget).length,
        unbudgetedCount: performanceEvents.length - budgetedEvents.length,
        groups: groupRows,
        overBudgetEvents
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
    const budgetMs = Number(options.budgetMs || options.slowThresholdMs || TRACKED_WORKFLOW_LOAD_BUDGET_MS);

    getTelemetryPerformanceEvents(events)
        .filter((item) => item.name === 'app_ux_timing' && labelSet.has(item.label))
        .forEach((item) => {
            const row = rowsByLabel.get(item.label);
            if (!row) return;
            row.count += 1;
            row.durations.push(item.durationMs);
            if (item.route) row.routes.add(item.route);
            row.maxMs = Math.max(row.maxMs, item.durationMs);
            row.slowCount += item.durationMs > budgetMs ? 1 : 0;
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
            budgetMs,
            route: Array.from(row.routes).slice(0, 3).join(', '),
            latestAt: row.latestAt
        };
    });
}
