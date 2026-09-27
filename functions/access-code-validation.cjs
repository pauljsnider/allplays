const {
  createFirestoreFixedWindowRateLimitReservation,
  getRequestIp
} = require('./rate-limit.cjs');

const ACCESS_CODE_VALIDATION_RATE_LIMIT_COLLECTION = 'accessCodeValidationRateLimits';
const ACCESS_CODE_VALIDATION_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const ACCESS_CODE_VALIDATION_UID_MAX_REQUESTS = 30;
const ACCESS_CODE_VALIDATION_NETWORK_MAX_REQUESTS = 120;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function buildAccessCodeValidationRateLimitBoundaries({ uid, requestIp }) {
  const normalizedUid = String(uid || '').trim();
  const normalizedRequestIp = String(requestIp || '').trim() || 'unknown';
  if (!normalizedUid) {
    throw new TypeError('An authenticated UID is required for access-code validation rate limiting.');
  }
  return {
    uid: ['access-code-validation', 'uid', normalizedUid].join('\n'),
    network: ['access-code-validation', 'network', normalizedRequestIp].join('\n')
  };
}

function getExpirationTime(expiresAt) {
  if (!expiresAt) return null;
  if (typeof expiresAt.toMillis === 'function') return expiresAt.toMillis();
  if (typeof expiresAt.toDate === 'function') {
    const value = expiresAt.toDate();
    return value instanceof Date ? value.getTime() : null;
  }
  if (typeof expiresAt.seconds === 'number') return expiresAt.seconds * 1000;
  if (expiresAt instanceof Date) return expiresAt.getTime();
  const value = Number(expiresAt);
  return Number.isFinite(value) ? value : null;
}

function isAccessCodeExpired(expiresAt, nowMs = Date.now()) {
  const expiresAtMs = getExpirationTime(expiresAt);
  return expiresAtMs != null && nowMs >= expiresAtMs;
}

function isAccessCodeInactive(data, nowMs = Date.now()) {
  const status = String(data?.status || '').trim().toLowerCase();
  return data?.used === true ||
    data?.revoked === true ||
    data?.active === false ||
    status === 'removed' ||
    status === 'cancelled' ||
    status === 'revoked' ||
    isAccessCodeExpired(data?.expiresAt, nowMs);
}

function isAccessCodeRevoked(data) {
  const status = String(data?.status || '').trim().toLowerCase();
  return data?.revoked === true ||
    data?.active === false ||
    status === 'removed' ||
    status === 'cancelled' ||
    status === 'revoked';
}

const GENERIC_PREAUTH_ACCESS_CODE_MESSAGE = 'Invalid or expired access code';

function buildGenericPreAuthAccessCodeValidationResult() {
  return { valid: false, message: GENERIC_PREAUTH_ACCESS_CODE_MESSAGE };
}

function buildSafeAccessCodeData(data = {}) {
  return {
    code: data.code || '',
    type: data.type || 'standard'
  };
}

function validateAccessCodeCandidates(docs, nowMs = Date.now(), acceptingUserId = '') {
  const candidates = Array.isArray(docs) ? docs : [];
  if (candidates.length === 0) {
    return { valid: false, message: 'Invalid access code' };
  }

  const normalizedUserId = String(acceptingUserId || '').trim();
  const redeemableCode = candidates.find((doc) => !isAccessCodeInactive(doc?.data || {}, nowMs));
  const alreadyRedeemedCode = normalizedUserId
    ? candidates.find((doc) => {
      const candidate = doc?.data || {};
      return candidate.used === true &&
        String(candidate.usedBy || '').trim() === normalizedUserId &&
        !isAccessCodeRevoked(candidate);
    })
    : null;
  const codeDoc = redeemableCode || alreadyRedeemedCode || candidates[0];
  const data = codeDoc?.data || {};

  if (isAccessCodeRevoked(data)) {
    return { valid: false, message: 'Invite is no longer active' };
  }

  if (alreadyRedeemedCode === codeDoc) {
    return {
      valid: true,
      alreadyRedeemed: true,
      codeId: codeDoc.id,
      type: data.type || 'standard',
      data: buildSafeAccessCodeData(data)
    };
  }

  if (data.used === true) {
    return { valid: false, message: 'Code already used' };
  }

  if (isAccessCodeExpired(data.expiresAt, nowMs)) {
    return { valid: false, message: 'Code has expired' };
  }

  return {
    valid: true,
    codeId: codeDoc.id,
    type: data.type || 'standard',
    data: buildSafeAccessCodeData(data)
  };
}

