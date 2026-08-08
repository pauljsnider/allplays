export const DEFAULT_PREMIUM_OPEN_TO_ALL = true;

export const PREMIUM_ACCESS_CONFIG_PATH = Object.freeze(['platformConfig', 'premium']);

export const PREMIUM_FEATURES = Object.freeze({
    PLAYER_ANALYTICS: 'player-analytics',
    TEAM_ANALYTICS: 'team-analytics',
    RECORDED_REPLAY: 'recorded-replay',
    FAMILY_PLAN: 'family-plan'
});

export const PREMIUM_SCOPES = Object.freeze({
    ACCOUNT: 'account',
    TEAM: 'team'
});

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatus(value) {
    return normalizeString(value).toLowerCase();
}

function normalizeDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
    if (typeof value.toDate === 'function') {
        const date = value.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : undefined;
    }
    if (typeof value.seconds === 'number') {
        const date = new Date(value.seconds * 1000);
        return Number.isNaN(date.getTime()) ? undefined : date;
    }
    if (typeof value === 'number' || typeof value === 'string') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date;
    }
    return undefined;
}

function getExpiryDate(data) {
    if (!data || typeof data !== 'object') return null;
    const expiryFields = ['expiresAt', 'validUntil', 'endsAt', 'endAt'];
    for (const field of expiryFields) {
        if (Object.prototype.hasOwnProperty.call(data, field)) {
            return normalizeDateValue(data[field]);
        }
    }
    return null;
}

function getDefaultSeasonId(now) {
    const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    return String(date.getUTCFullYear());
}

export function normalizePremiumAccessConfig(data, { exists = true } = {}) {
    if (!exists) {
        return {
            state: 'ready',
            openToAll: DEFAULT_PREMIUM_OPEN_TO_ALL,
            reason: 'default-open'
        };
    }

    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.openToAll !== 'boolean') {
        return {
            state: 'unavailable',
            openToAll: false,
            reason: 'invalid-global-config'
        };
    }

    return {
        state: 'ready',
        openToAll: data.openToAll,
        reason: data.openToAll ? 'global-open' : 'entitlement-required'
    };
}

export function resolvePremiumAccess({
    feature = '',
    normalAccess = true,
    config = { state: 'ready', openToAll: DEFAULT_PREMIUM_OPEN_TO_ALL, reason: 'default-open' },
    entitlement = { state: 'locked', reason: 'missing-valid-entitlement' }
} = {}) {
    if (!feature) {
        return { state: 'locked', reason: 'missing-feature', feature };
    }
    if (normalAccess !== true) {
        return { state: 'locked', reason: 'missing-resource-access', feature };
    }
    if (config?.state === 'loading') {
        return { state: 'loading', reason: 'global-config-loading', feature };
    }
    if (config?.state !== 'ready') {
        return { state: 'unavailable', reason: config?.reason || 'global-config-unavailable', feature };
    }
    if (config.openToAll === true) {
        return { state: 'unlocked', reason: config.reason === 'default-open' ? 'default-open' : 'global-open', feature };
    }
    if (entitlement?.state === 'unlocked' || entitlement?.active === true) {
        return { state: 'unlocked', reason: entitlement.reason || 'valid-entitlement', feature };
    }
    if (entitlement?.state === 'loading') {
        return { state: 'loading', reason: entitlement.reason || 'entitlement-loading', feature };
    }
    if (entitlement?.state === 'unavailable') {
        return { state: 'unavailable', reason: entitlement.reason || 'entitlement-unavailable', feature };
    }
    return { state: 'locked', reason: entitlement?.reason || 'missing-valid-entitlement', feature };
}

export function isPremiumAccessUnlocked(access) {
    return access?.state === 'unlocked';
}

export function isValidPremiumEntitlementRecord(data, { scope, teamId = '', userId = '', currentSeasonId = '', now = new Date() } = {}) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    if (normalizeStatus(data.status) !== 'active') return false;
    if (data.revoked === true || data.isRevoked === true || data.deleted === true) return false;

    const revokedAt = normalizeDateValue(data.revokedAt);
    if (revokedAt) return false;

    const expiryDate = getExpiryDate(data);
    if (expiryDate === undefined) return false;
    if (expiryDate && expiryDate <= now) return false;

    if (scope === PREMIUM_SCOPES.TEAM) {
        const entitlementTeamId = normalizeString(data.teamId);
        if (entitlementTeamId && entitlementTeamId !== teamId) return false;
        const tier = normalizeString(data.tier);
        if (tier && tier !== 'team-pass') return false;
        const entitlementSeasonId = normalizeString(data.seasonId);
        const requiredSeasonId = normalizeString(currentSeasonId) || getDefaultSeasonId(now);
        return Boolean(entitlementSeasonId && entitlementSeasonId === requiredSeasonId);
    }

    if (scope === PREMIUM_SCOPES.ACCOUNT) {
        const entitlementUserId = normalizeString(data.userId || data.accountUserId || data.uid || data.purchasedByUid);
        return !entitlementUserId || entitlementUserId === userId;
    }

    return false;
}
