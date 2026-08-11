'use strict';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
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
  canProjectChatConversation
};
