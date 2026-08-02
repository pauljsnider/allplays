'use strict';

const FRIEND_INVITE_REDEMPTION_ERROR_MESSAGE = 'Unable to redeem friend invite.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
const ACCESS_CODE_PATTERN = /^[A-Z0-9]{8}$/;
const TERMINAL_INVITE_STATUSES = new Set([
  'accepted',
  'cancelled',
  'expired',
  'removed',
  'revoked',
  'used'
]);

class FriendInviteRedemptionRejection extends Error {
  constructor(reason) {
    super('Friend invite redemption rejected');
    this.reason = reason;
  }
}

function rejectRedemption(reason) {
  throw new FriendInviteRedemptionRejection(reason);
}

function normalizeVerifiedRecipientEmail(token) {
  if (token?.email_verified !== true || typeof token.email !== 'string') return '';
  const email = token.email.trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : '';
}

function normalizeVerifiedRecipientPhone(token) {
  if (typeof token?.phone_number !== 'string') return '';
  const phone = token.phone_number;
  return E164_PHONE_PATTERN.test(phone) ? phone : '';
}

function extractVerifiedFriendInviteRecipientIdentities(auth, HttpsError) {
  const uid = typeof auth?.uid === 'string' ? auth.uid : '';
  const token = auth?.token && typeof auth.token === 'object' && !Array.isArray(auth.token)
    ? auth.token
    : null;
  const email = normalizeVerifiedRecipientEmail(token);
  const phone = normalizeVerifiedRecipientPhone(token);

  if (!uid || !token || (!email && !phone)) {
    throw new HttpsError('permission-denied', FRIEND_INVITE_REDEMPTION_ERROR_MESSAGE);
  }

  return { uid, email, phone };
}

function normalizeAccessCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return ACCESS_CODE_PATTERN.test(code) ? code : '';
}

function normalizeStoredEmail(value) {
  if (typeof value !== 'string') return '';
  const email = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : '';
}

function normalizeStoredPhone(value) {
  if (typeof value !== 'string') return '';
  const phone = value.trim();
  if (!phone.startsWith('+') || !/^\+[0-9().\s-]+$/.test(phone)) return '';
  const canonical = `+${phone.slice(1).replace(/\D/g, '')}`;
  return E164_PHONE_PATTERN.test(canonical) ? canonical : '';
}

function normalizeDocumentUid(value) {
  if (typeof value !== 'string') return '';
  return value.trim() && value.length <= 128 && !value.includes('/') ? value : '';
}

function getTimestampMillis(value) {
  if (typeof value?.toMillis === 'function') return Number(value.toMillis());
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (Number.isFinite(value?.seconds)) {
    return (Number(value.seconds) * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1_000_000);
  }
  return Number.NaN;
}

function buildFriendshipId(firstUid, secondUid) {
  return [firstUid, secondUid].sort().join('__');
}

function getVerifiedRecipient(value) {
  const uid = typeof value?.uid === 'string' ? value.uid : '';
  const email = typeof value?.email === 'string' ? value.email : '';
  const phone = typeof value?.phone === 'string' ? value.phone : '';
  const uidIsUsable = Boolean(uid.trim()) && uid.length <= 128 && !uid.includes('/');
  const emailIsCanonical = !email || (email === email.trim().toLowerCase() && EMAIL_PATTERN.test(email));
  const phoneIsCanonical = !phone || E164_PHONE_PATTERN.test(phone);

  if (!uidIsUsable || !emailIsCanonical || !phoneIsCanonical || (!email && !phone)) {
    rejectRedemption('invalid-recipient');
  }
  return { uid, email, phone };
}

function hasMatchingVerifiedTarget(invite, recipient) {
  const storedEmail = normalizeStoredEmail(invite?.email);
  const storedPhone = normalizeStoredPhone(invite?.phone);
  return Boolean(
    (storedEmail && recipient.email && storedEmail === recipient.email) ||
    (storedPhone && recipient.phone && storedPhone === recipient.phone)
  );
}

