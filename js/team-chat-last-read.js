/**
 * Decide whether chat last-read should be advanced for the current snapshot.
 * Policy: advance on every realtime snapshot while required context exists.
 * @param {Object} params
 * @param {boolean} params.hasCurrentUser
 * @param {boolean} params.hasTeamId
 * @returns {boolean}
 */
export function shouldUpdateChatLastRead({ hasCurrentUser, hasTeamId }) {
    return Boolean(hasCurrentUser && hasTeamId);
}
