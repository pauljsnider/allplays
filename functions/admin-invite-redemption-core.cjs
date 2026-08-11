'use strict';

const { hasAdminInviteIssuerAccess } = require('./team-admin-access-core.cjs');
const {
  appendUniqueValue,
  normalizeParentInviteEmail
} = require('./parent-invite-auto-link-core.cjs');

const ISSUER_ACCESS_ERROR = 'The admin invite issuer no longer has access to this team.';

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

function createRedeemAdminInviteHandler({
  firestore,
  getAuthUser,
  getTimestamp,
  HttpsError,
  normalizeFirestoreId,
  nowMillis = () => Date.now()
}) {
  return async function redeemAdminInvite(data, context = {}) {
    if (!firestore?.doc || !firestore?.runTransaction) throw new TypeError('firestore is required');
    if (typeof getAuthUser !== 'function') throw new TypeError('getAuthUser is required');
    if (typeof getTimestamp !== 'function') throw new TypeError('getTimestamp is required');
    if (typeof HttpsError !== 'function') throw new TypeError('HttpsError is required');
    if (typeof normalizeFirestoreId !== 'function') throw new TypeError('normalizeFirestoreId is required');

    if (!context.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in before accepting an admin invite.');
    }

    const userId = normalizeFirestoreId(data?.userId || context.auth.uid, 'userId');
    if (userId !== context.auth.uid) {
      throw new HttpsError('permission-denied', 'You can only accept an invite for your own account.');
    }

    if (context.auth.token?.email_verified !== true) {
      throw new HttpsError(
        'permission-denied',
        'Verify your email before accepting an admin invite.',
        { reason: 'email-verification-required' }
      );
    }

    const signedInEmail = normalizeParentInviteEmail(context.auth.token?.email);
    if (!signedInEmail) {
      throw new HttpsError('permission-denied', 'A verified email is required to accept an admin invite.');
    }

    const codeId = normalizeFirestoreId(data?.codeId, 'codeId');
    const codeRef = firestore.doc(`accessCodes/${codeId}`);
    let responsePayload = null;

    await firestore.runTransaction(async (transaction) => {
      const codeSnap = await transaction.get(codeRef);
      if (!codeSnap.exists) {
        throw new HttpsError('not-found', 'Admin invite could not be found.');
      }

      const codeData = codeSnap.data() || {};
      if (codeData.type !== 'admin_invite') {
        throw new HttpsError('failed-precondition', 'Not an admin invite code.');
      }
      if (codeData.used || codeData.revoked === true || codeData.active === false ||
          ['removed', 'cancelled', 'revoked'].includes(codeData.status)) {
        throw new HttpsError('failed-precondition', 'Admin invite is no longer available.');
      }
      if (isInviteExpired(codeData.expiresAt, nowMillis())) {
        throw new HttpsError('failed-precondition', 'Admin invite has expired.');
      }

      const invitedEmail = normalizeParentInviteEmail(codeData.email);
      if (!invitedEmail) {
        throw new HttpsError('failed-precondition', 'Admin invite is missing an invited email.');
      }

      const issuerUid = normalizeStoredUid(codeData.generatedBy);
      if (!issuerUid) {
        throw new HttpsError('permission-denied', ISSUER_ACCESS_ERROR);
      }

      const teamId = normalizeFirestoreId(codeData.teamId, 'teamId');
      const teamRef = firestore.doc(`teams/${teamId}`);
      const userRef = firestore.doc(`users/${userId}`);
      const issuerRef = firestore.doc(`users/${issuerUid}`);
      const [teamSnap, userSnap, issuerSnap, issuerAuthUser] = await Promise.all([
        transaction.get(teamRef),
        transaction.get(userRef),
        transaction.get(issuerRef),
        Promise.resolve().then(() => getAuthUser(issuerUid)).catch(() => null)
      ]);

      if (!teamSnap.exists) {
        throw new HttpsError('not-found', 'Team not found.');
      }

      const teamData = teamSnap.data() || {};
      const userData = userSnap.exists ? userSnap.data() || {} : {};
      const issuerData = issuerSnap.exists ? issuerSnap.data() || {} : {};
      if (!hasAdminInviteIssuerAccess({
        team: teamData,
        user: issuerData,
        uid: issuerUid,
        authUser: issuerAuthUser
      })) {
        throw new HttpsError('permission-denied', ISSUER_ACCESS_ERROR);
      }

      if (invitedEmail !== signedInEmail) {
        throw new HttpsError('permission-denied', `This invite was sent to ${invitedEmail}. Sign in with that email to accept it.`);
      }

      const now = getTimestamp();
      transaction.set(teamRef, {
        adminEmails: appendUniqueValue(teamData.adminEmails, invitedEmail),
        updatedAt: now
      }, { merge: true });
      transaction.set(userRef, {
        coachOf: appendUniqueValue(userData.coachOf, teamId),
        roles: appendUniqueValue(userData.roles, 'coach'),
        updatedAt: now
      }, { merge: true });
      transaction.update(codeRef, {
        used: true,
        usedBy: userId,
        usedAt: now
      });

      responsePayload = {
        success: true,
        codeId,
        teamId,
        teamName: teamData.name || codeData.teamName || null
      };
    });

    return responsePayload;
  };
}

module.exports = {
  createRedeemAdminInviteHandler,
  isInviteExpired,
  normalizeStoredUid
};
