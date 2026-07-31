'use strict';

const crypto = require('node:crypto');
const { createFirestoreFixedWindowRateLimitReservation } = require('./rate-limit.cjs');

const CO_PARENT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CO_PARENT_INVITE_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const CO_PARENT_INVITE_SENDER_MAX_INVITES = 10;
const CO_PARENT_INVITE_RECIPIENT_MAX_INVITES = 3;
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CODE_MAX_ATTEMPTS = 10;

function normalizeCoParentInviteEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeDocumentId(value, label, HttpsError) {
  const id = String(value || '').trim();
  if (!id || id.includes('/')) {
    throw new HttpsError('invalid-argument', `${label} is invalid.`);
  }
  return id;
}

function getTimestampMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (Number.isFinite(Number(value?.millis))) return Number(value.millis);
  if (Number.isFinite(Number(value?.seconds))) return Number(value.seconds) * 1000;
  return NaN;
}

function isActiveCoParentInvite(invite = {}, expected = {}, nowMillis = Date.now()) {
  const status = String(invite.status || 'active').trim().toLowerCase();
  const expiresAtMillis = getTimestampMillis(invite.expiresAt);
  return String(invite.type || '').trim().toLowerCase() === 'coparent_invite'
    && String(invite.teamId || '').trim() === expected.teamId
    && String(invite.playerId || '').trim() === expected.playerId
    && normalizeCoParentInviteEmail(invite.email) === expected.email
    && Boolean(String(invite.code || '').trim())
    && invite.used !== true
    && invite.revoked !== true
    && invite.active !== false
    && !['accepted', 'cancelled', 'expired', 'removed', 'revoked'].includes(status)
    && (!Number.isFinite(expiresAtMillis) || expiresAtMillis > nowMillis);
}

function buildCoParentInviteDocumentId({ teamId, playerId, email }) {
  return `coparent_${crypto.createHash('sha256')
    .update(`${teamId}\n${playerId}\n${email}`)
    .digest('hex')}`;
}

