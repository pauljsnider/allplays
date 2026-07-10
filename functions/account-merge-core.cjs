const crypto = require('node:crypto');

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeAccountIdentifier(value, label) {
    const id = String(value || '').trim();
    if (!id || id.includes('/')) {
        throw new Error(`${label} is required.`);
    }
    return id;
}

function normalizeAccountMergePreviewInput(data = {}) {
    const sourceUid = data.sourceUid || data.sourceUserId
        ? normalizeAccountIdentifier(data.sourceUid || data.sourceUserId, 'sourceUid')
        : '';
    const sourceEmail = normalizeEmail(data.sourceEmail || data.email);
    const verificationToken = String(data.verificationToken || data.token || '').trim();

    if (!sourceUid && !sourceEmail && !verificationToken) {
        throw new Error('A source account identifier or verification token is required.');
    }
    if (sourceEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sourceEmail)) {
        throw new Error('A valid source email is required.');
    }

    return { sourceUid, sourceEmail, verificationToken };
}

function hashAccountMergeVerificationToken(token) {
    const rawToken = String(token || '').trim();
    if (!rawToken) {
        throw new Error('verificationToken is required.');
    }
    return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function requireAccountMergeVerificationToken(input = {}) {
    if (!String(input.verificationToken || '').trim()) {
        throw new Error('Verify ownership of the source account before previewing an account merge.');
    }
    return input.verificationToken;
}

function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    return 0;
}

function validateAccountMergeVerificationRecord({ record = {}, destinationUid, sourceUid, nowMs = Date.now() }) {
    if (record.status !== 'verified') {
        throw new Error('Account merge verification token is not verified.');
    }
    if (!record.destinationUid || record.destinationUid !== destinationUid) {
        throw new Error('Account merge verification token is for a different destination account.');
    }
    if (sourceUid && record.sourceUid && record.sourceUid !== sourceUid) {
        throw new Error('Account merge verification token is for a different source account.');
    }
    if (!record.sourceUid) {
        throw new Error('Account merge verification token has no source account.');
    }
    const expiresAtMs = toMillis(record.expiresAt);
    if (expiresAtMs && expiresAtMs <= nowMs) {
        throw new Error('Account merge verification token has expired.');
    }
    return record.sourceUid;
}

function assertNotSelfMerge({ destinationUid, destinationEmail, sourceUid, sourceEmail }) {
    if (sourceUid && destinationUid && sourceUid === destinationUid) {
        throw new Error('Source and destination accounts must be different.');
    }
    if (sourceEmail && destinationEmail && normalizeEmail(sourceEmail) === normalizeEmail(destinationEmail)) {
        throw new Error('Source and destination accounts must be different.');
    }
}

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

function uniqueStrings(values = []) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean))];
}

function parentLinkKey(link = {}) {
    return `${String(link.teamId || '')}::${String(link.playerId || '')}`;
}

function uniqueParentLinks(values = []) {
    const seen = new Set();
    const links = [];
    (Array.isArray(values) ? values : []).forEach((link) => {
        const key = parentLinkKey(link);
        if (key === '::' || seen.has(key)) return;
        seen.add(key);
        links.push({ ...link });
    });
    return links;
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

function accountSnapshot(uid, user = {}) {
    return {
        uid,
        email: normalizeEmail(user.email || user.profileEmail),
        parentOf: uniqueParentLinks(user.parentOf),
        parentTeamIds: uniqueStrings(user.parentTeamIds),
        parentPlayerKeys: uniqueStrings(user.parentPlayerKeys),
        roles: uniqueStrings(user.roles)
    };
}

function buildAccountMergePreview({ sourceUid, sourceUser = {}, destinationUid, destinationUser = {} }) {
    const source = accountSnapshot(sourceUid, sourceUser);
    const destination = accountSnapshot(destinationUid, destinationUser);
    assertNotSelfMerge({
        destinationUid,
        destinationEmail: destination.email,
        sourceUid,
        sourceEmail: source.email
    });

    const destinationParentKeys = new Set(destination.parentOf.map(parentLinkKey));
    const destinationTeamIds = new Set(destination.parentTeamIds);
    const destinationPlayerKeys = new Set(destination.parentPlayerKeys);
    const destinationRoles = new Set(destination.roles);

    const parentOfToAdd = source.parentOf.filter((link) => !destinationParentKeys.has(parentLinkKey(link)));
    const parentTeamIdsToAdd = source.parentTeamIds.filter((teamId) => !destinationTeamIds.has(teamId));
    const parentPlayerKeysToAdd = source.parentPlayerKeys.filter((playerKey) => !destinationPlayerKeys.has(playerKey));
    const rolesToAdd = source.roles.filter((role) => !destinationRoles.has(role));

    return {
        source,
        destination,
        additions: {
            parentOf: parentOfToAdd,
            parentTeamIds: parentTeamIdsToAdd,
            parentPlayerKeys: parentPlayerKeysToAdd,
            roles: rolesToAdd
        },
        unioned: {
            parentOf: uniqueParentLinks([...destination.parentOf, ...source.parentOf]),
            parentTeamIds: uniqueStrings([...destination.parentTeamIds, ...source.parentTeamIds]),
            parentPlayerKeys: uniqueStrings([...destination.parentPlayerKeys, ...source.parentPlayerKeys]),
            roles: uniqueStrings([...destination.roles, ...source.roles])
        },
        mutationPlanned: false
    };
}

module.exports = {
    assertNotSelfMerge,
    buildAccountMergePreview,
    buildMergedParentAccount,
    buildMergedPlayerParents,
    findDuplicateParentUserIds,
    hashAccountMergeVerificationToken,
    isVerifiedAccountMergeRequest,
    mergePreferenceObjects,
    normalizeAccountMergePreviewInput,
    normalizeEmail,
    requireAccountMergeVerificationToken,
    uniqueValues,
    validateAccountMergeVerificationRecord
};
