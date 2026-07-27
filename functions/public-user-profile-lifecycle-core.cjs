'use strict';

function normalizePublicProfileCleanupTeamId(value) {
  const teamId = String(value || '').trim();
  return teamId && !teamId.includes('/') ? teamId : '';
}

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

async function loadPublicProfileNotificationCleanupScope(firestore, userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return {
      recipientDocs: [],
      staffMembershipDocs: [],
      teamIds: []
    };
  }

  const [staffMembershipSnap, userSnap, recipientSnap] = await Promise.all([
    firestore.collection('publicProfileStaffMemberships')
      .where('userId', '==', normalizedUserId)
      .get(),
    firestore.doc(`users/${normalizedUserId}`).get(),
    firestore.collectionGroup('notificationRecipients')
      .where('uid', '==', normalizedUserId)
      .get()
  ]);
  const staffMembershipDocs = staffMembershipSnap.docs || [];
  const userData = userSnap.exists ? (userSnap.data() || {}) : {};
  const teamIds = new Set(
    (Array.isArray(userData.parentTeamIds) ? userData.parentTeamIds : [])
      .map(normalizePublicProfileCleanupTeamId)
      .filter(Boolean)
  );

  staffMembershipDocs.forEach((entry) => {
    const teamId = normalizePublicProfileCleanupTeamId(entry.data()?.teamId);
    if (teamId) teamIds.add(teamId);
  });
  (recipientSnap.docs || []).forEach((entry) => {
    const storedTeamId = normalizePublicProfileCleanupTeamId(entry.data()?.teamId);
    const pathTeamId = String(entry.ref?.path || '')
      .match(/^teams\/([^/]+)\/notificationRecipients\/[^/]+$/)?.[1];
    const teamId = storedTeamId
      || normalizePublicProfileCleanupTeamId(pathTeamId);
    if (teamId) teamIds.add(teamId);
  });

  return {
    recipientDocs: recipientSnap.docs || [],
    staffMembershipDocs,
    teamIds: [...teamIds]
  };
}

async function loadCaseInsensitivePublicProfileStaffTeamIds(
  firestore,
  { email, documentIdField, batchSize = 200 } = {}
) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return [];
  if (!documentIdField) throw new TypeError('documentIdField is required');

  const teamIds = new Set();
  let cursor = null;
  do {
    let query = firestore.collection('teams')
      .select('adminEmails')
      .orderBy(documentIdField)
      .limit(batchSize);
    if (cursor) query = query.startAfter(cursor);
    const teamSnap = await query.get();
    const teamDocs = teamSnap.docs || [];
    teamDocs.forEach((teamDoc) => {
      const team = teamDoc.data() || {};
      const adminEmails = (Array.isArray(team.adminEmails)
        ? team.adminEmails
        : [])
        .map((adminEmail) => String(adminEmail || '').trim().toLowerCase())
        .filter(Boolean);
      if (adminEmails.includes(normalizedEmail)) {
        teamIds.add(String(teamDoc.id || '').trim());
      }
    });
    cursor = teamDocs.at(-1) || null;
    if (teamDocs.length < batchSize) break;
  } while (cursor);

  return [...teamIds].filter(Boolean);
}

async function loadAuthoritativePublicProfileStaffTeamIds(
  firestore,
  { userId, email, queriedTeamIds = [] } = {}
) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return [];
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const teamIds = new Set(
    (Array.isArray(queriedTeamIds) ? queriedTeamIds : [])
      .map((teamId) => String(teamId || '').trim())
      .filter(Boolean)
  );
  const indexedTeamIds = await loadPublicProfileStaffTeamIds(firestore, normalizedUserId);
  await Promise.all(indexedTeamIds.map(async (teamId) => {
    const teamSnap = await firestore.doc(`teams/${teamId}`).get();
    if (!teamSnap.exists) return;
    const team = teamSnap.data() || {};
    const ownerId = String(team.ownerId || '').trim();
    const adminEmails = (Array.isArray(team.adminEmails) ? team.adminEmails : [])
      .map((adminEmail) => String(adminEmail || '').trim().toLowerCase())
      .filter(Boolean);
    if (
      ownerId === normalizedUserId ||
      (normalizedEmail && adminEmails.includes(normalizedEmail))
    ) {
      teamIds.add(teamId);
    }
  }));
  return [...teamIds];
}

async function reconcilePublicProfileStaffMembershipsForTeam({
  firestore,
  teamId,
  currentStaffUserIds = [],
  buildMembershipId,
  updatedAt
}) {
  if (!firestore || typeof buildMembershipId !== 'function') {
    throw new TypeError('firestore and buildMembershipId are required');
  }
  const normalizedTeamId = String(teamId || '').trim();
  if (!normalizedTeamId) return [];

  const existingSnap = await firestore.collection('publicProfileStaffMemberships')
    .where('teamId', '==', normalizedTeamId)
    .get();
  const desiredById = new Map();
  const candidateUserIds = new Set();
  [...new Set(currentStaffUserIds
    .map((userId) => String(userId || '').trim())
    .filter(Boolean))]
    .forEach((userId) => {
      const membershipId = buildMembershipId(normalizedTeamId, userId);
      if (!membershipId) return;
      candidateUserIds.add(userId);
      desiredById.set(membershipId, {
        teamId: normalizedTeamId,
        userId
      });
    });

  for (const existingDoc of existingSnap.docs || []) {
    const existing = existingDoc.data() || {};
    const existingUserId = String(existing.userId || '').trim();
    if (existingUserId) candidateUserIds.add(existingUserId);
    const desired = desiredById.get(existingDoc.id);
    if (
      desired &&
      existing.teamId === desired.teamId &&
      existingUserId === desired.userId
    ) {
      desiredById.delete(existingDoc.id);
      continue;
    }
    await existingDoc.ref.delete();
  }

  for (const [membershipId, membership] of desiredById) {
    await firestore.doc(`publicProfileStaffMemberships/${membershipId}`).set({
      ...membership,
      ...(updatedAt !== undefined ? { updatedAt } : {})
    });
  }

  return [...candidateUserIds];
}