function createDefaultInviteCode() {
  return [...crypto.randomBytes(8)]
    .map((byte) => INVITE_CODE_ALPHABET[byte & 31])
    .join('');
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createCoParentInviteHandler({
  firestore,
  Timestamp,
  HttpsError,
  createInviteCode = createDefaultInviteCode,
  rateLimitCollectionName = 'coParentInviteRateLimits',
  rateLimitWindowMs = CO_PARENT_INVITE_RATE_LIMIT_WINDOW_MS,
  senderMaxInvites = CO_PARENT_INVITE_SENDER_MAX_INVITES,
  recipientMaxInvites = CO_PARENT_INVITE_RECIPIENT_MAX_INVITES
}) {
  const configuredWindowMs = parsePositiveInteger(
    rateLimitWindowMs,
    CO_PARENT_INVITE_RATE_LIMIT_WINDOW_MS
  );
  const prepareSenderReservation = createFirestoreFixedWindowRateLimitReservation({
    firestore,
    collectionName: rateLimitCollectionName,
    windowMs: configuredWindowMs,
    maxRequests: parsePositiveInteger(senderMaxInvites, CO_PARENT_INVITE_SENDER_MAX_INVITES)
  });
  const prepareRecipientReservation = createFirestoreFixedWindowRateLimitReservation({
    firestore,
    collectionName: rateLimitCollectionName,
    windowMs: configuredWindowMs,
    maxRequests: parsePositiveInteger(recipientMaxInvites, CO_PARENT_INVITE_RECIPIENT_MAX_INVITES)
  });

  return async function createCoParentInvite(data = {}, context = {}) {
    const callerUid = String(context.auth?.uid || '').trim();
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Sign in before creating a co-parent invite.');
    }

    const teamId = normalizeDocumentId(data.teamId, 'teamId', HttpsError);
    const playerId = normalizeDocumentId(data.playerId, 'playerId', HttpsError);
    const email = normalizeCoParentInviteEmail(data.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError('invalid-argument', 'Enter a valid recipient email address.');
    }

    const userRef = firestore.doc(`users/${callerUid}`);
    const teamRef = firestore.doc(`teams/${teamId}`);
    const playerRef = firestore.doc(`teams/${teamId}/players/${playerId}`);
    const idempotencyRef = firestore.doc(
      `teams/${teamId}/inviteIdempotency/${buildCoParentInviteDocumentId({ teamId, playerId, email })}`
    );
    const teamInvitesQuery = firestore.collection('accessCodes')
      .where('teamId', '==', teamId)
      .where('playerId', '==', playerId);

    const createInTransaction = async (transaction) => {
      const userSnap = await transaction.get(userRef);
      const teamSnap = await transaction.get(teamRef);
      const playerSnap = await transaction.get(playerRef);
      const inviteQuerySnap = await transaction.get(teamInvitesQuery);
      await transaction.get(idempotencyRef);

      if (!userSnap.exists || !teamSnap.exists || !playerSnap.exists) {
        throw new HttpsError('permission-denied', 'You are not linked to this team and player.');
      }

      const playerKey = `${teamId}::${playerId}`;
      const parentPlayerKeys = Array.isArray(userSnap.data()?.parentPlayerKeys)
        ? userSnap.data().parentPlayerKeys
        : [];
      if (!parentPlayerKeys.includes(playerKey)) {
        throw new HttpsError('permission-denied', 'You are not linked to this team and player.');
      }

      const now = Timestamp.now();
      const nowMillis = getTimestampMillis(now);
      const expected = { teamId, playerId, email };
      const reusableSnap = inviteQuerySnap.docs.find((snapshot) => (
        isActiveCoParentInvite(snapshot.data() || {}, expected, nowMillis)
      ));
      if (reusableSnap) {
        const invite = reusableSnap.data() || {};
        return {
          id: reusableSnap.id,
          code: invite.code,
          teamName: invite.teamName || teamSnap.data()?.name || null,
          playerName: invite.playerName || playerSnap.data()?.name || null,
          email,
          created: false,
          reused: true
        };
      }

      const senderReservation = prepareSenderReservation(`sender\n${callerUid}`, nowMillis);
      const recipientReservation = prepareRecipientReservation(`recipient\n${email}`, nowMillis);
      const senderLimitSnap = await transaction.get(senderReservation.ref);
      const recipientLimitSnap = await transaction.get(recipientReservation.ref);
      const senderDecision = senderReservation.evaluate(senderLimitSnap);
      const recipientDecision = recipientReservation.evaluate(recipientLimitSnap);
      if (!senderDecision.allowed || !recipientDecision.allowed) {
        const retryAfterSeconds = Math.max(
          ...[senderDecision, recipientDecision]
            .filter((decision) => !decision.allowed)
            .map((decision) => decision.retryAfterSeconds)
        );
        throw new HttpsError(
          'resource-exhausted',
          'Too many co-parent invites. Please wait and try again.',
          { retryAfterSeconds }
        );
      }

      const code = String(createInviteCode()).trim().toUpperCase();
      if (!/^[A-Z0-9]{8}$/.test(code)) {
        throw new HttpsError('internal', 'Could not generate a co-parent invite code.');
      }
      const inviteRef = firestore.doc(`accessCodes/${code}`);
      const codeSnap = await transaction.get(inviteRef);
      if (codeSnap.exists) {
        const collisionError = new Error('Generated co-parent invite code already exists.');
        collisionError.isInviteCodeCollision = true;
        throw collisionError;
      }

      const invite = {
        code,
        type: 'coparent_invite',
        teamId,
        playerId,
        playerName: playerSnap.data()?.name || null,
        teamName: teamSnap.data()?.name || null,
        email,
        generatedBy: callerUid,
        createdAt: now,
        expiresAt: Timestamp.fromMillis(nowMillis + CO_PARENT_INVITE_TTL_MS),
        used: false,
        usedBy: null,
        usedAt: null
      };
      senderReservation.commit(transaction, senderDecision);
      recipientReservation.commit(transaction, recipientDecision);
      transaction.create(inviteRef, invite);
      transaction.set(idempotencyRef, {
        accessCode: code,
        type: 'coparent_invite',
        updatedAt: now
      });

      return {
        id: inviteRef.id,
        code,
        teamName: invite.teamName,
        playerName: invite.playerName,
        email,
        created: true,
        reused: false
      };
    };

    for (let attempt = 0; attempt < INVITE_CODE_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await firestore.runTransaction(createInTransaction);
      } catch (error) {
        if (!error?.isInviteCodeCollision) throw error;
      }
    }

    throw new HttpsError('internal', 'Could not generate a unique co-parent invite code.');
  };
}

module.exports = {
  CO_PARENT_INVITE_RATE_LIMIT_WINDOW_MS,
  CO_PARENT_INVITE_RECIPIENT_MAX_INVITES,
  CO_PARENT_INVITE_SENDER_MAX_INVITES,
  CO_PARENT_INVITE_TTL_MS,
  buildCoParentInviteDocumentId,
  createCoParentInviteHandler,
  isActiveCoParentInvite,
  normalizeCoParentInviteEmail
};
