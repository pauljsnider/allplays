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

module.exports = {
  GENERIC_PREAUTH_ACCESS_CODE_MESSAGE,
  buildGenericPreAuthAccessCodeValidationResult,
  buildSafeAccessCodeData,
  getExpirationTime,
  isAccessCodeExpired,
  isAccessCodeRevoked,
  validateAccessCodeCandidates
};
