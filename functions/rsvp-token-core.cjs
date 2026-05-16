const crypto = require('node:crypto');

const VALID_RSVP_RESPONSES = new Set(['going', 'maybe', 'not_going']);
const DEFAULT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeResponse(value) {
  const response = String(value || '').trim();
  if (!VALID_RSVP_RESPONSES.has(response)) {
    throw new Error('Invalid RSVP response.');
  }
  return response;
}

function hashRsvpToken(token) {
  const normalized = normalizeId(token);
  if (!normalized) return '';
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function hashGuardianEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return '';
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 24);
}

function createRawRsvpToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function normalizeRsvpTokenCreateInput(data, nowMs = Date.now()) {
  const teamId = normalizeId(data?.teamId);
  const gameId = normalizeId(data?.gameId || data?.eventId);
  const playerId = normalizeId(data?.playerId || data?.childId);
  const guardianEmail = normalizeEmail(data?.guardianEmail || data?.email);
  const response = normalizeResponse(data?.response);

  if (!teamId || !gameId || !playerId || !guardianEmail) {
    throw new Error('Team, event, player, guardian email, and response are required.');
  }

  let ttlMs = DEFAULT_TOKEN_TTL_MS;
  if (data?.ttlMinutes !== undefined) {
    ttlMs = Number(data.ttlMinutes) * 60 * 1000;
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TOKEN_TTL_MS) {
    throw new Error('RSVP token expiry must be between 1 minute and 30 days.');
  }

  return {
    teamId,
    gameId,
    playerId,
    guardianEmail,
    response,
    expiresAtMs: nowMs + ttlMs
  };
}

function buildScopedRsvpDocId({ guardianEmail, playerId }) {
  const emailHash = hashGuardianEmail(guardianEmail);
  const normalizedPlayerId = normalizeId(playerId);
  if (!emailHash || !normalizedPlayerId) return '';
  return `email_${emailHash}__${normalizedPlayerId}`;
}

function tokenExpiryToMillis(expiresAt) {
  if (!expiresAt) return null;
  if (typeof expiresAt.toMillis === 'function') return expiresAt.toMillis();
  if (typeof expiresAt.toDate === 'function') return expiresAt.toDate().getTime();
  const parsed = new Date(expiresAt).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function validateRsvpTokenRedemption({ tokenData, requestBody = {}, nowMs = Date.now() }) {
  if (!tokenData) return { ok: false, reason: 'invalid' };
  if (tokenData.revoked === true || tokenData.disabled === true || tokenData.active === false) {
    return { ok: false, reason: 'revoked' };
  }
  if (tokenData.usedAt) return { ok: false, reason: 'reused' };

  const expiresAtMs = tokenExpiryToMillis(tokenData.expiresAt);
  if (!expiresAtMs || expiresAtMs <= nowMs) return { ok: false, reason: 'expired' };

  const requestedResponse = requestBody.response ? String(requestBody.response).trim() : '';
  if (requestedResponse && requestedResponse !== tokenData.response) {
    return { ok: false, reason: 'mismatched_response' };
  }

  const requestedGameId = normalizeId(requestBody.gameId || requestBody.eventId);
  if (requestedGameId && requestedGameId !== tokenData.gameId) {
    return { ok: false, reason: 'mismatched_event' };
  }

  const requestedPlayerId = normalizeId(requestBody.playerId || requestBody.childId);
  if (requestedPlayerId && requestedPlayerId !== tokenData.playerId) {
    return { ok: false, reason: 'mismatched_player' };
  }

  const requestedGuardianEmail = normalizeEmail(requestBody.guardianEmail || requestBody.email);
  if (requestedGuardianEmail && requestedGuardianEmail !== tokenData.guardianEmail) {
    return { ok: false, reason: 'mismatched_guardian' };
  }

  return { ok: true };
}

function buildRsvpTokenAuditPayload({ status, reason, tokenHash, teamId, gameId, playerId, guardianEmail, response }) {
  return {
    status,
    reason: reason || null,
    tokenHash: tokenHash || null,
    teamId: teamId || null,
    gameId: gameId || null,
    playerId: playerId || null,
    guardianEmail: guardianEmail || null,
    guardianEmailHash: guardianEmail ? hashGuardianEmail(guardianEmail) : null,
    response: response || null
  };
}

module.exports = {
  DEFAULT_TOKEN_TTL_MS,
  MAX_TOKEN_TTL_MS,
  VALID_RSVP_RESPONSES,
  normalizeEmail,
  hashRsvpToken,
  createRawRsvpToken,
  normalizeRsvpTokenCreateInput,
  buildScopedRsvpDocId,
  validateRsvpTokenRedemption,
  buildRsvpTokenAuditPayload
};
