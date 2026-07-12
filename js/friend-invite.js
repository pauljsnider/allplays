export const FRIEND_INVITE_TYPE = 'friend_invite';
export const FRIEND_INVITE_ROUTE_TYPE = 'friend';

export function buildFriendshipId(firstUserId, secondUserId) {
    return [firstUserId, secondUserId]
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .sort()
        .join('__');
}

export function normalizeFriendInviteContact(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

export function buildFriendInviteAccessCodeData({
    code,
    generatedBy,
    email = '',
    phone = '',
    now,
    expiresAt
}) {
    return {
        code: String(code || '').trim().toUpperCase(),
        type: FRIEND_INVITE_TYPE,
        generatedBy,
        email: normalizeFriendInviteContact(email),
        phone: normalizeFriendInviteContact(phone),
        createdAt: now,
        expiresAt,
        used: false,
        usedBy: null,
        usedAt: null
    };
}

function collectProfileTeamEntries(profile = {}) {
    const entries = [];
    const add = (teamId, teamName = null) => {
        const id = String(teamId || '').trim();
        if (!id) return;
        entries.push({
            teamId: id,
            teamName: String(teamName || '').trim() || id
        });
    };

    (Array.isArray(profile.parentOf) ? profile.parentOf : []).forEach(link => {
        add(link?.teamId, link?.teamName);
    });
    (Array.isArray(profile.teams) ? profile.teams : []).forEach(team => {
        add(team?.teamId || team?.id, team?.teamName || team?.name);
    });
    (Array.isArray(profile.parentTeamIds) ? profile.parentTeamIds : []).forEach(add);
    (Array.isArray(profile.discoveryTeamIds) ? profile.discoveryTeamIds : []).forEach(add);
    (Array.isArray(profile.coachOf) ? profile.coachOf : []).forEach(add);

    const seen = new Map();
    entries.forEach(entry => {
        if (!seen.has(entry.teamId)) {
            seen.set(entry.teamId, entry.teamName);
        }
    });
    return seen;
}

export function getSharedTeamContext(firstProfile = {}, secondProfile = {}) {
    const firstTeams = collectProfileTeamEntries(firstProfile);
    const secondTeams = collectProfileTeamEntries(secondProfile);
    const sharedTeamIds = [...firstTeams.keys()].filter(teamId => secondTeams.has(teamId));
    return {
        sharedTeamIds,
        sharedTeamNames: sharedTeamIds.map(teamId => firstTeams.get(teamId) || secondTeams.get(teamId) || teamId)
    };
}

export function getDisplayName(profile = {}, fallback = 'your friend') {
    return String(
        profile.fullName ||
        profile.displayName ||
        profile.name ||
        profile.email ||
        fallback ||
        ''
    ).trim() || fallback;
}

export function buildAcceptedFriendshipData({
    inviterId,
    inviteeId,
    inviterProfile = {},
    inviteeProfile = {},
    existingFriendship = {},
    now,
    inviteCodeId
}) {
    const sortedMemberIds = [inviterId, inviteeId].map(String).sort();
    const existingMemberIds = Array.isArray(existingFriendship.memberIds)
        ? existingFriendship.memberIds.map(value => String(value || '').trim()).filter(Boolean)
        : [];
    const memberIds = existingMemberIds.length === 2 &&
        [...existingMemberIds].sort().join('__') === sortedMemberIds.join('__')
        ? existingMemberIds
        : sortedMemberIds;
    const shared = getSharedTeamContext(inviterProfile, inviteeProfile);
    return {
        requesterId: existingFriendship.requesterId || inviterId,
        recipientId: existingFriendship.recipientId || inviteeId,
        memberIds,
        status: 'accepted',
        sharedTeamIds: shared.sharedTeamIds,
        sharedTeamNames: shared.sharedTeamNames,
        blockedBy: Array.isArray(existingFriendship.blockedBy) ? existingFriendship.blockedBy : [],
        source: FRIEND_INVITE_TYPE,
        inviteCodeId,
        createdAt: existingFriendship.createdAt || now,
        acceptedAt: now,
        respondedAt: now,
        updatedAt: now
    };
}