async function reconcilePublicProfileStaffMembershipsForUser({
  firestore,
  userId,
  currentStaffTeamIds = [],
  buildMembershipId,
  updatedAt
}) {
  if (!firestore || typeof buildMembershipId !== 'function') {
    throw new TypeError('firestore and buildMembershipId are required');
  }
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return [];

  const existingSnap = await firestore.collection('publicProfileStaffMemberships')
    .where('userId', '==', normalizedUserId)
    .get();
  const desiredById = new Map();
  const candidateTeamIds = new Set();
  [...new Set(currentStaffTeamIds
    .map((teamId) => String(teamId || '').trim())
    .filter(Boolean))]
    .forEach((teamId) => {
      const membershipId = buildMembershipId(teamId, normalizedUserId);
      if (!membershipId) return;
      candidateTeamIds.add(teamId);
      desiredById.set(membershipId, {
        teamId,
        userId: normalizedUserId
      });
    });

  for (const existingDoc of existingSnap.docs || []) {
    const existing = existingDoc.data() || {};
    const existingTeamId = String(existing.teamId || '').trim();
    if (existingTeamId) candidateTeamIds.add(existingTeamId);
    const desired = desiredById.get(existingDoc.id);
    if (
      desired &&
      existingTeamId === desired.teamId &&
      existing.userId === desired.userId
    ) {
      desiredById.delete(existingDoc.id);
      continue;
    }
    await existingDoc.ref.delete();
  }

  for (const [membershipId, membership] of desiredById) {
    await firestore.doc(`publicProfileStaffMemberships/${membershipId}`).set({
      ...membership,
      ...(updatedAt !== undefined ? { updatedAt } : {})
    });
  }

  return [...candidateTeamIds];
}

function createPublicProfileTeamWriteHandler({ firestore, syncTeam }) {
  if (!firestore || typeof syncTeam !== 'function') {
    throw new TypeError('firestore and syncTeam are required');
  }

  return async function syncCurrentPublicProfileTeam(change, context) {
    const teamId = String(context?.params?.teamId || '').trim();
    if (!teamId) return null;
    const currentTeamSnap = await firestore.doc(`teams/${teamId}`).get();
    const beforeTeam = change?.before?.exists ? (change.before.data() || {}) : null;
    const currentTeam = currentTeamSnap.exists ? (currentTeamSnap.data() || {}) : null;
    await syncTeam(teamId, beforeTeam, currentTeam);
    return null;
  };
}

function createPublicProfileAuthDeleteHandler({ firestore, syncAffectedTeam }) {
  if (!firestore) throw new TypeError('firestore is required');

  return async function cleanupPublicProfileOnAuthDelete(user) {
    const userId = String(user?.uid || '').trim();
    if (!userId) return null;

    const cleanupScope = await loadPublicProfileNotificationCleanupScope(
      firestore,
      userId
    );
    const publicProfileRef = firestore.doc(`publicUserProfiles/${userId}`);
    const cleanupRefs = [
      firestore.doc(`publicProfileAuthIdentities/${userId}`),
      ...cleanupScope.staffMembershipDocs.map((entry) => entry.ref)
    ];
    if (typeof syncAffectedTeam === 'function') {
      await Promise.all(
        cleanupScope.teamIds.map((teamId) => syncAffectedTeam(teamId, userId))
      );
    }
    // Keep the projection and staff index as the retry anchor until all
    // notification recipients have been removed. Auth deletion does not have
    // an application-level retry guarantee, while the scheduled sweep can
    // recover any failure that leaves this projection in place.
    await Promise.all(cleanupRefs.map((ref) => ref.delete()));
    await publicProfileRef.delete();
    return null;
  };
}

function createPublicProfileEligibilitySweepHandler({
  firestore,
  auth,
  documentIdField,
  isAuthUserNotFound,
  reconcileAuthIdentity,
  syncReconciledIdentity,
  syncEligibleProfile,
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
            authIdentity = {
              email: authRecord.email || null,
              displayName: authRecord.displayName || null,
              photoUrl: authRecord.photoURL || null,
              emailVerified: authRecord.emailVerified === true
            };
          } catch (error) {
            if (!isAuthUserNotFound(error)) throw error;
            authIdentity = { userMissing: true };
          }
          const reconciledIdentity = typeof reconcileAuthIdentity === 'function'
            ? await reconcileAuthIdentity(profileDoc.id, authIdentity)
            : undefined;
          if (
            reconciledIdentity
            && typeof syncReconciledIdentity === 'function'
          ) {
            await syncReconciledIdentity(profileDoc.id, authIdentity, reconciledIdentity);
          }
          const removed = await removePublicProfileForIneligibleAuth(profileDoc.ref, authIdentity);
          if (removed) return true;
          if (typeof syncEligibleProfile === 'function') {
            await syncEligibleProfile(profileDoc.id, authIdentity, reconciledIdentity);
          }
          return false;
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
  createPublicProfileTeamWriteHandler,
  loadAuthoritativePublicProfileStaffTeamIds,
  loadCaseInsensitivePublicProfileStaffTeamIds,
  loadPublicProfileNotificationCleanupScope,
  loadPublicProfileStaffTeamIds,
  reconcilePublicProfileStaffMembershipsForTeam,
  reconcilePublicProfileStaffMembershipsForUser,
  resolvePublicProfileStaffUserIds,
  removePublicProfileForIneligibleAuth
};
