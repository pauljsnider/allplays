'use strict';

function normalizeUserId(value) {
  const normalized = String(value || '').trim();
  const userId = normalized.toLowerCase().startsWith('user:')
    ? normalized.slice(5).trim()
    : normalized;
  return /^[A-Za-z0-9_-]{1,160}$/.test(userId) ? userId : '';
}

function normalizeTeamId(value) {
  const teamId = String(value || '').trim();
  return teamId && !teamId.includes('/') && teamId.length <= 160 ? teamId : '';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizedUserIds(values) {
  return new Set((Array.isArray(values) ? values : []).map(normalizeUserId).filter(Boolean));
}

function normalizedStrings(values) {
  return new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean));
}

function isAcceptedFriendshipForTeam(friendship, senderId, recipientId, teamId) {
  const memberIds = normalizedUserIds(friendship?.memberIds);
  const sharedTeamIds = normalizedStrings(friendship?.sharedTeamIds);
  return friendship?.status === 'accepted' &&
    memberIds.size === 2 &&
    memberIds.has(senderId) &&
    memberIds.has(recipientId) &&
    sharedTeamIds.has(teamId);
}

function hasCurrentTeamAccess({ team, user, userId, email }) {
  const parentTeamIds = normalizedStrings(user?.parentTeamIds);
  const adminEmails = new Set((Array.isArray(team?.adminEmails) ? team.adminEmails : [])
    .map(normalizeEmail)
    .filter(Boolean));
  const normalizedUserEmail = normalizeEmail(email || user?.email || user?.profileEmail);
  return user?.isAdmin === true ||
    team?.ownerId === userId ||
    parentTeamIds.has(String(team?.id || '').trim()) ||
    Boolean(normalizedUserEmail && adminEmails.has(normalizedUserEmail));
}

function canMessageAcceptedFriendForTeam({
  friendship,
  team,
  sender,
  recipient,
  senderId,
  recipientId,
  teamId,
  senderEmail
}) {
  if (!friendship || !team || !senderId || !recipientId || !teamId) return false;
  if (!isAcceptedFriendshipForTeam(friendship, senderId, recipientId, teamId)) return false;
  const teamWithId = { ...team, id: teamId };
  return hasCurrentTeamAccess({
    team: teamWithId,
    user: sender,
    userId: senderId,
    email: senderEmail
  }) && hasCurrentTeamAccess({
    team: teamWithId,
    user: recipient,
    userId: recipientId
  });
}

function createCheckAcceptedFriendMessageAccessHandler({ firestore, HttpsError }) {
  return async (data, context = {}) => {
    const senderId = normalizeUserId(context.auth?.uid);
    if (!senderId) {
      throw new HttpsError('unauthenticated', 'Sign in to verify this friend connection.');
    }
    const recipientId = normalizeUserId(data?.recipientId);
    const teamId = normalizeTeamId(data?.teamId);
    if (!recipientId || recipientId === senderId || !teamId) return { allowed: false };

    const friendshipId = [senderId, recipientId].sort().join('__');
    const friendshipSnap = await firestore.doc(`friendships/${friendshipId}`).get();
    const friendship = friendshipSnap.exists ? friendshipSnap.data() || {} : null;
    if (!isAcceptedFriendshipForTeam(friendship, senderId, recipientId, teamId)) {
      return { allowed: false };
    }

    const [teamSnap, senderSnap, recipientSnap] = await Promise.all([
      firestore.doc(`teams/${teamId}`).get(),
      firestore.doc(`users/${senderId}`).get(),
      firestore.doc(`users/${recipientId}`).get()
    ]);
    if (!teamSnap.exists) return { allowed: false };

    return {
      allowed: canMessageAcceptedFriendForTeam({
        friendship,
        team: teamSnap.data() || {},
        sender: senderSnap.exists ? senderSnap.data() || {} : {},
        recipient: recipientSnap.exists ? recipientSnap.data() || {} : {},
        senderId,
        recipientId,
        teamId,
        senderEmail: context.auth?.token?.email
      })
    };
  };
}

module.exports = {
  canMessageAcceptedFriendForTeam,
  createCheckAcceptedFriendMessageAccessHandler,
  hasCurrentTeamAccess,
  isAcceptedFriendshipForTeam,
  normalizeTeamId,
  normalizeUserId
};
