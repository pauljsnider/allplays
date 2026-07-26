'use strict';

const { hasTeamAdminAccess } = require('./team-admin-access-core.cjs');

function isAllowedInviteType(data, allowedTypes) {
  return allowedTypes.has(String(data?.type || '').trim().toLowerCase());
}

async function findInviteCode({ firestore, code, allowedTypes }) {
  const directSnap = await firestore.doc(`accessCodes/${code}`).get();
  if (directSnap.exists) {
    const directData = directSnap.data() || {};
    if (isAllowedInviteType(directData, allowedTypes)) {
      return { id: directSnap.id, data: directData };
    }
  }

  const querySnap = await firestore.collection('accessCodes').where('code', '==', code).limit(10).get();
  const matched = querySnap.docs.find((docSnap) => isAllowedInviteType(docSnap.data() || {}, allowedTypes));
  return matched ? { id: matched.id, data: matched.data() || {} } : null;
}

async function findOwnedInviteCode({ firestore, code, uid, allowedTypes }) {
  const normalizedUid = String(uid || '').trim();
  const directSnap = await firestore.doc(`accessCodes/${code}`).get();
  if (directSnap.exists) {
    const directData = directSnap.data() || {};
    if (allowedTypes.has(String(directData.type || '').trim().toLowerCase()) &&
        String(directData.generatedBy || '').trim() === normalizedUid) {
      return { id: directSnap.id, data: directData };
    }
  }

  const querySnap = await firestore.collection('accessCodes').where('code', '==', code).limit(10).get();
  const owned = querySnap.docs.find((docSnap) => {
    const candidate = docSnap.data() || {};
    return allowedTypes.has(String(candidate.type || '').trim().toLowerCase()) &&
      String(candidate.generatedBy || '').trim() === normalizedUid;
  });
  return owned ? { id: owned.id, data: owned.data() || {} } : null;
}

function canQueueInviteEmailForCaller({ invite = {}, team = null, user = {}, uid, email }) {
  const normalizedUid = String(uid || '').trim();
  const inviteType = String(invite.type || '').trim().toLowerCase();
  if (inviteType === 'parent_invite') {
    if (!String(invite.teamId || '').trim() || !team) return false;
    return hasTeamAdminAccess({ team, user, uid: normalizedUid, email });
  }
  return String(invite.generatedBy || '').trim() === normalizedUid;
}

function getInviteExpirationMillis(expiresAt) {
  if (!expiresAt) return null;
  if (typeof expiresAt.toMillis === 'function') return expiresAt.toMillis();
  if (expiresAt instanceof Date) return expiresAt.getTime();
  if (Number.isFinite(Number(expiresAt))) return Number(expiresAt);
  if (Number.isFinite(Number(expiresAt._seconds))) return Number(expiresAt._seconds) * 1000;
  const parsed = new Date(expiresAt).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isInviteEmailDeliveryEligible(invite = {}, now = Date.now()) {
  if (invite.revoked === true || invite.active === false) return false;
  const status = String(invite.status || '').trim().toLowerCase();
  if (['cancelled', 'expired', 'removed', 'revoked'].includes(status)) return false;

  const inviteType = String(invite.type || '').trim().toLowerCase();
  const isLinkedParent = inviteType === 'parent_invite'
    && invite.used === true
    && status === 'accepted'
    && Boolean(String(invite.usedBy || '').trim());
  if (isLinkedParent) return true;
  if (invite.used === true || status === 'accepted') return false;

  const expiresAtMillis = getInviteExpirationMillis(invite.expiresAt);
  return expiresAtMillis == null || expiresAtMillis > now;
}

module.exports = {
  canQueueInviteEmailForCaller,
  findInviteCode,
  findOwnedInviteCode,
  isInviteEmailDeliveryEligible
};