function assertActiveInvite(invite, code, recipient, nowMillis) {
  if (!invite || invite.type !== 'friend_invite') rejectRedemption('invite-unavailable');
  if (normalizeAccessCode(invite.code) !== code) rejectRedemption('invite-malformed');
  if (invite.used !== false || invite.usedBy != null || invite.usedAt != null) {
    rejectRedemption('invite-used');
  }
  if (invite.revoked === true || invite.active === false) rejectRedemption('invite-inactive');
  const status = String(invite.status || '').trim().toLowerCase();
  if ((status && status !== 'active') || TERMINAL_INVITE_STATUSES.has(status)) {
    rejectRedemption('invite-inactive');
  }
  const expiresAtMillis = getTimestampMillis(invite.expiresAt);
  if (!Number.isFinite(expiresAtMillis) || expiresAtMillis <= nowMillis) {
    rejectRedemption('invite-expired');
  }

  const inviterUid = normalizeDocumentUid(invite.generatedBy);
  if (!inviterUid || inviterUid === recipient.uid) rejectRedemption('invalid-inviter');
  if (!hasMatchingVerifiedTarget(invite, recipient)) rejectRedemption('identity-mismatch');
  return inviterUid;
}

function normalizedTeamEntries(profile = {}) {
  const entries = new Map();
  const add = (teamId, teamName = null) => {
    const id = String(teamId || '').trim();
    if (!id || entries.has(id)) return;
    entries.set(id, String(teamName || '').trim() || id);
  };

  for (const link of Array.isArray(profile.parentOf) ? profile.parentOf : []) {
    add(link?.teamId, link?.teamName);
  }
  for (const team of Array.isArray(profile.teams) ? profile.teams : []) {
    add(team?.teamId || team?.id, team?.teamName || team?.name);
  }
  for (const teamId of Array.isArray(profile.parentTeamIds) ? profile.parentTeamIds : []) add(teamId);
  for (const teamId of Array.isArray(profile.discoveryTeamIds) ? profile.discoveryTeamIds : []) add(teamId);
  for (const teamId of Array.isArray(profile.coachOf) ? profile.coachOf : []) add(teamId);
  return entries;
}

function getSharedTeamContext(firstProfile = {}, secondProfile = {}) {
  const firstTeams = normalizedTeamEntries(firstProfile);
  const secondTeams = normalizedTeamEntries(secondProfile);
  const sharedTeamIds = [...firstTeams.keys()].filter((teamId) => secondTeams.has(teamId));
  return {
    sharedTeamIds,
    sharedTeamNames: sharedTeamIds.map((teamId) => firstTeams.get(teamId) || secondTeams.get(teamId) || teamId)
  };
}

function assertExistingFriendship(existingFriendship, inviterUid, recipientUid) {
  if (!existingFriendship) return;
  const status = String(existingFriendship.status || '').trim().toLowerCase();
  if (status === 'blocked') rejectRedemption('friendship-blocked');
  if (Object.prototype.hasOwnProperty.call(existingFriendship, 'blockedBy') &&
      (!Array.isArray(existingFriendship.blockedBy) || existingFriendship.blockedBy.length > 0)) {
    rejectRedemption('friendship-blocked');
  }

  const expectedMembers = [inviterUid, recipientUid].sort();
  const memberIds = Array.isArray(existingFriendship.memberIds)
    ? existingFriendship.memberIds.map(normalizeDocumentUid).filter(Boolean).sort()
    : [];
  const participantIds = [
    normalizeDocumentUid(existingFriendship.requesterId),
    normalizeDocumentUid(existingFriendship.recipientId)
  ].filter(Boolean).sort();
  if (memberIds.length !== 2 || participantIds.length !== 2 ||
      memberIds.join('\n') !== expectedMembers.join('\n') ||
      participantIds.join('\n') !== expectedMembers.join('\n')) {
    rejectRedemption('friendship-malformed');
  }
}

