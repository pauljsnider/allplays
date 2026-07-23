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

module.exports = {
  createTeamOwnerAccessSyncHandler
};
