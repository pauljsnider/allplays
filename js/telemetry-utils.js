const DEFAULT_TEXT_LIMIT = 80;
const DEFAULT_PROPERTY_LIMIT = 40;
const REDACTED_TEXT = '[redacted-text]';
const REDACTED_IDENTIFIER = '[id]';

// These keys describe code-defined operations, never user-authored content. New
// string fields are redacted by default so adding telemetry cannot silently
// expand the data collected from a form, chat, roster, or profile.
const SAFE_CANONICAL_TEXT_KEYS = new Set([
    'action', 'actionKind', 'appVersion', 'boundaryName', 'browser', 'category',
    'channel', 'completedPage', 'component', 'deviceClass', 'elementType', 'environment',
    'errorName', 'errorType', 'eventType', 'formType', 'kind', 'label',
    'language', 'loadName', 'method', 'metric', 'name', 'navigationType', 'operation',
    'outcome', 'platform', 'reasonCode', 'release', 'role', 'scope', 'source',
    'sourcePage', 'stage', 'status', 'tagName', 'targetPage', 'telemetryName',
    'trigger', 'type', 'version', 'viewName', 'visibilityState', 'workflowName',
    'expectedTargetPage'
]);
const ROUTE_PROPERTY_KEYS = new Set([
    'action', 'appRoute', 'completedRoute', 'href', 'location', 'pagePath', 'route',
    'sourceRoute', 'targetRoute', 'expectedTargetRoute'
]);
const SENSITIVE_KEY_PATTERN = /(?:address|authorization|body|chat|comment|content|cookie|credential|description|email|first.?name|last.?name|message|note|password|phone|secret|text|token)/i;
const COORDINATE_KEY_PATTERN = /^(?:(?:client|offset|page|screen|target)[xy](?:percent)?|[xy])$/i;
const IDENTIFIER_KEY_PATTERN = /(?:^|_)(?:account|athlete|child|conversation|document|event|family|game|guardian|household|invite|organization|parent|player|registration|session|team|user|visitor)(?:_?id|_?ids|_?key|_?keys)?$/i;
const DYNAMIC_ROUTE_PARENT_SEGMENTS = new Set([
    'accept-invite', 'athletes', 'calendar', 'capabilities', 'conversations', 'events',
    'families', 'family', 'fees', 'games', 'inquiries', 'invite', 'messages',
    'opportunities', 'organizations', 'people', 'players', 'registrations', 'rsvp',
    'schedules', 'share', 'team', 'teams', 'users'
]);

export function sanitizeTelemetryText(value, maxLength = DEFAULT_TEXT_LIMIT) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/\s+/g, ' ')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[phone]')
        .replace(/\b\d{5,}\b/g, '[number]')
        .replace(/\b[A-Za-z0-9_-]{18,}\b/g, '[token]')
        .trim()
        .slice(0, maxLength);
}

export function sanitizeTelemetryKey(value, maxLength = 60) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
        .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '')
        .replace(/\s+/g, '_')
        .replace(/[^\w:-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, maxLength);
}

export function sanitizeTelemetryRoute(value, maxLength = 220) {
    const rawPath = String(value || '/').split('?')[0].split('#')[0] || '/';
    const segments = rawPath.split('/').filter(Boolean);
    const safeSegments = segments.map((segment, index) => {
        let decoded = segment;
        try {
            decoded = decodeURIComponent(segment);
        } catch (_error) {
            // A malformed path is still handled as opaque input below.
        }

        const previous = sanitizeTelemetryKey(segments[index - 1] || '', 48).toLowerCase();
        const looksDynamic = DYNAMIC_ROUTE_PARENT_SEGMENTS.has(previous)
            || /^\d+$/.test(decoded)
            || /^(?:team|player|game|user|event|org|registration|conversation)[-_]/i.test(decoded)
            || /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]{6,}$/.test(decoded)
            || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(decoded)
            || /^[A-Za-z0-9_-]{16,}$/.test(decoded);
        if (looksDynamic) return ':id';

        const clean = sanitizeTelemetryKey(decoded, 48).toLowerCase();
        return clean || ':redacted';
    });
    return (`/${safeSegments.join('/')}` || '/').slice(0, maxLength);
}

function sanitizePropertyValue(key, value, depth) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return value;

    if (SENSITIVE_KEY_PATTERN.test(key) || COORDINATE_KEY_PATTERN.test(key)) return REDACTED_TEXT;
    if (IDENTIFIER_KEY_PATTERN.test(key) || /(?:Id|Ids|Key|Keys)$/.test(key)) return REDACTED_IDENTIFIER;
    if (ROUTE_PROPERTY_KEYS.has(key)) return sanitizeTelemetryRoute(value);

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (Array.isArray(value)) {
        return value.slice(0, 10).map((item) => {
            if (typeof item === 'boolean' || typeof item === 'number') return item;
            return SAFE_CANONICAL_TEXT_KEYS.has(key)
                ? sanitizeTelemetryText(item, 60)
                : REDACTED_TEXT;
        });
    }

    if (typeof value === 'object') {
        return sanitizeTelemetryProperties(value, depth + 1);
    }

    if (!SAFE_CANONICAL_TEXT_KEYS.has(key)) return REDACTED_TEXT;
    return sanitizeTelemetryText(value, 120);
}

export function sanitizeTelemetryProperties(properties = {}, depth = 0) {
    if (!properties || typeof properties !== 'object' || Array.isArray(properties) || depth > 2) {
        return {};
    }

    const clean = {};
    Object.entries(properties).slice(0, DEFAULT_PROPERTY_LIMIT).forEach(([key, value]) => {
        const cleanKey = sanitizeTelemetryKey(key);
        if (!cleanKey) return;
        clean[cleanKey] = sanitizePropertyValue(cleanKey, value, depth);
    });
    return clean;
}

export { REDACTED_IDENTIFIER, REDACTED_TEXT };
