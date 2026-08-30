function normalizeDocumentId(value, maxLength = 128) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text && text.length <= maxLength && !text.includes('/') ? text : '';
}

export function normalizePublicGameResetIdentity(item = {}) {
    const resetEventId = normalizeDocumentId(item?.liveResetEventId);
    const resetAtMs = Date.parse(String(item?.liveResetAt || ''));
    if (!resetEventId || !Number.isFinite(resetAtMs)) return null;
    return { resetEventId, resetAtMs };
}

export async function loadPublicGameResetIdentity(teamId, gameId, {
    loadFirebase = () => import('./firebase.js?v=33')
} = {}) {
    const safeTeamId = normalizeDocumentId(teamId);
    const safeGameId = normalizeDocumentId(gameId, 1000);
    if (!safeTeamId || !safeGameId) throw new Error('Valid team and game IDs are required.');

    const firebase = await loadFirebase();
    if (!firebase?.functions || typeof firebase?.httpsCallable !== 'function') {
        throw new Error('Firebase Functions are unavailable.');
    }
    const callable = firebase.httpsCallable(firebase.functions, 'getPublicGameProjection');
    const response = await callable({ teamId: safeTeamId, gameId: safeGameId });
    return normalizePublicGameResetIdentity(response?.data?.item);
}
