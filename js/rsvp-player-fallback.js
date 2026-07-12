function compactId(value) {
    return String(value || '').trim();
}

export function uniqueNonEmptyIds(values) {
    return Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map(compactId)
            .filter(Boolean)
    ));
}

export function extractDirectRsvpPlayerIds(rsvp) {
    const direct = uniqueNonEmptyIds(rsvp?.playerIds);
    if (direct.length) return direct;
    return uniqueNonEmptyIds([rsvp?.playerId, rsvp?.childId]);
}

function isPermissionDenied(error) {
    return error?.code === 'permission-denied';
}

function appendFallbackPlayerIds(fallbackByUser, userId, playerIds) {
    const normalizedUserId = compactId(userId);
    const normalizedPlayerIds = uniqueNonEmptyIds(playerIds);
    if (!normalizedUserId || normalizedPlayerIds.length === 0) return;
    fallbackByUser.set(normalizedUserId, uniqueNonEmptyIds([
        ...(fallbackByUser.get(normalizedUserId) || []),
        ...normalizedPlayerIds
    ]));
}

function extractParentUserIdsFromPlayer(player) {
    const publicParents = Array.isArray(player?.parents) ? player.parents : [];
    const privateParents = Array.isArray(player?.privateProfileParents) ? player.privateProfileParents : [];
    const rosterParents = [...publicParents, ...privateParents];
    return uniqueNonEmptyIds([
        ...rosterParents.flatMap((parent) => [
            parent?.userId,
            parent?.uid,
            parent?.parentUserId,
            parent?.accountUserId
        ]),
        player?.parentUserId,
        player?.guardianUserId
    ]);
}

export function buildRosterPlayerIdsByUser(players = []) {
    const fallbackByUser = new Map();
    (Array.isArray(players) ? players : []).forEach((player) => {
        const playerId = compactId(player?.id || player?.playerId);
        if (!playerId) return;
        extractParentUserIdsFromPlayer(player).forEach((userId) => {
            appendFallbackPlayerIds(fallbackByUser, userId, [playerId]);
        });
    });
    return fallbackByUser;
}

export function extractPlayerIdsFromParentScope(teamId, profile = {}) {
    const normalizedTeamId = compactId(teamId);
    if (!normalizedTeamId) return [];

    const playerIds = [];
    (Array.isArray(profile?.parentOf) ? profile.parentOf : []).forEach((link) => {
        if (compactId(link?.teamId) !== normalizedTeamId) return;
        playerIds.push(link?.playerId);
    });

    (Array.isArray(profile?.parentPlayerKeys) ? profile.parentPlayerKeys : []).forEach((value) => {
        const key = compactId(value);
        const separatorIndex = key.indexOf('::');
        if (separatorIndex <= 0) return;
        const keyTeamId = key.slice(0, separatorIndex);
        const keyPlayerId = key.slice(separatorIndex + 2);
        if (keyTeamId === normalizedTeamId) {
            playerIds.push(keyPlayerId);
        }
    });

    return uniqueNonEmptyIds(playerIds);
}

function getUnresolvedRsvpUserIds(rsvps = []) {
    return uniqueNonEmptyIds(
        (Array.isArray(rsvps) ? rsvps : [])
            .filter((rsvp) => extractDirectRsvpPlayerIds(rsvp).length === 0)
            .map((rsvp) => rsvp?.userId || rsvp?.id)
    );
}

async function mergeParentPlayerKeyIndex({
    teamId,
    players,
    unresolvedUserIds,
    fallbackByUser,
    resolveUsersByParentPlayerKey
}) {
    if (typeof resolveUsersByParentPlayerKey !== 'function' || unresolvedUserIds.length === 0) return;
    const remainingUserIds = unresolvedUserIds.filter((userId) => uniqueNonEmptyIds(fallbackByUser.get(userId) || []).length === 0);
    if (remainingUserIds.length === 0) return;
    const unresolvedUserIdSet = new Set(remainingUserIds);
    const playerIds = uniqueNonEmptyIds((Array.isArray(players) ? players : []).map((player) => player?.id || player?.playerId));

    await Promise.all(playerIds.map(async (playerId) => {
        const parentPlayerKey = `${teamId}::${playerId}`;
        let users = [];
        try {
            users = await resolveUsersByParentPlayerKey(parentPlayerKey, playerId) || [];
        } catch (error) {
            if (isPermissionDenied(error)) return;
            throw error;
        }

        (Array.isArray(users) ? users : []).forEach((user) => {
            const userId = compactId(user?.id || user?.uid || user?.userId);
            if (!userId || !unresolvedUserIdSet.has(userId)) return;
            appendFallbackPlayerIds(fallbackByUser, userId, [playerId]);
            appendFallbackPlayerIds(fallbackByUser, userId, extractPlayerIdsFromParentScope(teamId, user));
        });
    }));
}

export async function buildRsvpFallbackPlayerIdsByUser({
    teamId,
    rsvps,
    players = [],
    resolveIdsForUser,
    resolveUsersByParentPlayerKey
} = {}) {
    const normalizedTeamId = compactId(teamId);
    const fallbackByUser = buildRosterPlayerIdsByUser(players);
    const unresolvedUserIds = getUnresolvedRsvpUserIds(rsvps);
    if (!normalizedTeamId || unresolvedUserIds.length === 0) return fallbackByUser;

    if (typeof resolveIdsForUser === 'function') {
        await Promise.all(unresolvedUserIds.map(async (userId) => {
            let profilePlayerIds = [];
            try {
                profilePlayerIds = await resolveIdsForUser(userId) || [];
            } catch (error) {
                if (isPermissionDenied(error)) return;
                throw error;
            }
            appendFallbackPlayerIds(fallbackByUser, userId, profilePlayerIds);
        }));
    }

    await mergeParentPlayerKeyIndex({
        teamId: normalizedTeamId,
        players,
        unresolvedUserIds,
        fallbackByUser,
        resolveUsersByParentPlayerKey
    });

    return fallbackByUser;
}
