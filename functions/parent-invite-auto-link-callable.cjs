'use strict';

const { hasTeamAdminAccess } = require('./team-admin-access-core.cjs');
const {
  normalizeParentInviteEmail,
  appendUniqueParentLink,
  appendUniqueValue,
  buildAutoAcceptedParentLink
} = require('./parent-invite-auto-link-core.cjs');

function createAutoAcceptParentInviteHandler({
  firestore,
  Timestamp,
  HttpsError,
  normalizeFirestoreId,
  validateCode
}) {
  return async function autoAcceptParentInviteForExistingUser(data, context = {}) {
    if (!context.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in before auto-linking a parent invite.');
    }

    const codeId = normalizeFirestoreId(data?.codeId, 'codeId');
    const codeRef = firestore.doc(`accessCodes/${codeId}`);
    const codeSnap = await codeRef.get();
    if (!codeSnap.exists) {
      throw new HttpsError('not-found', 'Parent invite could not be found.');
    }

    const codeData = codeSnap.data() || {};
    validateCode(codeData);
    const inviteEmail = normalizeParentInviteEmail(codeData.email);
    if (!inviteEmail) {
      throw new HttpsError('failed-precondition', 'Parent invite has no email to auto-link.');
    }

    const teamId = normalizeFirestoreId(codeData.teamId, 'teamId');
    const playerId = normalizeFirestoreId(codeData.playerId, 'playerId');
    const [teamSnap, playerSnap, actorSnap, userQuerySnap] = await Promise.all([
      firestore.doc(`teams/${teamId}`).get(),
      firestore.doc(`teams/${teamId}/players/${playerId}`).get(),
      firestore.doc(`users/${context.auth.uid}`).get(),
      firestore.collection('users').where('email', '==', inviteEmail).limit(1).get()
    ]);

    if (!teamSnap.exists) {
      throw new HttpsError('not-found', 'Team not found.');
    }
    if (!playerSnap.exists) {
      throw new HttpsError('not-found', 'Player not found.');
    }
    if (userQuerySnap.empty) {
      return { autoLinked: false, existingUser: false, reason: 'no-existing-user' };
    }

    const team = teamSnap.data() || {};
    const actor = actorSnap.exists ? actorSnap.data() || {} : {};
    const actorEmail = context.auth.token?.email || actor.email || '';
    if (!hasTeamAdminAccess({ team, user: actor, uid: context.auth.uid, email: actorEmail })) {
      throw new HttpsError('permission-denied', 'Only team owners and admins can auto-link parent invites.');
    }

    const targetUserDoc = userQuerySnap.docs[0];
    const userRef = targetUserDoc.ref;
    const now = Timestamp.now();

    await firestore.runTransaction(async (transaction) => {
      const playerRef = firestore.doc(`teams/${teamId}/players/${playerId}`);
      const [latestCodeSnap, latestPlayerSnap, latestUserSnap] = await Promise.all([
        transaction.get(codeRef),
        transaction.get(playerRef),
        transaction.get(userRef)
      ]);

      if (!latestCodeSnap.exists) {
        throw new HttpsError('not-found', 'Parent invite could not be found.');
      }
      if (!latestPlayerSnap.exists) {
        throw new HttpsError('not-found', 'Player not found.');
      }
      if (!latestUserSnap.exists) {
        throw new HttpsError('not-found', 'Existing parent user not found.');
      }

      const latestCodeData = latestCodeSnap.data() || {};
      validateCode(latestCodeData);
      if (normalizeParentInviteEmail(latestCodeData.email) !== inviteEmail) {
        throw new HttpsError('failed-precondition', 'Parent invite email changed before auto-linking.');
      }

      const latestUserData = latestUserSnap.data() || {};
      if (normalizeParentInviteEmail(latestUserData.email) !== inviteEmail) {
        throw new HttpsError('failed-precondition', 'Existing parent email does not match the invite.');
      }

      const player = latestPlayerSnap.data() || {};
      const parentLink = buildAutoAcceptedParentLink({ codeData: latestCodeData, team, player });
      const playerKey = `${teamId}::${playerId}`;
      transaction.update(userRef, {
        parentOf: appendUniqueParentLink(latestUserData.parentOf, parentLink),
        parentTeamIds: appendUniqueValue(latestUserData.parentTeamIds, teamId),
        parentPlayerKeys: appendUniqueValue(latestUserData.parentPlayerKeys, playerKey),
        roles: appendUniqueValue(latestUserData.roles, 'parent')
      });

      const playerData = latestPlayerSnap.data() || {};
      const existingParents = Array.isArray(playerData.parents) ? [...playerData.parents] : [];
      const alreadyLinked = existingParents.some((parent) => parent?.userId === userRef.id);
      if (!alreadyLinked) {
        existingParents.push({
          userId: userRef.id,
          email: inviteEmail,
          relation: latestCodeData.relation || null,
          addedAt: now,
          status: 'active',
          source: 'parent_invite'
        });
        transaction.update(latestPlayerSnap.ref, { parents: existingParents });
      }

      transaction.update(codeRef, {
        used: true,
        usedBy: userRef.id,
        usedAt: now,
        status: 'accepted',
        autoAccepted: true,
        autoAcceptedAt: now
      });
    });

    return { autoLinked: true, existingUser: true, userId: userRef.id };
  };
}

module.exports = { createAutoAcceptParentInviteHandler };
