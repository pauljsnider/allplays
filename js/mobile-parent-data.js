import { auth } from './firebase.js?v=13';

function withTimeout(promise, label, timeoutMs) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
            reject(new Error(`${label} timed out.`));
        }, timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => {
        window.clearTimeout(timeoutId);
    });
}

function decodeFirestoreValue(value) {
    if (!value || typeof value !== 'object') return null;
    if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
    if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue);
    if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return Number(value.doubleValue);
    if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return Boolean(value.booleanValue);
    if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return value.timestampValue;
    if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
    if (Object.prototype.hasOwnProperty.call(value, 'arrayValue')) {
        return (value.arrayValue.values || []).map(decodeFirestoreValue);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'mapValue')) {
        return decodeFirestoreFields(value.mapValue.fields || {});
    }
    return null;
}

export function decodeFirestoreFields(fields = {}) {
    return Object.entries(fields).reduce((acc, [key, value]) => {
        acc[key] = decodeFirestoreValue(value);
        return acc;
    }, {});
}

function encodeFirestoreValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (value instanceof Date) return { timestampValue: value.toISOString() };
    if (Array.isArray(value)) {
        return { arrayValue: { values: value.map(encodeFirestoreValue) } };
    }
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
        return Number.isInteger(value) ? { integerValue: value } : { doubleValue: value };
    }
    if (typeof value === 'object') {
        return {
            mapValue: {
                fields: Object.entries(value).reduce((acc, [key, childValue]) => {
                    acc[key] = encodeFirestoreValue(childValue);
                    return acc;
                }, {})
            }
        };
    }
    return { stringValue: String(value) };
}

function encodeFirestoreFields(data = {}) {
    return Object.entries(data).reduce((acc, [key, value]) => {
        acc[key] = encodeFirestoreValue(value);
        return acc;
    }, {});
}

function getFirestoreRestDocumentUrl(path) {
    const projectId = auth.app?.options?.projectId;
    if (!projectId) throw new Error('Firebase project ID is missing.');
    return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${path}`;
}

async function getMobileAuthHeaders(user) {
    if (!user || typeof user.getIdToken !== 'function') {
        throw new Error('Mobile auth token is unavailable.');
    }
    return {
        Authorization: `Bearer ${await user.getIdToken()}`,
        'Content-Type': 'application/json'
    };
}

export async function readUserProfileViaRest(user, { timeoutMs = 5000 } = {}) {
    const projectId = auth.app?.options?.projectId;
    if (!projectId || !user?.uid || typeof user.getIdToken !== 'function') {
        throw new Error('Firebase REST profile fallback is unavailable.');
    }

    const token = await user.getIdToken();
    const response = await withTimeout(fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(user.uid)}`, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    }), 'Profile REST request', timeoutMs);

    if (response.status === 404) return null;
    if (!response.ok) {
        throw new Error(`Profile REST request failed (${response.status}).`);
    }

    const payload = await response.json();
    return decodeFirestoreFields(payload.fields || {});
}

export function normalizeMobileParentChildren(parentOf = []) {
    if (!Array.isArray(parentOf)) return [];
    return parentOf
        .map((child) => {
            const teamId = child?.teamId || '';
            const playerId = child?.playerId || child?.id || '';
            if (!teamId || !playerId) return null;
            return {
                ...child,
                teamId,
                playerId,
                playerName: child.playerName || child.name || 'Player',
                teamName: child.teamName || child.team || 'Team',
                playerPhotoUrl: child.playerPhotoUrl || child.photoUrl || ''
            };
        })
        .filter(Boolean);
}

export function buildMobileTeamSummaries(children = []) {
    const teamsById = new Map();
    (children || []).forEach((child) => {
        if (!child?.teamId) return;
        if (!teamsById.has(child.teamId)) {
            teamsById.set(child.teamId, {
                teamId: child.teamId,
                teamName: child.teamName || 'Team',
                playerNames: []
            });
        }
        if (child.playerName) {
            teamsById.get(child.teamId).playerNames.push(child.playerName);
        }
    });

    return Array.from(teamsById.values())
        .sort((a, b) => a.teamName.localeCompare(b.teamName));
}

export function getMobileParentScope(profile = {}) {
    const parentOf = Array.isArray(profile?.parentOf) ? profile.parentOf : [];
    const parentTeamIds = [...new Set(parentOf.map((link) => link?.teamId).filter(Boolean))].sort();
    const parentPlayerKeys = [...new Set(parentOf
        .map((link) => (link?.teamId && link?.playerId ? `${link.teamId}::${link.playerId}` : null))
        .filter(Boolean))].sort();

    return { parentTeamIds, parentPlayerKeys };
}