function createAccessCodeValidationHandler({
  firestore,
  auth,
  HttpsError,
  now = Date.now,
  getRequestIpAddress = getRequestIp,
  rateLimitCollectionName = ACCESS_CODE_VALIDATION_RATE_LIMIT_COLLECTION,
  rateLimitWindowMs = ACCESS_CODE_VALIDATION_RATE_LIMIT_WINDOW_MS,
  uidMaxRequests = ACCESS_CODE_VALIDATION_UID_MAX_REQUESTS,
  networkMaxRequests = ACCESS_CODE_VALIDATION_NETWORK_MAX_REQUESTS
}) {
  const configuredWindowMs = parsePositiveInteger(
    rateLimitWindowMs,
    ACCESS_CODE_VALIDATION_RATE_LIMIT_WINDOW_MS
  );
  const prepareUidReservation = createFirestoreFixedWindowRateLimitReservation({
    firestore,
    collectionName: rateLimitCollectionName,
    windowMs: configuredWindowMs,
    maxRequests: parsePositiveInteger(uidMaxRequests, ACCESS_CODE_VALIDATION_UID_MAX_REQUESTS)
  });
  const prepareNetworkReservation = createFirestoreFixedWindowRateLimitReservation({
    firestore,
    collectionName: rateLimitCollectionName,
    windowMs: configuredWindowMs,
    maxRequests: parsePositiveInteger(networkMaxRequests, ACCESS_CODE_VALIDATION_NETWORK_MAX_REQUESTS)
  });

  return async function validateAccessCodeForAcceptance(data = {}, context = {}) {
    const code = String(data?.code || '').trim().toUpperCase();
    if (!code) {
      throw new HttpsError('invalid-argument', 'Access code is required.');
    }

    const nativeAuthToken = String(data?.nativeAuthToken || '').trim();
    const nativeAuthUser = nativeAuthToken
      ? await auth.verifyIdToken(nativeAuthToken).catch(() => null)
      : null;
    const acceptingUserId = String(
      context?.auth?.uid || nativeAuthUser?.uid || nativeAuthUser?.sub || ''
    ).trim();
    if (!acceptingUserId) {
      return buildGenericPreAuthAccessCodeValidationResult();
    }

    const requestTime = now();
    const boundaries = buildAccessCodeValidationRateLimitBoundaries({
      uid: acceptingUserId,
      requestIp: getRequestIpAddress(context?.rawRequest || {})
    });
    const uidReservation = prepareUidReservation(boundaries.uid, requestTime);
    const networkReservation = prepareNetworkReservation(boundaries.network, requestTime);
    const rateLimitDecision = await firestore.runTransaction(async (transaction) => {
      const uidSnapshot = await transaction.get(uidReservation.ref);
      const networkSnapshot = await transaction.get(networkReservation.ref);
      const uid = uidReservation.evaluate(uidSnapshot);
      const network = networkReservation.evaluate(networkSnapshot);
      if (uid.allowed && network.allowed) {
        uidReservation.commit(transaction, uid);
        networkReservation.commit(transaction, network);
      }
      return { uid, network };
    });

    const rejectedBoundaries = Object.values(rateLimitDecision)
      .filter((decision) => !decision.allowed);
    if (rejectedBoundaries.length > 0) {
      const retryAfterSeconds = Math.min(
        Math.max(1, Math.ceil(configuredWindowMs / 1000)),
        Math.max(...rejectedBoundaries.map((decision) => decision.retryAfterSeconds))
      );
      throw new HttpsError(
        'resource-exhausted',
        'Too many access-code validation attempts. Please wait and try again.',
        { retryAfterSeconds }
      );
    }

    const snapshot = await firestore.collection('accessCodes').where('code', '==', code).get();
    return validateAccessCodeCandidates(snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      data: docSnap.data() || {}
    })), requestTime, acceptingUserId);
  };
}

module.exports = {
  ACCESS_CODE_VALIDATION_NETWORK_MAX_REQUESTS,
  ACCESS_CODE_VALIDATION_RATE_LIMIT_COLLECTION,
  ACCESS_CODE_VALIDATION_RATE_LIMIT_WINDOW_MS,
  ACCESS_CODE_VALIDATION_UID_MAX_REQUESTS,
  GENERIC_PREAUTH_ACCESS_CODE_MESSAGE,
  buildAccessCodeValidationRateLimitBoundaries,
  buildGenericPreAuthAccessCodeValidationResult,
  buildSafeAccessCodeData,
  createAccessCodeValidationHandler,
  getExpirationTime,
  isAccessCodeExpired,
  isAccessCodeInactive,
  isAccessCodeRevoked,
  validateAccessCodeCandidates
};
