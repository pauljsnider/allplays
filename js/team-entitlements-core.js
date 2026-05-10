export const TEAM_PASS_TIER = 'team-pass';
export const TEAM_PASS_FEATURES = Object.freeze({
    RECORDED_REPLAY: 'recorded-replay'
});

function firstBoolean(values) {
    return values.find(value => typeof value === 'boolean');
}

export function isRecordedReplayTeamPassGateEnabled({ game = {}, team = {} } = {}) {
    const gameOverride = firstBoolean([
        game.teamPassConfig?.recordedReplayPaywallEnabled,
        game.teamPass?.recordedReplayPaywallEnabled,
        game.premiumFeatures?.recordedReplayPaywallEnabled,
        game.recordedReplayPaywallEnabled,
        game.recordedReplayTeamPassRequired
    ]);
    if (typeof gameOverride === 'boolean') return gameOverride;

    return firstBoolean([
        team.teamPassConfig?.recordedReplayPaywallEnabled,
        team.teamPass?.recordedReplayPaywallEnabled,
        team.premiumFeatures?.recordedReplayPaywallEnabled,
        team.recordedReplayPaywallEnabled,
        team.recordedReplayTeamPassRequired
    ]) === true;
}

export function resolveTeamEntitlementSeasonId({ game = {}, team = {}, fallbackDate = new Date() } = {}) {
    const explicitSeason = game.seasonId || game.season || team.currentSeasonId || team.seasonId || team.season;
    if (explicitSeason) return String(explicitSeason).trim();

    const dateValue = game.date || game.startTime || game.scheduledAt || fallbackDate;
    const parsedDate = typeof dateValue?.toDate === 'function'
        ? dateValue.toDate()
        : new Date(dateValue);
    if (!Number.isNaN(parsedDate.getTime())) {
        return String(parsedDate.getUTCFullYear());
    }

    return String(new Date(fallbackDate).getUTCFullYear());
}

export function buildTeamEntitlementId(seasonId, tier = TEAM_PASS_TIER) {
    return `${String(seasonId || '').trim()}_${tier}`;
}

function getTimestampMs(value) {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
}

export function isTeamEntitlementActive(entitlement, { seasonId, tier = TEAM_PASS_TIER, now = new Date() } = {}) {
    if (!entitlement) return false;
    if (seasonId && String(entitlement.seasonId || '') !== String(seasonId)) return false;
    if (tier && entitlement.tier && entitlement.tier !== tier) return false;
    if (entitlement.status && entitlement.status !== 'active') return false;
    if (entitlement.active === false || entitlement.isActive === false) return false;

    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const startsAtMs = getTimestampMs(entitlement.startsAt || entitlement.activeFrom);
    const expiresAtMs = getTimestampMs(entitlement.expiresAt || entitlement.activeUntil || entitlement.endsAt);
    if (Number.isFinite(startsAtMs) && startsAtMs > nowMs) return false;
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) return false;

    return true;
}

export function canAccessPremiumFanFeature(featureKey, entitlementStatus = {}) {
    return Boolean(featureKey && entitlementStatus.active);
}
