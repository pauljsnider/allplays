'use strict';

const { hasAdminInviteIssuerAccess } = require('./team-admin-access-core.cjs');
const {
  appendUniqueParentLink,
  appendUniqueValue,
  buildAutoAcceptedParentLink,
  normalizeParentInviteEmail
} = require('./parent-invite-auto-link-core.cjs');
const { resolveAuthenticatedFamilyInviteEmail } = require('./family-invite-identity-core.cjs');

const ISSUER_ACCESS_ERROR = 'The parent invite issuer no longer has access to this team.';

function normalizeStoredUid(value) {
  if (typeof value !== 'string') return '';
  const uid = value.trim();
  return uid && uid.length <= 128 && !uid.includes('/') ? uid : '';
}

function isInviteExpired(expiresAt, nowMillis) {
  if (!expiresAt) return false;
  const millis = typeof expiresAt.toMillis === 'function'
    ? expiresAt.toMillis()
    : new Date(expiresAt).getTime();
  return Number.isFinite(millis) && millis < nowMillis;
}

function assertRecipientEmail(codeData, signedInEmail, HttpsError) {
  const invitedEmail = normalizeParentInviteEmail(codeData?.email);
  if (invitedEmail && !signedInEmail) {
    throw new HttpsError(
      'permission-denied',
      'Verify your email before accepting this family invite.',
      { reason: 'email-verification-required' }
    );
  }
  if (invitedEmail && invitedEmail !== signedInEmail) {
    throw new HttpsError(
      'permission-denied',
      `This invite was sent to ${invitedEmail}. Sign in with that email to accept it.`
    );
  }
}

function createRedeemParentInviteHandler({
  firestore,
  getAuthUser,
  getTimestamp,
  arrayUnion,
  HttpsError,
  normalizeFirestoreId,
  buildPublicProfilePayload,
  nowMillis = () => Date.now()
}) {
  return async function redeemParentInvite(data, context = {}) {
    if (!context.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in before accepting a parent invite.');
    }

    const userId = normalizeFirestoreId(data?.userId || context.auth.uid, 'userId');
    if (userId !== context.auth.uid) {
      throw new HttpsError('permission-denied', 'You can only accept an invite for your own account.');
    }

    const code = String(data?.code || '').trim().toUpperCase();
    if (!code) {
      throw new HttpsError('invalid-argument', 'Access code is required.');
    }

    const signedInEmail = await resolveAuthenticatedFamilyInviteEmail({
      auth: context.auth,
      getUser: getAuthUser
    });
    const codeQuerySnap = await firestore.collection('accessCodes').where('code', '==', code).limit(1).get();
    if (codeQuerySnap.empty) {
      throw new HttpsError('not-found', 'Parent invite could not be found.');
    }

    const codeRef = codeQuerySnap.docs[0].ref;
    assertRecipientEmail(codeQuerySnap.docs[0].data() || {}, signedInEmail, HttpsError);
    let responsePayload = null;

    await firestore.runTransaction(async (transaction) => {
      const latestCodeSnap = await transaction.get(codeRef);
      if (!latestCodeSnap.exists) {
        throw new HttpsError('not-found', 'Parent invite could not be found.');
      }

      const codeData = latestCodeSnap.data() || {};
      if (codeData.type !== 'parent_invite') {
        throw new HttpsError('failed-precondition', 'Not a parent invite code.');
      }
      if (codeData.used || codeData.revoked === true || codeData.status === 'removed') {
        throw new HttpsError('failed-precondition', 'Parent invite is no longer available.');
      }
      if (isInviteExpired(codeData.expiresAt, nowMillis())) {
        throw new HttpsError('failed-precondition', 'Parent invite has expired.');
      }

      assertRecipientEmail(codeData, signedInEmail, HttpsError);
      const issuerUid = normalizeStoredUid(codeData.generatedBy);
      if (!issuerUid) {
        throw new HttpsError('permission-denied', ISSUER_ACCESS_ERROR);
      }

      const teamId = normalizeFirestoreId(codeData.teamId, 'teamId');
      const playerId = normalizeFirestoreId(codeData.playerId, 'playerId');
      const userRef = firestore.doc(`users/${userId}`);
      const issuerRef = firestore.doc(`users/${issuerUid}`);
      const teamRef = firestore.doc(`teams/${teamId}`);
      const playerRef = firestore.doc(`teams/${teamId}/players/${playerId}`);
      const privateProfileRef = firestore.doc(`teams/${teamId}/players/${playerId}/private/profile`);
      const publicProfileRef = firestore.doc(`publicUserProfiles/${userId}`);

      const [teamSnap, playerSnap, userSnap, issuerSnap, issuerAuthUser] = await Promise.all([
        transaction.get(teamRef),
        transaction.get(playerRef),
        transaction.get(userRef),
        transaction.get(issuerRef),
        Promise.resolve().then(() => getAuthUser(issuerUid)).catch(() => null)
      ]);

      if (!teamSnap.exists) {
        throw new HttpsError('not-found', 'Team not found.');
      }
      if (!playerSnap.exists) {
        throw new HttpsError('not-found', 'Player not found.');
      }

      const team = { id: teamSnap.id, ...(teamSnap.data() || {}) };
      const issuerData = issuerSnap.exists ? issuerSnap.data() || {} : {};
      if (!hasAdminInviteIssuerAccess({
        team,
        user: issuerData,
        uid: issuerUid,
        authUser: issuerAuthUser
      })) {
        throw new HttpsError('permission-denied', ISSUER_ACCESS_ERROR);
      }

      const player = { id: playerSnap.id, ...(playerSnap.data() || {}) };
      const userData = userSnap.exists ? userSnap.data() || {} : {};
      const parentLink = buildAutoAcceptedParentLink({ codeData: { ...codeData, teamId, playerId }, team, player });
      const playerKey = `${teamId}::${playerId}`;
      const now = getTimestamp();
      const nextUserData = {
        ...userData,
        parentOf: appendUniqueParentLink(userData.parentOf, parentLink),
        parentTeamIds: appendUniqueValue(userData.parentTeamIds, teamId),
        parentPlayerKeys: appendUniqueValue(userData.parentPlayerKeys, playerKey),
        roles: appendUniqueValue(userData.roles, 'parent')
      };

      transaction.set(userRef, {
        parentOf: nextUserData.parentOf,
        parentTeamIds: nextUserData.parentTeamIds,
        parentPlayerKeys: nextUserData.parentPlayerKeys,
        roles: nextUserData.roles
      }, { merge: true });
      transaction.set(publicProfileRef, buildPublicProfilePayload(nextUserData, {
        trustedEmail: signedInEmail || null
      }), { merge: true });
      transaction.set(privateProfileRef, {
        parents: arrayUnion({
          userId,
          email: codeData.email || signedInEmail || 'pending',
          relation: codeData.relation || null,
          addedAt: now
        })
      }, { merge: true });
      transaction.update(codeRef, {
        used: true,
        usedBy: userId,
        usedAt: now,
        status: 'accepted'
      });

      responsePayload = {
        success: true,
        codeId: latestCodeSnap.id,
        teamId,
        teamName: parentLink.teamName,
        playerId,
        playerName: parentLink.playerName,
        playerNum: parentLink.playerNumber
      };
    });

    return responsePayload;
  };
}

module.exports = {
  ISSUER_ACCESS_ERROR,
  createRedeemParentInviteHandler,
  isInviteExpired,
  normalizeStoredUid
};
