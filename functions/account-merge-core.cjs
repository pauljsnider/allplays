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
    if (record.destinationUid && record.destinationUid !== destinationUid) {
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

function uniqueStrings(values = []) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean))];
}

function parentLinkKey(link = {}) {
    return `${link.teamId || ''}::${link.playerId || ''}`;
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
    normalizeEmail,
    normalizeAccountMergePreviewInput,
    hashAccountMergeVerificationToken,
    validateAccountMergeVerificationRecord,
    assertNotSelfMerge,
    buildAccountMergePreview
};
