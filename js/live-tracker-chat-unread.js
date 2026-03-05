export function advanceLiveChatUnreadState({
  messages,
  chatInitialized,
  chatExpanded,
  unreadChatCount,
  lastChatSeenAt,
  lastChatSnapshotAt,
  lastChatSnapshotIds,
  now = Date.now()
}) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const safeUnreadChatCount = Number.isFinite(unreadChatCount) ? unreadChatCount : 0;
  const safeLastChatSeenAt = Number.isFinite(lastChatSeenAt) ? lastChatSeenAt : 0;
  const safeLastChatSnapshotAt = Number.isFinite(lastChatSnapshotAt)
    ? lastChatSnapshotAt
    : safeLastChatSeenAt;
  const safeLastChatSnapshotIds = Array.isArray(lastChatSnapshotIds)
    ? lastChatSnapshotIds
    : [];
  const snapshotIdSet = new Set(safeLastChatSnapshotIds.filter((id) => typeof id === 'string' && id));

  if (!safeMessages.length) {
    return {
      chatInitialized: !!chatInitialized,
      unreadChatCount: safeUnreadChatCount,
      lastChatSeenAt: safeLastChatSeenAt,
      lastChatSnapshotAt: safeLastChatSnapshotAt,
      lastChatSnapshotIds: safeLastChatSnapshotIds
    };
  }

  if (!chatInitialized) {
    return {
      chatInitialized: true,
      unreadChatCount: 0,
      lastChatSeenAt: now,
      lastChatSnapshotAt: now,
      lastChatSnapshotIds: []
    };
  }

  if (chatExpanded) {
    return {
      chatInitialized: true,
      unreadChatCount: 0,
      lastChatSeenAt: now,
      lastChatSnapshotAt: now,
      lastChatSnapshotIds: []
    };
  }

  let newlyUnread = 0;
  let latestTimestamp = safeLastChatSnapshotAt;
  let latestIdsAtTimestamp = safeLastChatSnapshotAt > 0 ? new Set(snapshotIdSet) : new Set();
  safeMessages.forEach((msg) => {
    const ts = msg?.createdAt?.toMillis ? msg.createdAt.toMillis() : null;
    const msgId = typeof msg?.id === 'string' ? msg.id : '';
    if (!ts) return;
    if (ts > safeLastChatSnapshotAt) {
      newlyUnread += 1;
    } else if (ts === safeLastChatSnapshotAt && msgId && !snapshotIdSet.has(msgId)) {
      newlyUnread += 1;
    }
    if (ts > latestTimestamp) {
      latestTimestamp = ts;
      latestIdsAtTimestamp = new Set();
      if (msgId) latestIdsAtTimestamp.add(msgId);
    } else if (ts === latestTimestamp && msgId) {
      latestIdsAtTimestamp.add(msgId);
    }
  });

  return {
    chatInitialized: true,
    unreadChatCount: safeUnreadChatCount + newlyUnread,
    lastChatSeenAt: safeLastChatSeenAt,
    lastChatSnapshotAt: latestTimestamp,
    lastChatSnapshotIds: Array.from(latestIdsAtTimestamp)
  };
}
