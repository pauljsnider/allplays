import {
    PREMIUM_FEATURES,
    PREMIUM_SCOPES,
    isValidPremiumEntitlementRecord,
    resolvePremiumAccess
} from './premium-access-core.js?v=1';
import { readPremiumAccessConfig } from './premium-access.js?v=3';

export { isValidPremiumEntitlementRecord } from './premium-access-core.js?v=1';

async function loadFirebase(deps = {}) {
    if (deps.firebase) return deps.firebase;
    return import('./firebase.js?v=25');
}

function dataFromSnapshot(docSnap) {
    return typeof docSnap?.data === 'function' ? docSnap.data() : null;
}

export async function readTeamEntitlementState({ teamId, user, teamAccessInfo, currentSeasonId = '', deps = {} } = {}) {
    if (!teamId || !user?.uid || !teamAccessInfo?.hasAccess) {
        return { state: 'locked', reason: 'missing-linked-team-access' };
    }

    try {
        const { db, collection, getDocs } = await loadFirebase(deps);
        const snapshot = await getDocs(collection(db, `teams/${teamId}/entitlements`));
        const hasValidEntitlement = snapshot.docs.some((docSnap) => isValidPremiumEntitlementRecord(
            dataFromSnapshot(docSnap),
            { scope: PREMIUM_SCOPES.TEAM, teamId, currentSeasonId }
        ));
        return hasValidEntitlement
            ? { state: 'unlocked', reason: 'valid-team-entitlement' }
            : { state: 'locked', reason: 'missing-valid-team-entitlement' };
    } catch (error) {
        console.error('Unable to read team premium entitlement:', error);
        return { state: 'unavailable', reason: 'team-entitlement-read-failed' };
    }
}

export async function readAccountEntitlementState({ user, deps = {} } = {}) {
    if (!user?.uid) {
        return { state: 'locked', reason: 'missing-user' };
    }

    try {
        const { db, collection, getDocs } = await loadFirebase(deps);
        const snapshot = await getDocs(collection(db, `users/${user.uid}/entitlements`));
        const hasValidEntitlement = snapshot.docs.some((docSnap) => isValidPremiumEntitlementRecord(
            dataFromSnapshot(docSnap),
            { scope: PREMIUM_SCOPES.ACCOUNT, userId: user.uid }
        ));
        return hasValidEntitlement
            ? { state: 'unlocked', reason: 'valid-account-entitlement' }
            : { state: 'locked', reason: 'missing-valid-account-entitlement' };
    } catch (error) {
        console.error('Unable to read account premium entitlement:', error);
        return { state: 'unavailable', reason: 'account-entitlement-read-failed' };
    }
}

export async function readTeamPremiumEntitlement({
    teamId,
    user,
    teamAccessInfo,
    normalAccess = Boolean(teamId && user?.uid && teamAccessInfo?.hasAccess),
    currentSeasonId = '',
    feature = PREMIUM_FEATURES.TEAM_ANALYTICS,
    deps = {},
    configReader = readPremiumAccessConfig
} = {}) {
    const authorized = normalAccess === true && Boolean(teamId && user?.uid && teamAccessInfo?.hasAccess);
    if (!authorized) return resolvePremiumAccess({ feature, normalAccess: false });

    const config = await configReader({ deps });
    const configAccess = resolvePremiumAccess({ feature, normalAccess: authorized, config });
    if (configAccess.state !== 'locked') return configAccess;

    const entitlement = await readTeamEntitlementState({ teamId, user, teamAccessInfo, currentSeasonId, deps });
    return resolvePremiumAccess({ feature, normalAccess: authorized, config, entitlement });
}

export async function readAccountPremiumEntitlement({
    user,
    normalAccess = Boolean(user?.uid),
    feature = PREMIUM_FEATURES.PLAYER_ANALYTICS,
    deps = {},
    configReader = readPremiumAccessConfig
} = {}) {
    const authorized = normalAccess === true && Boolean(user?.uid);
    if (!authorized) return resolvePremiumAccess({ feature, normalAccess: false });

    const config = await configReader({ deps });
    const configAccess = resolvePremiumAccess({ feature, normalAccess: authorized, config });
    if (configAccess.state !== 'locked') return configAccess;

    const entitlement = await readAccountEntitlementState({ user, deps });
    return resolvePremiumAccess({ feature, normalAccess: authorized, config, entitlement });
}

export function renderPremiumGateState(container, { state, scope = 'team', feature = '' } = {}) {
    if (!container || state === 'unlocked') return false;

    const isUnavailable = state === 'unavailable' || state === 'loading';
    const title = state === 'loading' ? 'Checking premium access' : isUnavailable ? 'Premium unavailable' : 'Premium preview locked';
    const noun = feature === PREMIUM_FEATURES.FAMILY_PLAN
        ? 'parent and caregiver invitations'
        : scope === PREMIUM_SCOPES.ACCOUNT ? 'player analytics' : 'team analytics';
    const message = state === 'loading'
        ? `We are checking premium access for ${noun}.`
        : isUnavailable
            ? `We could not verify premium access for ${noun} right now. Try again later.`
            : `Premium access is required to unlock ${noun}. This preview stays visible so you know what is available when access is active.`;
    const accentClass = isUnavailable ? 'from-gray-400 to-gray-500' : 'from-amber-400 to-amber-500';

    container.innerHTML = `
        <div class="text-center py-12 px-6 bg-white rounded-xl border border-dashed border-gray-300">
            <div class="mx-auto mb-4 w-14 h-14 rounded-full bg-gradient-to-r ${accentClass} text-white flex items-center justify-center shadow-lg">
                <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                </svg>
            </div>
            <p class="text-gray-900 text-lg font-bold mb-2">${title}</p>
            <p class="text-gray-500 text-sm max-w-md mx-auto">${message}</p>
        </div>
    `;
    return true;
}
