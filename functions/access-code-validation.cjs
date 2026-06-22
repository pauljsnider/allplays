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

function validateAccessCodeCandidates(docs, nowMs = Date.now()) {
  const candidates = Array.isArray(docs) ? docs : [];
  if (candidates.length === 0) {
    return { valid: false, message: 'Invalid access code' };
  }

  const codeDoc = candidates.find((doc) => !isAccessCodeInactive(doc?.data || {}, nowMs)) || candidates[0];
  const data = codeDoc?.data || {};
  const status = String(data.status || '').trim().toLowerCase();

  if (data.used === true) {
    return { valid: false, message: 'Code already used' };
  }

  if (data.revoked === true || data.active === false || status === 'removed' || status === 'cancelled' || status === 'revoked') {
    return { valid: false, message: 'Invite is no longer active' };
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
  validateAccessCodeCandidates
};
