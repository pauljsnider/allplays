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
    if (!ownerId || !normalizedEmail) return null;

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
        const ownerEmails = [team.ownerEmailLower, team.ownerEmail].map(normalizeEmail).filter(Boolean);
        if (!ownerEmails.includes(normalizedEmail)) return;

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

module.exports = {
  createLegacyTeamOwnerAuthSyncHandler,
  createTeamOwnerAccessSyncHandler
};
