'use strict';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCallerUid(value) {
  if (typeof value !== 'string' || value !== value.trim()) return '';
  return value.length > 0 && value.length <= 128 && !value.includes('/') ? value : '';
}

function normalizeParticipantSelector(value) {
  if (typeof value !== 'string' || value !== value.trim() || !value) return null;
  if (value.length > 320) return null;
  const lowerValue = value.toLowerCase();
  if (lowerValue.startsWith('email:')) {
    const email = value.slice(6).trim().toLowerCase();
    return email && email.length <= 320 && email.includes('@')
      ? { kind: 'email', value: email, key: `email:${email}` }
      : null;
  }
  const rawUid = lowerValue.startsWith('user:') ? value.slice(5).trim() : value;
  const uid = normalizeCallerUid(rawUid);
  return uid ? { kind: 'uid', value: uid, key: `uid:${uid}` } : null;
}

async function resolveCanonicalConversationParticipants({
  callerUid,
  participantSelectors,
  resolveUserByUid,
  resolveUserByEmail,
  maxParticipants = 50
}) {
  const uid = normalizeCallerUid(callerUid);
  if (!uid || typeof resolveUserByUid !== 'function' || typeof resolveUserByEmail !== 'function') {
    throw new Error('Conversation participants could not be verified.');
  }
  if (!Array.isArray(participantSelectors) || participantSelectors.length === 0 ||
      participantSelectors.length > maxParticipants) {
    throw new Error('Choose between 2 and 50 current team members.');
  }
  const selectors = new Map();
  selectors.set(`uid:${uid}`, { kind: 'uid', value: uid, key: `uid:${uid}` });
  participantSelectors.forEach((value) => {
    const selector = normalizeParticipantSelector(value);
    if (!selector) throw new Error('Every conversation recipient must be a valid user or email selector.');
    selectors.set(selector.key, selector);
  });
  const resolved = await Promise.all([...selectors.values()].map(async (selector) => {
    const user = selector.kind === 'email'
      ? await resolveUserByEmail(selector.value)
      : await resolveUserByUid(selector.value);
    const resolvedUid = normalizeCallerUid(user?.uid);
    if (!resolvedUid || user?.disabled === true) {
      throw new Error('Every conversation recipient must have an active account.');
    }
    if (selector.kind === 'uid' && resolvedUid !== selector.value) {
      throw new Error('Conversation recipient identity did not match the requested user.');
    }
    return {
      uid: resolvedUid,
      email: normalizeString(user?.email).toLowerCase(),
      disabled: false
    };
  }));
  const participantsByUid = new Map(resolved.map((user) => [user.uid, user]));
  const participants = [...participantsByUid.values()].sort((left, right) => left.uid.localeCompare(right.uid));
  if (!participantsByUid.has(uid) || participants.length < 2 || participants.length > maxParticipants) {
    throw new Error('Choose between 2 and 50 current team members.');
  }
  return {
    type: participants.length === 2 ? 'direct' : 'group',
    participantIds: participants.map((user) => user.uid),
    participants
  };
}

function buildCanonicalConversationId(type, participantIds) {
  const canonicalType = type === 'direct' ? 'direct' : 'group';
  const ids = [...new Set((Array.isArray(participantIds) ? participantIds : [])
    .map(normalizeCallerUid)
    .filter(Boolean))].sort();
  if (ids.length < 2 || (canonicalType === 'direct' && ids.length !== 2)) return '';
  return `${canonicalType}_${ids.map((id) => encodeURIComponent(id)).join('__')}`;
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
  const uid = normalizeCallerUid(callerUid);
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
  buildCanonicalConversationId,
  canProjectChatConversation,
  normalizeParticipantSelector,
  resolveCanonicalConversationParticipants,
  serializeChatConversationProjection
};
