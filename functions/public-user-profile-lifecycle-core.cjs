'use strict';

async function removePublicProfileForIneligibleAuth(publicProfileRef, authIdentity = {}) {
  if (authIdentity.userMissing !== true && authIdentity.emailVerified === true) {
    return false;
  }
  await publicProfileRef.delete();
  return true;
}

async function resolvePublicProfileStaffUserIds(
  team,
  { getUserByEmail, isAuthUserNotFound }
) {
  if (!team) return [];
  const userIds = new Set();
  const ownerId = String(team.ownerId || '').trim();
  if (ownerId) userIds.add(ownerId);
  const normalizedAdminEmails = [...new Set(
    (Array.isArray(team.adminEmails) ? team.adminEmails : [])
      .map((email) => String(email || '').trim().toLowerCase())
      .filter(Boolean)
  )];
  const adminUserIds = await Promise.all(normalizedAdminEmails.map(async (email) => {
    try {
      return (await getUserByEmail(email)).uid;
    } catch (error) {
      if (isAuthUserNotFound(error)) return null;
      throw error;
    }
  }));
  adminUserIds.filter(Boolean).forEach((userId) => userIds.add(userId));
  return [...userIds];
}

async function loadPublicProfileStaffTeamIds(firestore, userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return [];
  const staffMembershipSnap = await firestore.collection('publicProfileStaffMemberships')
    .where('userId', '==', normalizedUserId)
    .get();
  return [...new Set((staffMembershipSnap.docs || [])
    .map((entry) => String(entry.data()?.teamId || '').trim())
    .filter(Boolean))];
}

function createPublicProfileAuthDeleteHandler({ firestore }) {
  if (!firestore) throw new TypeError('firestore is required');

  return async function cleanupPublicProfileOnAuthDelete(user) {
    const userId = String(user?.uid || '').trim();
    if (!userId) return null;

    const [staffMembershipSnap] = await Promise.all([
      firestore.collection('publicProfileStaffMemberships')
        .where('userId', '==', userId)
        .get()
    ]);
    const refs = [
      firestore.doc(`publicUserProfiles/${userId}`),
      ...(staffMembershipSnap.docs || []).map((entry) => entry.ref)
    ];
    await Promise.all(refs.map((ref) => ref.delete()));
    return null;
  };
}

function createPublicProfileEligibilitySweepHandler({
  firestore,
  auth,
  documentIdField,
  isAuthUserNotFound,
  batchSize = 200,
  concurrency = 20
}) {
  if (!firestore || !auth) throw new TypeError('firestore and auth are required');

  return async function sweepPublicProfileEligibility() {
    let cursor = null;
    let scanned = 0;
    let removed = 0;
    do {
      let query = firestore.collection('publicUserProfiles')
        .orderBy(documentIdField)
        .limit(batchSize);
      if (cursor) query = query.startAfter(cursor);
      const profileSnap = await query.get();
      const profileDocs = profileSnap.docs || [];

      for (let index = 0; index < profileDocs.length; index += concurrency) {
        const chunk = profileDocs.slice(index, index + concurrency);
        const results = await Promise.all(chunk.map(async (profileDoc) => {
          let authIdentity;
          try {
            const authRecord = await auth.getUser(profileDoc.id);
            authIdentity = { emailVerified: authRecord.emailVerified === true };
          } catch (error) {
            if (!isAuthUserNotFound(error)) throw error;
            authIdentity = { userMissing: true };
          }
          return removePublicProfileForIneligibleAuth(profileDoc.ref, authIdentity);
        }));
        removed += results.filter(Boolean).length;
      }

      scanned += profileDocs.length;
      cursor = profileDocs.at(-1) || null;
      if (profileDocs.length < batchSize) break;
    } while (cursor);

    return { scanned, removed };
  };
}

module.exports = {
  createPublicProfileAuthDeleteHandler,
  createPublicProfileEligibilitySweepHandler,
  loadPublicProfileStaffTeamIds,
  resolvePublicProfileStaffUserIds,
  removePublicProfileForIneligibleAuth
};
