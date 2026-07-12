'use strict';

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

module.exports = { findOwnedInviteCode };
