export function buildParentMembershipRequestId(userId, playerId) {
    return `${String(userId || '').trim()}__${String(playerId || '').trim()}`;
}

function uniqueStrings(values) {
    return [...new Set((values || []).filter(Boolean).map((value) => String(value)))];
}

function normalizeParentScopeId(value) {
    if (typeof value !== 'string') return '';
    const normalized = value.trim();
    if (!normalized || normalized.length > 128 || normalized.includes('/')) return '';
    return normalized;
}

function parseParentPlayerKey(value) {
    if (typeof value !== 'string') return null;
    const parts = value.trim().split('::');
    if (parts.length !== 2) return null;
    const teamId = normalizeParentScopeId(parts[0]);
    const playerId = normalizeParentScopeId(parts[1]);
    return teamId && playerId ? { teamId, playerId, playerKey: `${teamId}::${playerId}` } : null;
}

export function resolveCanonicalParentScopeInput(profileOrLinks = []) {
    if (Array.isArray(profileOrLinks)) {
        return {
            parentLinks: profileOrLinks,
            parentTeamIds: [],
            parentPlayerKeys: [],
            hasCanonicalParentTeamIds: false,
            hasCanonicalParentPlayerKeys: false
        };
    }

    const profile = profileOrLinks && typeof profileOrLinks === 'object' ? profileOrLinks : {};
    const hasCanonicalParentTeamIds = Object.prototype.hasOwnProperty.call(profile, 'parentTeamIds');
    const hasCanonicalParentPlayerKeys = Object.prototype.hasOwnProperty.call(profile, 'parentPlayerKeys');
    const canonicalTeamIds = new Set(
        (hasCanonicalParentTeamIds && Array.isArray(profile.parentTeamIds) ? profile.parentTeamIds : [])
            .map(normalizeParentScopeId)
            .filter(Boolean)
    );
    const canonicalPlayerKeys = new Set(
        (hasCanonicalParentPlayerKeys && Array.isArray(profile.parentPlayerKeys) ? profile.parentPlayerKeys : [])
            .map(parseParentPlayerKey)
            .filter(Boolean)
            .map((parsed) => parsed.playerKey)
    );
    const effectiveCanonicalPlayerKeys = new Set(
        [...canonicalPlayerKeys].filter((playerKey) => {
            const parsed = parseParentPlayerKey(playerKey);
            return parsed && (!hasCanonicalParentTeamIds || canonicalTeamIds.has(parsed.teamId));
        })
    );
    const metadataByPlayerKey = new Map();
    (Array.isArray(profile.parentOf) ? profile.parentOf : []).forEach((link) => {
        const teamId = normalizeParentScopeId(link?.teamId);
        const playerId = normalizeParentScopeId(link?.playerId);
        if (!teamId || !playerId) return;
        const playerKey = `${teamId}::${playerId}`;
        if (!metadataByPlayerKey.has(playerKey)) metadataByPlayerKey.set(playerKey, link);
    });

    const parentLinks = [];
    if (hasCanonicalParentPlayerKeys) {
        effectiveCanonicalPlayerKeys.forEach((playerKey) => {
            const { teamId, playerId } = parseParentPlayerKey(playerKey);
            parentLinks.push(metadataByPlayerKey.get(playerKey) || { teamId, playerId });
        });
    } else if (!hasCanonicalParentTeamIds) {
        // parentOf is a legacy fallback only when neither canonical field has
        // ever been created. A team-only canonical profile does not prove
        // which individual players remain linked.
        metadataByPlayerKey.forEach((link) => {
            parentLinks.push(link);
        });
    }

    return {
        parentLinks,
        parentTeamIds: [...canonicalTeamIds],
        parentPlayerKeys: [...effectiveCanonicalPlayerKeys],
        hasCanonicalParentTeamIds,
        hasCanonicalParentPlayerKeys
    };
}

export function hasParentLink(userData, teamId, playerId) {
    return resolveCanonicalParentScopeInput(userData).parentLinks.some((link) => (
        link?.teamId === teamId && link?.playerId === playerId
    ));
}

