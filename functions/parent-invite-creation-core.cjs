'use strict';

const crypto = require('node:crypto');
const { createFirestoreFixedWindowRateLimitReservation } = require('./rate-limit.cjs');

const PARENT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PARENT_INVITE_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PARENT_INVITE_SENDER_MAX_INVITES = 10;
const PARENT_INVITE_RECIPIENT_MAX_INVITES = 3;
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CODE_MAX_ATTEMPTS = 10;

function normalizeParentInviteRecipient(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeDocumentId(value, label, HttpsError) {
  const id = String(value || '').trim();
  if (!id || id.length > 128 || id.includes('/')) {
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

function isActiveParentInvite(invite = {}, expected = {}, nowMillis = Date.now()) {
  const status = String(invite.status || 'active').trim().toLowerCase();
  const expiresAtMillis = getTimestampMillis(invite.expiresAt);
  return isMatchingParentInvite(invite, expected)
    && invite.used !== true
    && invite.revoked !== true
    && invite.active !== false
    && !['accepted', 'cancelled', 'expired', 'removed', 'revoked'].includes(status)
    && (!Number.isFinite(expiresAtMillis) || expiresAtMillis > nowMillis);
}

function isMatchingParentInvite(invite = {}, expected = {}) {
  return String(invite.type || '').trim().toLowerCase() === 'parent_invite'
    && String(invite.teamId || '').trim() === expected.teamId
    && String(invite.playerId || '').trim() === expected.playerId
    && normalizeParentInviteRecipient(invite.email) === expected.email
    && Boolean(String(invite.code || '').trim());
}

function isCompletedParentInvite(invite = {}, expected = {}) {
  const status = String(invite.status || '').trim().toLowerCase();
  return isMatchingParentInvite(invite, expected)
    && invite.revoked !== true
    && invite.active !== false
    && (invite.used === true || status === 'accepted');
}

function buildParentInviteDocumentId({ teamId, playerId, email, idempotencyKey = '' }) {
  const identity = idempotencyKey
    ? `operation\n${idempotencyKey}`
    : `recipient\n${teamId}\n${playerId}\n${email}`;
  return `parent_${crypto.createHash('sha256')
    .update(identity)
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

function hasVerifiedManagerAccess({ context, team, user }) {
  const uid = String(context.auth?.uid || '').trim();
  const email = normalizeParentInviteRecipient(context.auth?.token?.email);
  if (!uid || !email || context.auth?.token?.email_verified !== true) return false;
  if (user?.isAdmin === true) return true;

  const ownerId = String(team?.ownerId || '').trim();
  if (ownerId === uid) return true;
  if (!ownerId) {
    const ownerEmails = [...new Set([team?.ownerEmail, team?.ownerEmailLower]
      .map(normalizeParentInviteRecipient)
      .filter(Boolean))];
    if (ownerEmails.length === 1 && ownerEmails[0] === email) return true;
  }

  return Array.isArray(team?.adminEmails)
    && team.adminEmails.map(normalizeParentInviteRecipient).includes(email);
}

function createParentInviteHandler({
  firestore,
  Timestamp,
  HttpsError,
  createInviteCode = createDefaultInviteCode,
  rateLimitCollectionName = 'parentInviteRateLimits',
  rateLimitWindowMs = PARENT_INVITE_RATE_LIMIT_WINDOW_MS,
  senderMaxInvites = PARENT_INVITE_SENDER_MAX_INVITES,
  recipientMaxInvites = PARENT_INVITE_RECIPIENT_MAX_INVITES
}) {
  const configuredWindowMs = parsePositiveInteger(
    rateLimitWindowMs,
    PARENT_INVITE_RATE_LIMIT_WINDOW_MS
  );

  return async function createParentInvite(data = {}, context = {}) {
    const callerUid = String(context.auth?.uid || '').trim();
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Sign in before creating a parent invite.');
    }
    if (!normalizeParentInviteRecipient(context.auth?.token?.email)
      || context.auth?.token?.email_verified !== true) {
      throw new HttpsError('failed-precondition', 'Verify your email before creating a parent invite.');
    }

    const teamId = normalizeDocumentId(data.teamId, 'teamId', HttpsError);
    const playerId = normalizeDocumentId(data.playerId, 'playerId', HttpsError);
    const email = normalizeParentInviteRecipient(data.email);
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      throw new HttpsError('invalid-argument', 'Enter a valid recipient email address.');
    }
    const relation = String(data.relation || '').trim() || 'Parent';
    if (relation.length > 80) {
      throw new HttpsError('invalid-argument', 'Parent relation is too long.');
    }
    const idempotencyKey = String(data.idempotencyKey || '').trim();
    if (idempotencyKey.length > 256) {
      throw new HttpsError('invalid-argument', 'Parent invite idempotency key is too long.');
    }

    const prepareSenderReservation = createFirestoreFixedWindowRateLimitReservation({
      firestore,
      collectionName: rateLimitCollectionName,
      windowMs: configuredWindowMs,
      maxRequests: parsePositiveInteger(senderMaxInvites, PARENT_INVITE_SENDER_MAX_INVITES)
    });
    const prepareRecipientReservation = email
      ? createFirestoreFixedWindowRateLimitReservation({
          firestore,
          collectionName: rateLimitCollectionName,
          windowMs: configuredWindowMs,
          maxRequests: parsePositiveInteger(recipientMaxInvites, PARENT_INVITE_RECIPIENT_MAX_INVITES)
        })
      : null;

    const userRef = firestore.doc(`users/${callerUid}`);
    const teamRef = firestore.doc(`teams/${teamId}`);
    const playerRef = firestore.doc(`teams/${teamId}/players/${playerId}`);
    const idempotencyRef = firestore.doc(
      `teams/${teamId}/inviteIdempotency/${buildParentInviteDocumentId({
        teamId,
        playerId,
        email,
        idempotencyKey
      })}`
    );
    const teamInvitesQuery = firestore.collection('accessCodes')
      .where('teamId', '==', teamId)
      .where('playerId', '==', playerId)
      .where('email', '==', email || null)
      .limit(10);

    const createInTransaction = async (transaction) => {
      const [userSnap, teamSnap, playerSnap, idempotencySnap, inviteQuerySnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(teamRef),
        transaction.get(playerRef),
        transaction.get(idempotencyRef),
        transaction.get(teamInvitesQuery)
      ]);

      if (!teamSnap.exists || !playerSnap.exists) {
        throw new HttpsError('permission-denied', 'You no longer manage this team and player.');
      }
      const team = teamSnap.data() || {};
      const user = userSnap.exists ? userSnap.data() || {} : {};
      if (!hasVerifiedManagerAccess({ context, team, user })) {
        throw new HttpsError('permission-denied', 'You no longer manage this team.');
      }

      const now = Timestamp.now();
      const nowMillis = getTimestampMillis(now);
      const expected = { teamId, playerId, email };
      let reusableSnap = null;
      if (idempotencySnap.exists) {
        const existingCode = String(idempotencySnap.data()?.accessCode || '').trim().toUpperCase();
        if (/^[A-Z0-9]{8}$/.test(existingCode)) {
          const candidateSnap = await transaction.get(firestore.doc(`accessCodes/${existingCode}`));
          const candidate = candidateSnap.exists ? candidateSnap.data() || {} : {};
          if (candidateSnap.exists && (
            isActiveParentInvite(candidate, expected, nowMillis)
            || (idempotencyKey && isCompletedParentInvite(candidate, expected))
          )) {
            reusableSnap = candidateSnap;
          }
        }
        if (idempotencyKey && !reusableSnap) {
          throw new HttpsError(
            'failed-precondition',
            'The prior parent invite outcome for this operation could not be replayed.'
          );
        }
      }
      reusableSnap = reusableSnap || inviteQuerySnap.docs.find((snapshot) => (
        isActiveParentInvite(snapshot.data() || {}, expected, nowMillis)
      ));
      if (reusableSnap) {
        const invite = reusableSnap.data() || {};
        if (!idempotencySnap.exists || idempotencySnap.data()?.accessCode !== invite.code) {
          transaction.set(idempotencyRef, {
            accessCode: invite.code,
            type: 'parent_invite',
            teamId,
            playerId,
            email,
            updatedAt: now
          });
        }
        return {
          id: reusableSnap.id,
          code: invite.code,
          teamName: invite.teamName || team.name || null,
          playerName: invite.playerName || playerSnap.data()?.name || null,
          email: email || null,
          created: false,
          reused: true
        };
      }

      const senderReservation = prepareSenderReservation(`sender\n${callerUid}`, nowMillis);
      const recipientReservation = prepareRecipientReservation?.(`recipient\n${email}`, nowMillis) || null;
      const senderLimitSnap = await transaction.get(senderReservation.ref);
      const recipientLimitSnap = recipientReservation
        ? await transaction.get(recipientReservation.ref)
        : null;
      const senderDecision = senderReservation.evaluate(senderLimitSnap);
      const recipientDecision = recipientReservation?.evaluate(recipientLimitSnap) || null;
      if (!senderDecision.allowed || (recipientDecision && !recipientDecision.allowed)) {
        const retryAfterSeconds = Math.max(
          ...[senderDecision, recipientDecision]
            .filter((decision) => decision && !decision.allowed)
            .map((decision) => decision.retryAfterSeconds)
        );
        throw new HttpsError(
          'resource-exhausted',
          'Too many parent invites. Please wait and try again.',
          { retryAfterSeconds }
        );
      }

      const code = String(createInviteCode()).trim().toUpperCase();
      if (!/^[A-Z0-9]{8}$/.test(code)) {
        throw new HttpsError('internal', 'Could not generate a parent invite code.');
      }
      const inviteRef = firestore.doc(`accessCodes/${code}`);
      const codeSnap = await transaction.get(inviteRef);
      if (codeSnap.exists) {
        const collisionError = new Error('Generated parent invite code already exists.');
        collisionError.isInviteCodeCollision = true;
        throw collisionError;
      }

      const player = playerSnap.data() || {};
      const invite = {
        code,
        type: 'parent_invite',
        teamId,
        playerId,
        playerNum: player.number ?? null,
        playerName: player.name || null,
        teamName: team.name || null,
        relation,
        email: email || null,
        generatedBy: callerUid,
        createdAt: now,
        expiresAt: Timestamp.fromMillis(nowMillis + PARENT_INVITE_TTL_MS),
        used: false,
        usedBy: null,
        usedAt: null
      };
      senderReservation.commit(transaction, senderDecision);
      if (recipientReservation) recipientReservation.commit(transaction, recipientDecision);
      transaction.create(inviteRef, invite);
      transaction.set(idempotencyRef, {
        accessCode: code,
        type: 'parent_invite',
        teamId,
        playerId,
        email,
        updatedAt: now
      });

      return {
        id: inviteRef.id,
        code,
        teamName: invite.teamName,
        playerName: invite.playerName,
        email: email || null,
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

    throw new HttpsError('internal', 'Could not generate a unique parent invite code.');
  };
}

module.exports = {
  PARENT_INVITE_RATE_LIMIT_WINDOW_MS,
  PARENT_INVITE_RECIPIENT_MAX_INVITES,
  PARENT_INVITE_SENDER_MAX_INVITES,
  PARENT_INVITE_TTL_MS,
  buildParentInviteDocumentId,
  createParentInviteHandler,
  hasVerifiedManagerAccess,
  isActiveParentInvite,
  normalizeParentInviteRecipient
};
