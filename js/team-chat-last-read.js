/**
 * Decide whether chat last-read should be advanced for the current snapshot.
 * Policy: advance on realtime snapshot only while the user is actively viewing chat.
 * @param {Object} params
 * @param {boolean} params.hasCurrentUser
 * @param {boolean} params.hasTeamId
 * @param {boolean} params.isPageVisible
 * @param {boolean} params.isWindowFocused
 * @returns {boolean}
 */
export function shouldUpdateChatLastRead({
    hasCurrentUser,
    hasTeamId,
    isPageVisible,
    isWindowFocused
}) {
    return Boolean(hasCurrentUser && hasTeamId && isPageVisible && isWindowFocused);
}
