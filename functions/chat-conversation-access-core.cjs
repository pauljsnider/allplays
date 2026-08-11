'use strict';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

function boundedString(value, maxLength) {
  return normalizeString(value).slice(0, maxLength);
}

function boundedStringList(value, maxEntries = 200, maxLength = 320) {
  return [...new Set(stringList(value)
    .map((entry) => boundedString(entry, maxLength))
    .filter(Boolean))]
    .slice(0, maxEntries);
}

function serializeTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date
    ? value
    : typeof value.toDate === 'function'
      ? value.toDate()
      : typeof value.toMillis === 'function'
        ? new Date(value.toMillis())
        : typeof value.seconds === 'number' || typeof value._seconds === 'number'
          ? new Date(
            (Number(value.seconds ?? value._seconds) * 1000) +
            Math.floor(Number(value.nanoseconds ?? value._nanoseconds ?? 0) / 1_000_000)
          )
          : new Date(value);
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function serializeChatConversationProjection(conversationId, conversation = {}) {
  const id = normalizeString(conversationId);
  if (!id || id.includes('/') || id.length > 1500) return null;
  const data = conversation && typeof conversation === 'object' && !Array.isArray(conversation)
    ? conversation
    : {};
  const type = ['team', 'group', 'direct'].includes(data.type) ? data.type : 'group';
  const directAccess = ['accepted_friend', 'team_admin'].includes(data.directAccess)
    ? data.directAccess
    : null;
  return {
    id,
    type,
    name: boundedString(data.name, 200) || null,
    participantIds: boundedStringList(data.participantIds),
    participantRoles: boundedStringList(data.participantRoles, 20, 80),
    directAccess,
    directUserIds: boundedStringList(data.directUserIds, 2, 128),
    friendshipId: boundedString(data.friendshipId, 320) || null,
    initiatedBy: boundedString(data.initiatedBy, 128) || null,
    updatedAt: serializeTimestamp(data.updatedAt),
    lastMessageAt: serializeTimestamp(data.lastMessageAt || data.latestMessageAt),
    isDefault: data.isDefault === true,
    isLegacy: data.isLegacy === true
  };
}

function canProjectChatConversation({
  callerUid,
  callerEmail,
  canManageTeam,
  hasTeamChatAccess,
  conversationId,
  conversation
}) {
  const uid = normalizeString(callerUid);
  const email = normalizeString(callerEmail).toLowerCase();
  const id = normalizeString(conversationId);
  const data = conversation && typeof conversation === 'object' && !Array.isArray(conversation)
    ? conversation
    : {};
  if (!uid || !id || hasTeamChatAccess !== true) return false;

  const participantIds = stringList(data.participantIds);
  const directUserIds = stringList(data.directUserIds);
  const participantRoles = stringList(data.participantRoles);
  const isAcceptedFriendConversation = data.type === 'direct' && data.directAccess === 'accepted_friend';
  if (isAcceptedFriendConversation && !directUserIds.includes(uid)) return false;

  const isCanonicalStaffConversation = id === 'group_role%3Astaff';
  const isStaffRoleConversation = participantRoles.includes('staff');
  if (isCanonicalStaffConversation) {
    return canManageTeam === true &&
      data.type === 'group' &&
      isStaffRoleConversation &&
      participantIds.length === 0;
  }
  if (isStaffRoleConversation) return false;

  return id === 'team' ||
    data.type === 'team' ||
    canManageTeam === true ||
    participantIds.includes(uid) ||
    participantIds.includes(`user:${uid}`) ||
    directUserIds.includes(uid) ||
    Boolean(email && participantIds.includes(`email:${email}`));
}

module.exports = {
  canProjectChatConversation,
  serializeChatConversationProjection
};
