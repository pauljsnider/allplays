import { readPremiumAccessConfig } from './premium-access.js?v=1';
import { resolvePremiumAccess } from './premium-access-core.js?v=1';
import {
    TEAM_PASS_TIER,
    buildTeamEntitlementId,
    canAccessPremiumFanFeature,
    isRecordedReplayTeamPassGateEnabled,
    isTeamEntitlementActive,
    resolveTeamEntitlementSeasonId,
    TEAM_PASS_FEATURES
} from './team-entitlements-core.js?v=3';

export {
    TEAM_PASS_TIER,
    TEAM_PASS_FEATURES,
    buildTeamEntitlementId,
    canAccessPremiumFanFeature,
    isRecordedReplayTeamPassGateEnabled,
    isTeamEntitlementActive,
    resolveTeamEntitlementSeasonId
};

async function loadFirebase(deps = {}) {
    if (deps.firebase) return deps.firebase;
    return import('./firebase.js?v=22');
}

export async function getTeamEntitlementStatus({
    teamId,
    seasonId,
    tier = TEAM_PASS_TIER,
    deps = {},
    configReader = readPremiumAccessConfig
} = {}) {
    if (!teamId || !seasonId) {
        return { active: false, reason: 'missing-team-or-season', seasonId, tier };
    }

    const config = await configReader({ deps });
    const globalAccess = resolvePremiumAccess({
        feature: TEAM_PASS_FEATURES.RECORDED_REPLAY,
        config
    });
    if (globalAccess.state !== 'locked') {
        return {
            active: globalAccess.state === 'unlocked',
            reason: globalAccess.reason,
            seasonId,
            tier,
            entitlement: null,
            access: globalAccess
        };
    }

    try {
        const firebase = await loadFirebase(deps);
        const callableFactory = firebase.httpsCallable;
        const functionsInstance = firebase.functions;
        const readStatus = callableFactory(functionsInstance, 'getPublicTeamPassStatus');
        const response = await readStatus({ teamId, seasonId, tier });
        const payload = response?.data || response || {};
        const active = payload.active === true;
        const entitlement = active ? { teamId, seasonId, tier, status: 'active' } : null;
        const access = resolvePremiumAccess({
            feature: TEAM_PASS_FEATURES.RECORDED_REPLAY,
            config,
            entitlement: active
                ? { state: 'unlocked', reason: 'valid-team-entitlement' }
                : { state: 'locked', reason: payload.reason || 'missing-valid-team-entitlement' }
        });

        return {
            active,
            reason: active ? 'active' : payload.reason || 'not-active',
            seasonId,
            tier,
            entitlement,
            access
        };
    } catch (error) {
        console.error('Unable to read public Team Pass status:', error);
        const access = { state: 'unavailable', reason: 'team-entitlement-read-failed', feature: TEAM_PASS_FEATURES.RECORDED_REPLAY };
        return { active: false, reason: access.reason, seasonId, tier, entitlement: null, access };
    }
}
