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

async function mapWithConcurrencyLimit(items, limit, worker) {
  const values = Array.from(items || []);
  const results = new Array(values.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(
    Number.isInteger(limit) && limit > 0 ? limit : 1,
    values.length || 1
  ));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index], index);
    }
  }));
  return results;
}

function createLegacyTeamOwnerReconciliationHandler({
  firestore,
  auth,
  documentIdField,
  syncAuthUser,
  checkpointRef = null,
  batchSize = 200,
  concurrency = 20,
  maxPages = 5
}) {
  if (!firestore || !auth || !documentIdField || typeof syncAuthUser !== 'function') {
    throw new Error('Firestore, Auth, documentIdField, and syncAuthUser are required.');
  }

  return async function reconcileLegacyTeamOwners() {
    const resolvedDocumentIdField = typeof documentIdField === 'function'
      ? documentIdField()
      : documentIdField;
    const reconciliationCheckpointRef = checkpointRef
      || firestore.doc('systemJobs/legacyTeamOwnerReconciliation');
    const checkpointSnap = await reconciliationCheckpointRef.get();
    let cursorTeamId = checkpointSnap.exists
      ? String(checkpointSnap.data()?.cursorTeamId || '').trim()
      : '';
    let scanned = 0;
    let candidateAliasCount = 0;
    let resolvedUserCount = 0;
    let pagesProcessed = 0;
    let cycleComplete = false;
    const boundTeamIds = new Set();
    const safeMaxPages = Number.isInteger(maxPages) && maxPages > 0 ? maxPages : 1;

    while (pagesProcessed < safeMaxPages) {
      let query = firestore.collection('teams')
        .select('ownerId', 'ownerEmail', 'ownerEmailLower')
        .orderBy(resolvedDocumentIdField)
        .limit(batchSize);
      if (cursorTeamId) query = query.startAfter(cursorTeamId);
      const snapshot = await query.get();
      const teamDocs = snapshot.docs || [];
      if (!teamDocs.length) {
        await reconciliationCheckpointRef.delete();
        cursorTeamId = '';
        cycleComplete = true;
        break;
      }

      const candidateAliases = new Set();
      teamDocs.forEach((teamDoc) => {
        scanned += 1;
        const team = teamDoc.data() || {};
        if (String(team.ownerId || '').trim()) return;
        const aliases = [...new Set(
          [team.ownerEmailLower, team.ownerEmail].map(normalizeEmail).filter(Boolean)
        )];
        if (aliases.length === 1) candidateAliases.add(aliases[0]);
      });
      const aliases = [...candidateAliases];
      candidateAliasCount += aliases.length;
      const authUsers = await mapWithConcurrencyLimit(aliases, concurrency, async (email) => {
        try {
          return await auth.getUserByEmail(email);
        } catch (error) {
          if (isAuthUserNotFound(error)) return null;
          throw error;
        }
      });
      const resolvedUsers = new Map();
      authUsers.forEach((authUser) => {
        const uid = String(authUser?.uid || '').trim();
        if (uid && authUser?.disabled !== true) resolvedUsers.set(uid, authUser);
      });
      resolvedUserCount += resolvedUsers.size;

      const syncResults = await mapWithConcurrencyLimit(
        resolvedUsers.values(),
        concurrency,
        (authUser) => syncAuthUser(authUser)
      );
      syncResults.forEach((result) => {
        (result?.teamIds || []).forEach((teamId) => boundTeamIds.add(teamId));
      });

      pagesProcessed += 1;
      cursorTeamId = String(teamDocs.at(-1)?.id || '').trim();
      if (teamDocs.length < batchSize) {
        await reconciliationCheckpointRef.delete();
        cursorTeamId = '';
        cycleComplete = true;
        break;
      }
      await reconciliationCheckpointRef.set({
        cursorTeamId,
        version: 1
      }, { merge: true });
    }

    return {
      scanned,
      candidateAliases: candidateAliasCount,
      resolvedUsers: resolvedUserCount,
      boundTeamIds: [...boundTeamIds].sort(),
      pagesProcessed,
      cursorTeamId: cursorTeamId || null,
      cycleComplete
    };
  };
}

module.exports = {
  createLegacyTeamOwnerAuthSyncHandler,
  createLegacyTeamOwnerReconciliationHandler,
  createTeamOwnerAccessSyncHandler
};
