const DEFAULT_TEXT_LIMIT = 80;
const DEFAULT_PROPERTY_LIMIT = 40;

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

export function sanitizeTelemetryProperties(properties = {}, depth = 0) {
    if (!properties || typeof properties !== 'object' || Array.isArray(properties) || depth > 2) {
        return {};
    }

    const clean = {};
    Object.entries(properties).slice(0, DEFAULT_PROPERTY_LIMIT).forEach(([key, value]) => {
        const cleanKey = sanitizeTelemetryKey(key);
        if (!cleanKey) return;

        if (value === null || value === undefined) {
            clean[cleanKey] = null;
        } else if (typeof value === 'boolean' || typeof value === 'number') {
            clean[cleanKey] = value;
        } else if (Array.isArray(value)) {
            clean[cleanKey] = value.slice(0, 10).map((item) => sanitizeTelemetryText(item, 60));
        } else if (typeof value === 'object') {
            clean[cleanKey] = sanitizeTelemetryProperties(value, depth + 1);
        } else {
            clean[cleanKey] = sanitizeTelemetryText(value, 160);
        }
    });
    return clean;
}
