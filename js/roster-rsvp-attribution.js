// Map RSVP responders (user ids) to the players they are linked to, using only
// roster data a team coach/admin can actually read. Legacy or user-level RSVPs
// that carry no playerIds are otherwise attributed via getUserProfile(uid), but
// Firestore rules forbid a coach from reading another parent's /users doc, so
// those responses silently showed up as "not responded" for every player
// (#3863). The player docs themselves carry the linked parent user ids
// (player.parents[].userId, private profile parents, legacy parent/guardian
// user id fields), which team staff can read.

function pushLink(map, userId, playerId) {
    const uid = String(userId || '').trim();
    const pid = String(playerId || '').trim();
    if (!uid || !pid) return;
    if (!map.has(uid)) map.set(uid, new Set());
    map.get(uid).add(pid);
}

function collectParentUserIds(parentLike) {
    const ids = [];
    if (!parentLike || typeof parentLike !== 'object') return ids;
    ['userId', 'parentUserId', 'guardianUserId', 'uid'].forEach((key) => {
        const value = parentLike[key];
        if (typeof value === 'string' && value.trim()) ids.push(value.trim());
    });
    return ids;
}

/**
 * @param {Array} players - roster players (optionally with privateProfileParents).
 * @returns {Map<string, string[]>} userId -> linked playerIds.
 */
export function buildRosterUserPlayerMap(players = []) {
    const map = new Map();
    (Array.isArray(players) ? players : []).forEach((player) => {
        const playerId = player?.id;
        if (!playerId) return;
        const parentGroups = [
            player.parents,
            player.privateProfileParents,
            player.contacts,
            player.privateProfileContacts
        ];
        parentGroups.forEach((group) => {
            (Array.isArray(group) ? group : []).forEach((parent) => {
                collectParentUserIds(parent).forEach((uid) => pushLink(map, uid, playerId));
            });
        });
        // Legacy single-parent fields on the player doc.
        collectParentUserIds(player).forEach((uid) => pushLink(map, uid, playerId));
    });

    const result = new Map();
    map.forEach((set, uid) => result.set(uid, [...set]));
    return result;
}

/**
 * Build a resolveIdsForUser(uid) function for buildFallbackPlayerIdsByUser that
 * consults the coach-readable roster map first, then an optional profile-based
 * resolver (which only works for the signed-in user themselves or admins).
 */
export function createRosterBackedIdResolver(rosterUserPlayerMap, profileResolver) {
    return async (uid) => {
        const fromRoster = rosterUserPlayerMap.get(String(uid || '').trim());
        if (fromRoster && fromRoster.length) return fromRoster;
        if (typeof profileResolver === 'function') {
            return profileResolver(uid);
        }
        return [];
    };
}
