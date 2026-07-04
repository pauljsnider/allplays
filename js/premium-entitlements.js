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

export function isValidPremiumEntitlementRecord(data, { scope, teamId = '', userId = '', currentSeasonId = '', now = new Date() } = {}) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    if (normalizeStatus(data.status) !== 'active') return false;
    if (data.revoked === true || data.isRevoked === true || data.deleted === true) return false;

    const revokedAt = normalizeDateValue(data.revokedAt);
    if (revokedAt) return false;

    const expiryDate = getExpiryDate(data);
    if (expiryDate === undefined) return false;
    if (expiryDate && expiryDate <= now) return false;

    if (scope === 'team') {
        const entitlementTeamId = normalizeString(data.teamId);
        if (entitlementTeamId && entitlementTeamId !== teamId) return false;
        const tier = normalizeString(data.tier);
        if (tier && tier !== 'team-pass') return false;
        const entitlementSeasonId = normalizeString(data.seasonId);
        const requiredSeasonId = normalizeString(currentSeasonId) || getDefaultSeasonId(now);
        if (!entitlementSeasonId || entitlementSeasonId !== requiredSeasonId) return false;
        return true;
    }

    if (scope === 'account') {
        const entitlementUserId = normalizeString(data.userId || data.accountUserId || data.uid || data.purchasedByUid);
        if (entitlementUserId && entitlementUserId !== userId) return false;
        return true;
    }

    return false;
}

async function loadFirebase(deps = {}) {
    if (deps.firebase) return deps.firebase;
    return import('./firebase.js?v=20');
}

function dataFromSnapshot(docSnap) {
    return typeof docSnap?.data === 'function' ? docSnap.data() : null;
}

export async function readTeamPremiumEntitlement({ teamId, user, teamAccessInfo, currentSeasonId = '', deps = {} } = {}) {
    if (!teamId || !user?.uid || !teamAccessInfo?.hasAccess) {
        return { state: 'locked', reason: 'missing-linked-team-access' };
    }

    try {
        const { db, collection, getDocs } = await loadFirebase(deps);
        const snapshot = await getDocs(collection(db, `teams/${teamId}/entitlements`));
        const hasValidEntitlement = snapshot.docs.some((docSnap) => isValidPremiumEntitlementRecord(
            dataFromSnapshot(docSnap),
            { scope: 'team', teamId, currentSeasonId }
        ));
        return hasValidEntitlement
            ? { state: 'unlocked', reason: 'valid-team-entitlement' }
            : { state: 'locked', reason: 'missing-valid-team-entitlement' };
    } catch (error) {
        console.error('Unable to read team premium entitlement:', error);
        return { state: 'unavailable', reason: 'team-entitlement-read-failed' };
    }
}

export async function readAccountPremiumEntitlement({ user, deps = {} } = {}) {
    if (!user?.uid) {
        return { state: 'locked', reason: 'missing-user' };
    }

    try {
        const { db, collection, getDocs } = await loadFirebase(deps);
        const snapshot = await getDocs(collection(db, `users/${user.uid}/entitlements`));
        const hasValidEntitlement = snapshot.docs.some((docSnap) => isValidPremiumEntitlementRecord(
            dataFromSnapshot(docSnap),
            { scope: 'account', userId: user.uid }
        ));
        return hasValidEntitlement
            ? { state: 'unlocked', reason: 'valid-account-entitlement' }
            : { state: 'locked', reason: 'missing-valid-account-entitlement' };
    } catch (error) {
        console.error('Unable to read account premium entitlement:', error);
        return { state: 'unavailable', reason: 'account-entitlement-read-failed' };
    }
}

export function renderPremiumGateState(container, { state, scope = 'team' } = {}) {
    if (!container || state === 'unlocked') return false;

    const isUnavailable = state === 'unavailable';
    const title = isUnavailable ? 'Premium unavailable' : 'Premium preview locked';
    const noun = scope === 'account' ? 'player analytics' : 'team analytics';
    const message = isUnavailable
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
