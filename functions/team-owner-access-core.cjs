function createTeamOwnerAccessSyncHandler({ firestore, fieldValue }) {
  if (!firestore || !fieldValue) {
    throw new Error('Firestore and FieldValue are required.');
  }

  return async function syncTeamOwnerAccess(snapshot, context) {
    const teamId = String(context?.params?.teamId || snapshot?.id || '').trim();
    const team = snapshot?.data?.() || {};
    const ownerId = String(team.ownerId || '').trim();

    if (!teamId || !ownerId) {
      return null;
    }

    await firestore.doc(`users/${ownerId}`).set({
      coachOf: fieldValue.arrayUnion(teamId),
      roles: fieldValue.arrayUnion('coach'),
      updatedAt: fieldValue.serverTimestamp()
    }, { merge: true });

    return { ownerId, teamId };
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function createLegacyTeamOwnerAuthSyncHandler({ firestore, fieldValue }) {
  if (!firestore || !fieldValue) {
    throw new Error('Firestore and FieldValue are required.');
  }

  return async function syncLegacyTeamOwnerOnAuthCreate(authUser) {
    const ownerId = String(authUser?.uid || '').trim();
    const rawEmail = String(authUser?.email || '').trim();
    const normalizedEmail = normalizeEmail(rawEmail);
    if (!ownerId || !normalizedEmail || authUser?.disabled === true) return null;

    const ownerEmailCandidates = [...new Set([rawEmail, normalizedEmail].filter(Boolean))];
    const snapshots = await Promise.all([
      firestore.collection('teams').where('ownerEmailLower', '==', normalizedEmail).get(),
      ...ownerEmailCandidates.map((email) => (
        firestore.collection('teams').where('ownerEmail', '==', email).get()
      ))
    ]);
    const candidates = new Map();
    snapshots.forEach((snapshot) => (snapshot.docs || []).forEach((teamDoc) => {
      if (teamDoc?.id && teamDoc?.ref) candidates.set(teamDoc.id, teamDoc.ref);
    }));

    const boundTeamIds = new Set();
    for (const [teamId, teamRef] of candidates) {
      await firestore.runTransaction(async (transaction) => {
        const current = await transaction.get(teamRef);
        if (!current.exists) return;
        const team = current.data() || {};
        if (String(team.ownerId || '').trim()) return;
        const ownerEmails = [...new Set(
          [team.ownerEmailLower, team.ownerEmail].map(normalizeEmail).filter(Boolean)
        )];
        if (ownerEmails.length !== 1 || ownerEmails[0] !== normalizedEmail) return;

        transaction.update(teamRef, {
          ownerId,
          ownerIdBackfilledAt: fieldValue.serverTimestamp()
        });
        transaction.set(firestore.doc(`users/${ownerId}`), {
          coachOf: fieldValue.arrayUnion(teamId),
          roles: fieldValue.arrayUnion('coach'),
          updatedAt: fieldValue.serverTimestamp()
        }, { merge: true });
        boundTeamIds.add(teamId);
      });
    }

    return { ownerId, teamIds: [...boundTeamIds].sort() };
  };
}

function isAuthUserNotFound(error) {
  return ['auth/user-not-found', 'user-not-found'].includes(String(error?.code || ''));
}

function createLegacyTeamOwnerReconciliationHandler({
  firestore,
  auth,
  documentIdField,
  syncAuthUser,
  batchSize = 200,
  concurrency = 20
}) {
  if (!firestore || !auth || !documentIdField || typeof syncAuthUser !== 'function') {
    throw new Error('Firestore, Auth, documentIdField, and syncAuthUser are required.');
  }

  return async function reconcileLegacyTeamOwners() {
    const resolvedDocumentIdField = typeof documentIdField === 'function'
      ? documentIdField()
      : documentIdField;
    const candidateAliases = new Set();
    let cursor = null;
    let scanned = 0;
    do {
      let query = firestore.collection('teams')
        .select('ownerId', 'ownerEmail', 'ownerEmailLower')
        .orderBy(resolvedDocumentIdField)
        .limit(batchSize);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      const teamDocs = snapshot.docs || [];
      teamDocs.forEach((teamDoc) => {
        scanned += 1;
        const team = teamDoc.data() || {};
        if (String(team.ownerId || '').trim()) return;
        const aliases = [...new Set(
          [team.ownerEmailLower, team.ownerEmail].map(normalizeEmail).filter(Boolean)
        )];
        if (aliases.length === 1) candidateAliases.add(aliases[0]);
      });
      cursor = teamDocs.at(-1) || null;
      if (teamDocs.length < batchSize) break;
    } while (cursor);

    const resolvedUsers = new Map();
    const aliases = [...candidateAliases];
    for (let index = 0; index < aliases.length; index += concurrency) {
      const chunk = aliases.slice(index, index + concurrency);
      const users = await Promise.all(chunk.map(async (email) => {
        try {
          return await auth.getUserByEmail(email);
        } catch (error) {
          if (isAuthUserNotFound(error)) return null;
          throw error;
        }
      }));
      users.forEach((authUser) => {
        const uid = String(authUser?.uid || '').trim();
        if (uid && authUser?.disabled !== true) resolvedUsers.set(uid, authUser);
      });
    }

    const boundTeamIds = new Set();
    for (const authUser of resolvedUsers.values()) {
      const result = await syncAuthUser(authUser);
      (result?.teamIds || []).forEach((teamId) => boundTeamIds.add(teamId));
    }
    return {
      scanned,
      candidateAliases: aliases.length,
      resolvedUsers: resolvedUsers.size,
      boundTeamIds: [...boundTeamIds].sort()
    };
  };
}

module.exports = {
  createLegacyTeamOwnerAuthSyncHandler,
  createLegacyTeamOwnerReconciliationHandler,
  createTeamOwnerAccessSyncHandler
};