function buildAcceptedFriendship({
  inviterUid,
  recipientUid,
  invite,
  recipientProfile,
  existingFriendship,
  code,
  now
}) {
  const sharedTeams = getSharedTeamContext(invite.inviterProfile || {}, recipientProfile || {});
  return {
    requesterId: existingFriendship?.requesterId || inviterUid,
    recipientId: existingFriendship?.recipientId || recipientUid,
    memberIds: existingFriendship?.memberIds || [inviterUid, recipientUid].sort(),
    status: 'accepted',
    sharedTeamIds: sharedTeams.sharedTeamIds,
    sharedTeamNames: sharedTeams.sharedTeamNames,
    blockedBy: [],
    source: 'friend_invite',
    inviteCodeId: code,
    createdAt: existingFriendship?.createdAt || now,
    acceptedAt: now,
    respondedAt: now,
    updatedAt: now
  };
}

function getInviterName(profile = {}) {
  return String(profile.fullName || profile.displayName || profile.name || 'your friend').trim() || 'your friend';
}

function createFriendInviteRedemptionTransaction({ firestore, Timestamp, HttpsError, logger = console }) {
  if (!firestore || typeof firestore.doc !== 'function' || typeof firestore.runTransaction !== 'function') {
    throw new TypeError('firestore is required');
  }
  if (!Timestamp || typeof Timestamp.now !== 'function') throw new TypeError('Timestamp is required');
  if (typeof HttpsError !== 'function') throw new TypeError('HttpsError is required');

  function genericError() {
    return new HttpsError('permission-denied', FRIEND_INVITE_REDEMPTION_ERROR_MESSAGE);
  }

  return async function redeemFriendInviteTransaction({ code: rawCode, recipientIdentities } = {}) {
    try {
      const code = normalizeAccessCode(rawCode);
      if (!code) rejectRedemption('invalid-code');
      const recipient = getVerifiedRecipient(recipientIdentities);

      return await firestore.runTransaction(async (transaction) => {
        const inviteRef = firestore.doc(`accessCodes/${code}`);
        const inviteSnapshot = await transaction.get(inviteRef);
        const invite = inviteSnapshot.exists ? inviteSnapshot.data() || {} : null;
        const now = Timestamp.now();
        const nowMillis = getTimestampMillis(now);
        if (!Number.isFinite(nowMillis)) rejectRedemption('clock-unavailable');
        const inviterUid = assertActiveInvite(invite, code, recipient, nowMillis);

        const friendshipId = buildFriendshipId(inviterUid, recipient.uid);
        const friendshipRef = firestore.doc(`friendships/${friendshipId}`);
        const recipientRef = firestore.doc(`users/${recipient.uid}`);
        const friendshipSnapshot = await transaction.get(friendshipRef);
        const recipientSnapshot = await transaction.get(recipientRef);
        const existingFriendship = friendshipSnapshot.exists ? friendshipSnapshot.data() || {} : null;
        const recipientProfile = recipientSnapshot.exists ? recipientSnapshot.data() || {} : {};
        assertExistingFriendship(existingFriendship, inviterUid, recipient.uid);

        const acceptedFriendship = buildAcceptedFriendship({
          inviterUid,
          recipientUid: recipient.uid,
          invite,
          recipientProfile,
          existingFriendship,
          code,
          now
        });
        if (friendshipSnapshot.exists) transaction.update(friendshipRef, acceptedFriendship);
        else transaction.set(friendshipRef, acceptedFriendship);
        transaction.update(inviteRef, {
          used: true,
          usedBy: recipient.uid,
          usedAt: now
        });

        return {
          success: true,
          friendshipId,
          inviterName: getInviterName(invite.inviterProfile || {})
        };
      });
    } catch (error) {
      const expected = error instanceof FriendInviteRedemptionRejection;
      const log = expected ? logger.warn : logger.error;
      log?.call(logger, 'Friend invite redemption rejected.', {
        reason: expected ? error.reason : 'transaction-failed'
      });
      throw genericError();
    }
  };
}

module.exports = {
  FRIEND_INVITE_REDEMPTION_ERROR_MESSAGE,
  createFriendInviteRedemptionTransaction,
  extractVerifiedFriendInviteRecipientIdentities,
  normalizeVerifiedRecipientEmail,
  normalizeVerifiedRecipientPhone
};
