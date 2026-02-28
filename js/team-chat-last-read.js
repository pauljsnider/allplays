/**
 * Decide whether chat last-read should be advanced for the current snapshot.
 * @param {Object} params
 * @param {boolean} params.hasCurrentUser
 * @param {boolean} params.hasTeamId
 * @returns {boolean}
 */
export function shouldUpdateChatLastRead({ hasCurrentUser, hasTeamId }) {
    return Boolean(hasCurrentUser && hasTeamId);
}
