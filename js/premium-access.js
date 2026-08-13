import {
    PREMIUM_ACCESS_CONFIG_PATH,
    normalizePremiumAccessConfig
} from './premium-access-core.js?v=1';

async function loadFirebase(deps = {}) {
    if (deps.firebase) return deps.firebase;
    return import('./firebase.js?v=25');
}

function snapshotToConfig(snapshot) {
    const exists = typeof snapshot?.exists === 'function' && snapshot.exists();
    return normalizePremiumAccessConfig(
        exists && typeof snapshot?.data === 'function' ? snapshot.data() : null,
        { exists }
    );
}

export async function readPremiumAccessConfig({ deps = {} } = {}) {
    try {
        const firebase = await loadFirebase(deps);
        const snapshot = await firebase.getDoc(firebase.doc(firebase.db, ...PREMIUM_ACCESS_CONFIG_PATH));
        if (snapshot?.metadata?.fromCache === true) {
            return {
                state: 'unavailable',
                openToAll: false,
                reason: 'global-config-server-unavailable'
            };
        }
        return snapshotToConfig(snapshot);
    } catch (error) {
        console.error('Unable to read global premium access config:', error);
        return {
            state: 'unavailable',
            openToAll: false,
            reason: 'global-config-read-failed'
        };
    }
}
