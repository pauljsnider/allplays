function uniqueValues(...lists) {
    const seen = new Set();
    const values = [];
    lists.flat().forEach((value) => {
        if (value === undefined || value === null || value === '') return;
        const key = typeof value === 'string' ? value : JSON.stringify(value);
        if (seen.has(key)) return;
        seen.add(key);
        values.push(value);
    });
    return values;
}

function parentLinkKey(link = {}) {
    return `${String(link.teamId || '')}::${String(link.playerId || '')}`;
}

function mergeParentLinks(destinationLinks = [], sourceLinks = []) {
    const byKey = new Map();
    [...destinationLinks, ...sourceLinks].forEach((link) => {
        if (!link || typeof link !== 'object') return;
        const key = parentLinkKey(link);
        if (key === '::') return;
        byKey.set(key, { ...(byKey.get(key) || {}), ...link });
    });
    return [...byKey.values()];
}

function mergePreferenceValue(destinationValue, sourceValue) {
    if (Array.isArray(destinationValue) || Array.isArray(sourceValue)) {
        return uniqueValues(
            Array.isArray(destinationValue) ? destinationValue : [],
            Array.isArray(sourceValue) ? sourceValue : []
        );
    }
    if (destinationValue && sourceValue && typeof destinationValue === 'object' && typeof sourceValue === 'object') {
        return mergePreferenceObjects(destinationValue, sourceValue);
    }
    if (typeof destinationValue === 'boolean' || typeof sourceValue === 'boolean') {
        return Boolean(destinationValue) || Boolean(sourceValue);
    }
    return destinationValue !== undefined ? destinationValue : sourceValue;
}

function mergePreferenceObjects(destinationPrefs = {}, sourcePrefs = {}) {
    const merged = { ...(destinationPrefs || {}) };
    Object.entries(sourcePrefs || {}).forEach(([key, value]) => {
        merged[key] = mergePreferenceValue(merged[key], value);
    });
    return merged;
}

function buildMergedParentAccount(destination = {}, source = {}) {
    const parentOf = mergeParentLinks(destination.parentOf, source.parentOf);
    const derivedKeys = parentOf
        .map((link) => parentLinkKey(link))
        .filter((key) => key !== '::');
    const derivedTeamIds = parentOf
        .map((link) => link?.teamId)
        .filter(Boolean);

    const update = {
        parentOf,
        parentTeamIds: uniqueValues(destination.parentTeamIds || [], source.parentTeamIds || [], derivedTeamIds),
        parentPlayerKeys: uniqueValues(destination.parentPlayerKeys || [], source.parentPlayerKeys || [], derivedKeys),
        roles: uniqueValues(destination.roles || [], source.roles || [])
    };

    ['notificationPreferences', 'notificationSettings', 'preferences'].forEach((field) => {
        if (destination[field] !== undefined || source[field] !== undefined) {
            update[field] = mergePreferenceObjects(destination[field] || {}, source[field] || {});
        }
    });

    ['emailNotifications', 'smsNotifications', 'pushNotifications'].forEach((field) => {
        if (destination[field] !== undefined || source[field] !== undefined) {
            update[field] = mergePreferenceValue(destination[field], source[field]);
        }
    });

    return update;
}

function buildMergedPlayerParents(parents = [], sourceUid, destinationUid) {
    const byKey = new Map();
    let changed = false;

    parents.forEach((parent) => {
        if (!parent || typeof parent !== 'object') return;
        const nextParent = { ...parent };
        if (nextParent.userId === sourceUid) {
            nextParent.userId = destinationUid;
            changed = true;
        }
        const key = nextParent.userId || nextParent.email || JSON.stringify(nextParent);
        const existing = byKey.get(key) || {};
        byKey.set(key, { ...nextParent, ...existing, userId: nextParent.userId || existing.userId });
    });

    const merged = [...byKey.values()];
    if (merged.length !== parents.length) changed = true;
    return { parents: merged, changed };
}

function findDuplicateParentUserIds(parents = []) {
    const seen = new Set();
    const duplicates = new Set();

    (Array.isArray(parents) ? parents : []).forEach((parent) => {
        const userId = String(parent?.userId || '').trim();
        if (!userId) return;
        if (seen.has(userId)) {
            duplicates.add(userId);
            return;
        }
        seen.add(userId);
    });

    return [...duplicates];
}

function isVerifiedAccountMergeRequest(request = {}, { sourceUid, destinationUid, previewTokenHash } = {}) {
    if (!request || request.sourceUid !== sourceUid || request.destinationUid !== destinationUid) return false;
    if (request.verified === true || request.previewVerified === true || request.status === 'verified') return true;
    return Boolean(previewTokenHash && request.previewTokenHash === previewTokenHash);
}

module.exports = {
    buildMergedParentAccount,
    buildMergedPlayerParents,
    findDuplicateParentUserIds,
    isVerifiedAccountMergeRequest,
    mergePreferenceObjects,
    uniqueValues
};
