/**
 * Decide whether chat last-read should be advanced for the current snapshot.
 * Policy: advance on realtime snapshot only while the user is actively viewing chat.
 * Snapshot lifecycle flags (for example `initialSnapshotLoaded`) are intentionally
 * handled by the caller and are not part of this predicate.
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

/**
 * Decide whether chat last-read should be retried when the user returns to the chat view.
 * This protects unread state when snapshot-time writes are missed and no new snapshot arrives.
 * @param {Object} params
 * @param {boolean} params.hasCurrentUser
 * @param {boolean} params.hasTeamId
 * @param {boolean} params.isPageVisible
 * @param {boolean} params.isWindowFocused
 * @param {boolean} params.hasMessages
 * @param {boolean} params.hasLoadedSnapshot
 * @param {boolean} params.isAwaitingPostResumeSnapshot
 * @returns {boolean}
 */
export function shouldRetryChatLastReadOnViewReturn({
    hasCurrentUser,
    hasTeamId,
    isPageVisible,
    isWindowFocused,
    hasMessages,
    hasLoadedSnapshot,
    isAwaitingPostResumeSnapshot
}) {
    return Boolean(
        hasMessages &&
        hasLoadedSnapshot &&
        !isAwaitingPostResumeSnapshot &&
        shouldUpdateChatLastRead({
            hasCurrentUser,
            hasTeamId,
            isPageVisible,
            isWindowFocused
        })
    );
}
