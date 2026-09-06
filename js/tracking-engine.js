const LEGACY_TRACKING_ENGINE_ALIASES = new Set([
    'legacy',
    'legacy-v1',
    'classic',
    'standard'
]);

export function isLegacyTrackingEngine(value) {
    return value === null
        || value === undefined
        || value === ''
        || (typeof value === 'string' && LEGACY_TRACKING_ENGINE_ALIASES.has(value));
}