export async function syncMobileParentScope(user, profile = {}, { timeoutMs = 5000 } = {}) {
    if (!user?.uid) return profile || {};

    const expected = getMobileParentScope(profile);
    const currentTeamIds = Array.isArray(profile?.parentTeamIds) ? profile.parentTeamIds.slice().sort() : [];
    const currentPlayerKeys = Array.isArray(profile?.parentPlayerKeys) ? profile.parentPlayerKeys.slice().sort() : [];
    const teamIdsMatch = JSON.stringify(expected.parentTeamIds) === JSON.stringify(currentTeamIds);
    const playerKeysMatch = JSON.stringify(expected.parentPlayerKeys) === JSON.stringify(currentPlayerKeys);

    if (teamIdsMatch && playerKeysMatch) return profile || {};

    const searchParams = new URLSearchParams();
    searchParams.append('updateMask.fieldPaths', 'parentTeamIds');
    searchParams.append('updateMask.fieldPaths', 'parentPlayerKeys');
    searchParams.append('updateMask.fieldPaths', 'updatedAt');

    const response = await withTimeout(fetch(`${getFirestoreRestDocumentUrl(`users/${encodeURIComponent(user.uid)}`)}?${searchParams.toString()}`, {
        method: 'PATCH',
        headers: await getMobileAuthHeaders(user),
        body: JSON.stringify({
            fields: encodeFirestoreFields({
                parentTeamIds: expected.parentTeamIds,
                parentPlayerKeys: expected.parentPlayerKeys,
                updatedAt: new Date()
            })
        })
    }), 'Parent scope REST update', timeoutMs);

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error?.message || `Parent scope REST update failed (${response.status}).`);
    }

    return {
        ...(profile || {}),
        ...expected
    };
}

export async function loadMobileParentProfile(user, { getUserProfile, timeoutMs = 5000 } = {}) {
    if (user?.isNativeRestSession) {
        return readUserProfileViaRest(user, { timeoutMs });
    }

    if (typeof getUserProfile !== 'function') {
        return readUserProfileViaRest(user, { timeoutMs });
    }

    try {
        return await withTimeout(getUserProfile(user.uid), 'Profile', timeoutMs);
    } catch (error) {
        console.warn('[mobile-parent-data] Firestore profile read failed in app mode, trying REST fallback:', error);
        return readUserProfileViaRest(user, { timeoutMs });
    }
}

export async function listMobileTeamChatMessages(user, teamId, { pageSize = 50, timeoutMs = 8000 } = {}) {
    if (!teamId) return [];

    const searchParams = new URLSearchParams({
        pageSize: String(pageSize),
        orderBy: 'createdAt desc'
    });
    const response = await withTimeout(fetch(`${getFirestoreRestDocumentUrl(`teams/${encodeURIComponent(teamId)}/chatMessages`)}?${searchParams.toString()}`, {
        headers: await getMobileAuthHeaders(user)
    }), 'Team chat REST list', timeoutMs);

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error?.message || `Team chat REST list failed (${response.status}).`);
    }

    const payload = await response.json();
    return (payload.documents || [])
        .map((doc) => ({
            id: String(doc.name || '').split('/').pop(),
            ...decodeFirestoreFields(doc.fields || {})
        }))
        .filter((message) => !message.deleted)
        .reverse();
}

export async function sendMobileTeamChatMessage(user, teamId, { text, senderName = '', senderPhotoUrl = '' } = {}, { timeoutMs = 8000 } = {}) {
    const trimmedText = String(text || '').trim();
    if (!teamId || !trimmedText) {
        throw new Error('Message text and team are required.');
    }

    const createdAt = new Date();
    const payload = {
        text: trimmedText,
        senderId: user.uid,
        senderName: senderName || user.email || 'Parent',
        senderEmail: user.email || null,
        senderPhotoUrl: senderPhotoUrl || null,
        attachments: [],
        imageUrl: null,
        imagePath: null,
        imageName: null,
        imageType: null,
        imageSize: null,
        createdAt,
        editedAt: null,
        deleted: false,
        ai: false,
        aiName: null,
        aiQuestion: null,
        aiMeta: null,
        targetType: 'full_team',
        recipientIds: [],
        targetRole: null,
        conversationId: null
    };

    const response = await withTimeout(fetch(getFirestoreRestDocumentUrl(`teams/${encodeURIComponent(teamId)}/chatMessages`), {
        method: 'POST',
        headers: await getMobileAuthHeaders(user),
        body: JSON.stringify({ fields: encodeFirestoreFields(payload) })
    }), 'Team chat REST send', timeoutMs);

    if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload?.error?.message || `Team chat REST send failed (${response.status}).`);
    }

    const doc = await response.json();
    return {
        id: String(doc.name || '').split('/').pop(),
        ...payload
    };
}
