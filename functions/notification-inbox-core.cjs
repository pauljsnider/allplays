const NOTIFICATION_INBOX_MAX_ITEMS = 50;

function normalizeInboxText(value, maxLength) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function normalizeInboxId(value) {
  return String(value || '').trim();
}

function getUniqueNotificationInboxTargets(targets = []) {
  const seen = new Set();
  const uniqueTargets = [];
  for (const target of Array.isArray(targets) ? targets : []) {
    const uid = normalizeInboxId(target?.uid);
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    uniqueTargets.push({ ...target, uid });
  }
  return uniqueTargets;
}

function buildNotificationInboxPayload({
  category,
  title,
  body,
  appRoute,
  teamId,
  gameId = null,
  eventId = null,
  conversationId = null,
  createdAt = null,
  readAt = null
} = {}) {
  return {
    category: normalizeInboxText(category, 60),
    title: normalizeInboxText(title || 'ALL PLAYS Update', 160),
    body: normalizeInboxText(body, 500),
    appRoute: normalizeInboxId(appRoute) || '/',
    teamId: normalizeInboxId(teamId),
    gameId: gameId ? normalizeInboxId(gameId) : null,
    eventId: eventId ? normalizeInboxId(eventId) : null,
    conversationId: conversationId ? normalizeInboxId(conversationId) : null,
    createdAt,
    readAt
  };
}

module.exports = {
  NOTIFICATION_INBOX_MAX_ITEMS,
  buildNotificationInboxPayload,
  getUniqueNotificationInboxTargets,
  normalizeInboxId
};
