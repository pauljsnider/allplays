'use strict';

const crypto = require('node:crypto');
const {
  calendarTokenHasTeamAccess,
  hashCalendarToken
} = require('./team-calendar-feed-core.cjs');

const CALENDAR_SUBSCRIPTION_SCHEMA_VERSION = 1;
const GENERATED_CALENDAR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CALENDAR_TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;

function normalizeCalendarSubscriptionId(value, fieldName) {
  if (
    typeof value !== 'string'
    || value !== value.trim()
    || !value
    || value.length > 128
    || value.includes('/')
  ) {
    const error = new Error(`${fieldName} is invalid.`);
    error.code = 'invalid-argument';
    throw error;
  }
  return value;
}

function createRawCalendarSubscriptionToken(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(32);
  if (!Buffer.isBuffer(bytes) || bytes.length !== 32) {
    throw new Error('Secure calendar token generation failed.');
  }
  const token = bytes.toString('base64url');
  if (!GENERATED_CALENDAR_TOKEN_PATTERN.test(token)) {
    throw new Error('Secure calendar token generation failed.');
  }
  return token;
}

function isRevokedCalendarCredential(value) {
  return value?.active === false
    || value?.revoked === true
    || value?.disabled === true
    || value?.status === 'revoked';
}

function getCalendarCredentialExpiry(value) {
  const expiresAt = value?.expiresAt;
  if (!expiresAt) return null;
  if (typeof expiresAt.toDate === 'function') return expiresAt.toDate();
  if (typeof expiresAt.toMillis === 'function') return new Date(expiresAt.toMillis());
  const parsed = new Date(expiresAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isExpiredCalendarCredential(value, now = new Date()) {
  const expiresAt = getCalendarCredentialExpiry(value);
  return Boolean(expiresAt && expiresAt <= now);
}

function getReusableCalendarSubscription(secret, { uid, teamId, now = new Date() }) {
  if (!secret || typeof secret !== 'object' || isRevokedCalendarCredential(secret)) return null;
  if (isExpiredCalendarCredential(secret, now)) return null;
  if (secret.schemaVersion !== CALENDAR_SUBSCRIPTION_SCHEMA_VERSION) return null;
  if (secret.uid !== uid || secret.teamId !== teamId) return null;

  const rawToken = secret.rawToken;
  if (typeof rawToken !== 'string' || !GENERATED_CALENDAR_TOKEN_PATTERN.test(rawToken)) return null;
  const tokenHash = hashCalendarToken(rawToken);
  if (!CALENDAR_TOKEN_HASH_PATTERN.test(tokenHash) || secret.tokenHash !== tokenHash) return null;
  return { rawToken, tokenHash };
}

function getBoundCalendarLookupHash(secret, { uid, teamId }) {
  if (!secret || typeof secret !== 'object') return '';
  if (secret.uid !== uid || secret.teamId !== teamId) return '';
  return typeof secret.tokenHash === 'string' && CALENDAR_TOKEN_HASH_PATTERN.test(secret.tokenHash)
    ? secret.tokenHash
    : '';
}

function calendarLookupMatchesSubscription(lookup, { uid, teamId, tokenHash, now = new Date() }) {
  if (!lookup || typeof lookup !== 'object' || isRevokedCalendarCredential(lookup)) return false;
  if (isExpiredCalendarCredential(lookup, now)) return false;
  return lookup.uid === uid
    && lookup.teamId === teamId
    && lookup.tokenHash === tokenHash;
}

function createGetOrCreatePrivateTeamCalendarFeedHandler({
  firestore,
  auth,
  HttpsError,
  serverTimestamp,
  randomBytes = crypto.randomBytes,
  hasTeamAccess = calendarTokenHasTeamAccess,
  assertFreshAuthUser = async () => {},
  now = () => new Date()
}) {
  if (
    !firestore
    || !auth
    || typeof HttpsError !== 'function'
    || typeof serverTimestamp !== 'function'
    || typeof hasTeamAccess !== 'function'
    || typeof assertFreshAuthUser !== 'function'
  ) {
    throw new TypeError('Calendar subscription handler dependencies are invalid.');
  }

  return async function getOrCreatePrivateTeamCalendarFeed(data, context = {}) {
    let uid;
    let teamId;
    try {
      uid = normalizeCalendarSubscriptionId(context.auth?.uid, 'uid');
    } catch {
      throw new HttpsError('unauthenticated', 'Sign in before creating a private calendar feed.');
    }
    try {
      teamId = normalizeCalendarSubscriptionId(data?.teamId, 'teamId');
    } catch (error) {
      throw new HttpsError('invalid-argument', error.message || 'Team is invalid.');
    }

    let authUser;
    try {
      authUser = await auth.getUser(uid);
    } catch (error) {
      if (error?.code === 'auth/user-not-found' || error?.code === 'auth/user-disabled') {
        throw new HttpsError('unauthenticated', 'Your account is not available. Sign in again.');
      }
      throw new HttpsError('internal', 'Unable to verify your account for calendar access.');
    }
    if (!authUser || authUser.uid !== uid || authUser.disabled === true) {
      throw new HttpsError('unauthenticated', 'Your account is not available. Sign in again.');
    }
    try {
      await assertFreshAuthUser({ authUser, context });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', 'Unable to verify your account for calendar access.');
    }

    const candidateRawToken = createRawCalendarSubscriptionToken(randomBytes);
    const candidateTokenHash = hashCalendarToken(candidateRawToken);
    const teamRef = firestore.doc(`teams/${teamId}`);
    const userRef = firestore.doc(`users/${uid}`);
    const deletionRequestRef = firestore.doc(`accountDeletionRequests/${uid}`);
    // This deterministic per-principal document stores the reusable raw bearer
    // credential. No Firestore rule grants clients access to this collection.
    const secretRef = firestore.doc(`teams/${teamId}/privateCalendarSubscriptions/${uid}`);

    try {
      return await firestore.runTransaction(async (transaction) => {
        const [teamSnap, userSnap, deletionRequestSnap, secretSnap] = await Promise.all([
          transaction.get(teamRef),
          transaction.get(userRef),
          transaction.get(deletionRequestRef),
          transaction.get(secretRef)
        ]);
        if (!teamSnap.exists) {
          throw new HttpsError('not-found', 'Team not found.');
        }
        if (!userSnap.exists) {
          throw new HttpsError('permission-denied', 'Your current team access could not be verified.');
        }
        if (deletionRequestSnap.exists) {
          throw new HttpsError(
            'failed-precondition',
            'Private calendar feeds cannot be created while account deletion is pending.'
          );
        }

        const team = teamSnap.data() || {};
        const profile = userSnap.data() || {};
        if (!hasTeamAccess({
          team,
          profile,
          authUser,
          tokenData: { uid, teamId }
        })) {
          throw new HttpsError('permission-denied', 'You do not have current access to this team.');
        }

        const resolvedAt = now();
        const secret = secretSnap.exists ? secretSnap.data() || {} : null;
        const reusable = getReusableCalendarSubscription(secret, { uid, teamId, now: resolvedAt });
        let reusableLookupRef = null;
        let reusableLookupSnap = null;
        if (reusable) {
          reusableLookupRef = firestore.doc(`teams/${teamId}/calendarTokens/${reusable.tokenHash}`);
          reusableLookupSnap = await transaction.get(reusableLookupRef);
          if (reusableLookupSnap.exists && calendarLookupMatchesSubscription(
            reusableLookupSnap.data() || {},
            { uid, teamId, tokenHash: reusable.tokenHash, now: resolvedAt }
          )) {
            return {
              teamId,
              token: reusable.rawToken,
              reused: true
            };
          }
        }

        const candidateLookupRef = firestore.doc(`teams/${teamId}/calendarTokens/${candidateTokenHash}`);
        const candidateLookupSnap = await transaction.get(candidateLookupRef);
        if (candidateLookupSnap.exists) {
          throw new HttpsError('internal', 'Unable to reserve a unique calendar subscription. Retry.');
        }

        const timestamp = serverTimestamp();
        const boundLookupHash = getBoundCalendarLookupHash(secret, { uid, teamId });
        if (boundLookupHash) {
          const boundLookupRef = reusableLookupRef
            && reusable?.tokenHash === boundLookupHash
            ? reusableLookupRef
            : firestore.doc(`teams/${teamId}/calendarTokens/${boundLookupHash}`);
          const boundLookupSnap = reusableLookupSnap
            && reusable?.tokenHash === boundLookupHash
            ? reusableLookupSnap
            : await transaction.get(boundLookupRef);
          const boundLookup = boundLookupSnap.exists ? boundLookupSnap.data() || {} : null;
          if (
            boundLookup
            && boundLookup.uid === uid
            && boundLookup.teamId === teamId
            && boundLookup.tokenHash === boundLookupHash
          ) {
            transaction.set(boundLookupRef, {
              active: false,
              revoked: true,
              revokedAt: timestamp,
              revokedReason: 'rotated'
            }, { merge: true });
          }
        }

        transaction.set(secretRef, {
          schemaVersion: CALENDAR_SUBSCRIPTION_SCHEMA_VERSION,
          teamId,
          uid,
          rawToken: candidateRawToken,
          tokenHash: candidateTokenHash,
          active: true,
          revoked: false,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        transaction.set(candidateLookupRef, {
          schemaVersion: CALENDAR_SUBSCRIPTION_SCHEMA_VERSION,
          teamId,
          uid,
          tokenHash: candidateTokenHash,
          active: true,
          revoked: false,
          createdAt: timestamp,
          updatedAt: timestamp
        });

        return {
          teamId,
          token: candidateRawToken,
          reused: false
        };
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', 'Unable to create a private calendar feed. Retry.');
    }
  };
}

module.exports = {
  CALENDAR_SUBSCRIPTION_SCHEMA_VERSION,
  calendarLookupMatchesSubscription,
  createGetOrCreatePrivateTeamCalendarFeedHandler,
  createRawCalendarSubscriptionToken,
  getReusableCalendarSubscription,
  normalizeCalendarSubscriptionId
};
