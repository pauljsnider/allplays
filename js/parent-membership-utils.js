export function buildParentMembershipRequestId(userId, playerId) {
    return `${String(userId || '').trim()}__${String(playerId || '').trim()}`;
}

function uniqueStrings(values) {
    return [...new Set((values || []).filter(Boolean).map((value) => String(value)))];
}

export function mergeApprovedParentLinkState({
    userData,
    parentUserId,
    parentEmail,
    team,
    player,
    relation
}) {
    const existingParentOf = Array.isArray(userData?.parentOf) ? userData.parentOf : [];
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
