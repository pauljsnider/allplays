import { db, doc, getDoc } from './firebase.js?v=21';
import {
    TEAM_PASS_TIER,
    buildTeamEntitlementId,
    canAccessPremiumFanFeature,
    isRecordedReplayTeamPassGateEnabled,
    isTeamEntitlementActive,
    resolveTeamEntitlementSeasonId,
    TEAM_PASS_FEATURES
} from './team-entitlements-core.js?v=2';

export {
    TEAM_PASS_TIER,
    TEAM_PASS_FEATURES,
    buildTeamEntitlementId,
    canAccessPremiumFanFeature,
    isRecordedReplayTeamPassGateEnabled,
    isTeamEntitlementActive,
    resolveTeamEntitlementSeasonId
};

export async function getTeamEntitlementStatus({ teamId, seasonId, tier = TEAM_PASS_TIER } = {}) {
    if (!teamId || !seasonId) {
        return { active: false, reason: 'missing-team-or-season', seasonId, tier };
    }

    const entitlementId = buildTeamEntitlementId(seasonId, tier);
    const snapshot = await getDoc(doc(db, 'teams', teamId, 'entitlements', entitlementId));
    const entitlement = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
    const active = isTeamEntitlementActive(entitlement, { seasonId, tier });

    return {
        active,
        reason: active ? 'active' : 'not-active',
        seasonId,
        tier,
        entitlement
    };
}
