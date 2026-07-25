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
  if (String(invite.generatedBy || '').trim() === normalizedUid) return true;
  if (String(invite.type || '').trim().toLowerCase() !== 'parent_invite') return false;
  if (!String(invite.teamId || '').trim() || !team) return false;
  return hasTeamAdminAccess({ team, user, uid: normalizedUid, email });
}

module.exports = {
  canQueueInviteEmailForCaller,
  findInviteCode,
  findOwnedInviteCode
};
