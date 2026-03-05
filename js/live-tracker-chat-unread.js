export function advanceLiveChatUnreadState({
  messages,
  chatInitialized,
  chatExpanded,
  unreadChatCount,
  lastChatSeenAt,
  lastChatSnapshotAt,
  now = Date.now()
}) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const safeUnreadChatCount = Number.isFinite(unreadChatCount) ? unreadChatCount : 0;
  const safeLastChatSeenAt = Number.isFinite(lastChatSeenAt) ? lastChatSeenAt : 0;
  const safeLastChatSnapshotAt = Number.isFinite(lastChatSnapshotAt)
    ? lastChatSnapshotAt
    : safeLastChatSeenAt;

  if (!safeMessages.length) {
    return {
      chatInitialized: !!chatInitialized,
      unreadChatCount: safeUnreadChatCount,
      lastChatSeenAt: safeLastChatSeenAt,
      lastChatSnapshotAt: safeLastChatSnapshotAt
    };
  }

  if (!chatInitialized) {
    return {
      chatInitialized: true,
      unreadChatCount: 0,
      lastChatSeenAt: now,
      lastChatSnapshotAt: now
    };
  }

  if (chatExpanded) {
    return {
      chatInitialized: true,
      unreadChatCount: 0,
      lastChatSeenAt: now,
      lastChatSnapshotAt: now
    };
  }

  let newlyUnread = 0;
  let latestTimestamp = safeLastChatSnapshotAt;
  safeMessages.forEach((msg) => {
    const ts = msg?.createdAt?.toMillis ? msg.createdAt.toMillis() : null;
    if (!ts) return;
    if (ts > safeLastChatSnapshotAt) {
      newlyUnread += 1;
    }
    if (ts > latestTimestamp) {
      latestTimestamp = ts;
    }
  });

  return {
    chatInitialized: true,
    unreadChatCount: safeUnreadChatCount + newlyUnread,
    lastChatSeenAt: safeLastChatSeenAt,
    lastChatSnapshotAt: latestTimestamp
  };
}