export function removeParentLinkState(userData, teamId, playerId) {
    const normalizedTeamId = normalizeParentScopeId(teamId);
    const normalizedPlayerId = normalizeParentScopeId(playerId);
    const canonicalScope = resolveCanonicalParentScopeInput(userData);
    const remainingParentOf = canonicalScope.parentLinks.filter((link) => !(
        link?.teamId === normalizedTeamId && link?.playerId === normalizedPlayerId
    ));
    const remainingParentPlayerKeys = uniqueStrings(
        remainingParentOf.map((link) => {
            const linkTeamId = normalizeParentScopeId(link?.teamId);
            const linkPlayerId = normalizeParentScopeId(link?.playerId);
            return linkTeamId && linkPlayerId ? `${linkTeamId}::${linkPlayerId}` : '';
        })
    );
    const remainingPlayerTeamIds = new Set(
        remainingParentPlayerKeys
            .map(parseParentPlayerKey)
            .filter(Boolean)
            .map((parsed) => parsed.teamId)
    );
    const remainingParentTeamIds = canonicalScope.hasCanonicalParentTeamIds
        ? canonicalScope.parentTeamIds.filter((currentTeamId) => (
            currentTeamId !== normalizedTeamId || remainingPlayerTeamIds.has(currentTeamId)
        ))
        : uniqueStrings(
            remainingParentOf.map((link) => normalizeParentScopeId(link?.teamId))
        );

    return {
        parentOf: remainingParentOf,
        parentTeamIds: remainingParentTeamIds,
        parentPlayerKeys: remainingParentPlayerKeys
    };
}

export function mergeApprovedParentLinkState({
    userData,
    parentUserId,
    parentEmail,
    team,
    player,
    relation
}) {
    const existingParentOf = resolveCanonicalParentScopeInput(userData).parentLinks;
    const nextParentLink = {
        teamId: team?.id || '',
        playerId: player?.id || '',
        teamName: team?.name || null,
        playerName: player?.name || null,
        playerNumber: player?.number || null,
        playerPhotoUrl: player?.photoUrl || null,
        relation: relation || null
    };

    const filteredParentOf = existingParentOf.filter((link) => !(
        link?.teamId === nextParentLink.teamId &&
        link?.playerId === nextParentLink.playerId
    ));
    const parentOf = [...filteredParentOf, nextParentLink];
    const parentTeamIds = uniqueStrings(parentOf.map((link) => link?.teamId));
    const parentPlayerKeys = uniqueStrings(parentOf.map((link) => {
        if (!link?.teamId || !link?.playerId) return '';
        return `${link.teamId}::${link.playerId}`;
    }));
    const roles = uniqueStrings([...(Array.isArray(userData?.roles) ? userData.roles : []), 'parent']);

    return {
        userUpdate: {
            parentOf,
            parentTeamIds,
            parentPlayerKeys,
            roles
        },
        playerParentEntry: {
            userId: parentUserId,
            email: parentEmail || 'pending',
            relation: relation || null
        }
    };
}

export function mergeApprovedParentMembershipRequests(userData, requests = []) {
    const canonicalScope = resolveCanonicalParentScopeInput(userData);
    let nextUserData = {
        parentOf: Array.isArray(userData?.parentOf) ? [...userData.parentOf] : [],
        roles: Array.isArray(userData?.roles) ? [...userData.roles] : []
    };
    if (canonicalScope.hasCanonicalParentTeamIds) {
        nextUserData.parentTeamIds = [...canonicalScope.parentTeamIds];
    }
    if (canonicalScope.hasCanonicalParentPlayerKeys) {
        nextUserData.parentPlayerKeys = [...canonicalScope.parentPlayerKeys];
    }

    // Approved-request recovery predates the server-authoritative membership
    // transaction. Once either canonical grant field exists, request history
    // is evidence only: a later login must never use an old approved row to
    // recreate a revoked team or player grant.
    if (canonicalScope.hasCanonicalParentTeamIds || canonicalScope.hasCanonicalParentPlayerKeys) {
        return { changed: false, userUpdate: nextUserData };
    }
    let changed = false;

    for (const request of (requests || [])) {
        if (request?.status !== 'approved' || !request?.teamId || !request?.playerId) {
            continue;
        }
        if (hasParentLink(nextUserData, request.teamId, request.playerId)) {
            continue;
        }

        const merged = mergeApprovedParentLinkState({
            userData: nextUserData,
            parentUserId: request.requesterUserId || userData?.id || '',
            parentEmail: request.requesterEmail || userData?.email || '',
            team: {
                id: request.teamId,
                name: request.teamName || null
            },
            player: {
                id: request.playerId,
                name: request.playerName || null,
                number: request.playerNumber || null,
                photoUrl: request.playerPhotoUrl || null
            },
            relation: request.relation || null
        });

        nextUserData = {
            ...nextUserData,
            ...merged.userUpdate
        };
        changed = true;
    }

    return {
        changed,
        userUpdate: nextUserData
    };
}

export function buildParentMembershipRequestUpdate({
    currentStatus,
    nextStatus,
    decidedBy,
    decidedByName = '',
    decisionNote = ''
}) {
    if (currentStatus !== 'pending') {
        throw new Error('Only pending requests can be decided');
    }
    if (!['approved', 'denied'].includes(nextStatus)) {
        throw new Error('Invalid parent membership request status');
    }
    if (!decidedBy) {
        throw new Error('Decision actor is required');
    }

    return {
        status: nextStatus,
        decidedBy,
        decidedByName: decidedByName || null,
        decisionNote: decisionNote ? String(decisionNote).trim() : null
    };
}
