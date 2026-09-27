import { getPrimaryAppCheckHeaders } from './firebase-app-check-rest.js?v=1';

function decodeFirestoreValue(value) {
    if (!value || typeof value !== 'object') return null;
    if ('stringValue' in value) return value.stringValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) return Number(value.integerValue || 0);
    if ('doubleValue' in value) return Number(value.doubleValue || 0);
    if ('timestampValue' in value) return new Date(value.timestampValue);
    if ('nullValue' in value) return null;
    if ('arrayValue' in value) {
        return (value.arrayValue?.values || []).map((entry) => decodeFirestoreValue(entry));
    }
    if ('mapValue' in value) {
        return decodeFirestoreFields(value.mapValue?.fields || {});
    }
    return null;
}

function decodeFirestoreFields(fields = {}) {
    return Object.keys(fields).reduce((profile, key) => {
        profile[key] = decodeFirestoreValue(fields[key]);
        return profile;
    }, {});
}

/**
 * Read the current user's complete profile over authenticated Firestore REST.
 * This is an equal-authority transport fallback for a stalled WebChannel read;
 * a failed or partial response always rejects rather than becoming `{}`.
 */
export async function loadAuthProfileViaRest({ auth, user, timeoutMs = 5000, fetchImpl = globalThis.fetch }) {
    if (!user?.uid || typeof user.getIdToken !== 'function') {
        throw new Error('A signed-in Firebase user is required to load the profile.');
    }
    if (typeof fetchImpl !== 'function') {
        throw new Error('Profile REST transport is unavailable.');
    }

    const projectId = String(auth?.app?.options?.projectId || '').trim();
    if (!projectId) {
        throw new Error('Firebase project ID is missing.');
    }

    const token = await user.getIdToken();
    if (!token) {
        throw new Error('Firebase auth token is unavailable.');
    }

    const requestUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(user.uid)}`;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = globalThis.setTimeout(() => controller?.abort(), Math.max(1, Number(timeoutMs) || 5000));

    try {
        const response = await fetchImpl(requestUrl, {
            headers: await getPrimaryAppCheckHeaders({
                Authorization: `Bearer ${token}`
            }, requestUrl),
            ...(controller ? { signal: controller.signal } : {})
        });

        if (response.status === 404) return null;
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.name || !payload?.fields || typeof payload.fields !== 'object') {
            throw new Error(payload?.error?.message || `Profile request failed (${response.status}).`);
        }
        return decodeFirestoreFields(payload.fields);
    } finally {
        globalThis.clearTimeout(timeoutId);
    }
}
