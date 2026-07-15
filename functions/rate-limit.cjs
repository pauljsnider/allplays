const net = require('node:net');
const crypto = require('node:crypto');
const { isPrivateIpAddress } = require('./utils/ip-address-validation.js');

const MAX_RATE_LIMIT_BOUNDARY_BYTES = 2_048;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getHeaderValue(headers = {}, name = '') {
  headers = headers || {};
  const direct = headers[name] || headers[name.toLowerCase()];
  if (direct !== undefined) {
    return Array.isArray(direct) ? direct[0] : direct;
  }

  const matchingKey = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  const value = matchingKey ? headers[matchingKey] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

function normalizeIp(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice('::ffff:'.length);
    if (net.isIP(mappedIpv4) === 4) {
      return mappedIpv4;
    }
  }
  return normalized;
}

function getForwardedIp(req = {}) {
  const forwardedFor = getHeaderValue(req.headers, 'x-forwarded-for');
  if (typeof forwardedFor !== 'string' || !forwardedFor.trim()) {
    return '';
  }

  const forwardedCandidates = forwardedFor.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const trustedHops = [
    req.ip,
    req.socket?.remoteAddress,
    req.connection?.remoteAddress
  ].map(normalizeIp).filter(Boolean);
  const trustedHopIndex = forwardedCandidates.findLastIndex((candidate) => {
    const normalizedCandidate = normalizeIp(candidate);
    return trustedHops.includes(normalizedCandidate);
  });

  if (trustedHopIndex <= 0 || trustedHopIndex !== forwardedCandidates.length - 1) {
    return '';
  }

  const clientCandidate = forwardedCandidates[trustedHopIndex - 1];
  return !isPrivateIpAddress(clientCandidate) ? clientCandidate : '';
}

function getRequestIp(req = {}) {
  const candidates = [
    typeof req.ip === 'string' ? req.ip.trim() : '',
    getForwardedIp(req),
    req.socket?.remoteAddress,
    req.connection?.remoteAddress
  ].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());

  return candidates.find((value) => !isPrivateIpAddress(value)) || candidates[0] || 'unknown';
}

function createInMemoryRateLimiter({ windowMs = 60_000, maxRequests = 120, maxKeys = 2_000 } = {}) {
  const hitsByKey = new Map();
  const configuredWindowMs = parsePositiveInteger(windowMs, 60_000);
  const configuredMaxRequests = parsePositiveInteger(maxRequests, 120);
  const configuredMaxKeys = parsePositiveInteger(maxKeys, 2_000);

  function prune(now) {
    for (const [key, entry] of hitsByKey.entries()) {
      if (entry.resetAt <= now || hitsByKey.size > configuredMaxKeys) {
        hitsByKey.delete(key);
      }
    }
  }

  return function checkRateLimit(req = {}, now = Date.now()) {
    prune(now);

    const key = getRequestIp(req);
    const existing = hitsByKey.get(key);
    const entry = existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + configuredWindowMs };

    entry.count += 1;
    hitsByKey.set(key, entry);

    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return {
      allowed: entry.count <= configuredMaxRequests,
      retryAfterSeconds,
      remaining: Math.max(0, configuredMaxRequests - entry.count)
    };
  };
}

function createFirestoreFixedWindowRateLimiter({
  firestore,
  collectionName,
  windowMs = 60_000,
  maxRequests = 120
} = {}) {
  if (!firestore || typeof firestore.runTransaction !== 'function') {
    throw new TypeError('A Firestore instance with transaction support is required.');
  }
  if (typeof collectionName !== 'string' || !collectionName.trim()) {
    throw new TypeError('A Firestore collection name is required.');
  }

  const configuredWindowMs = parsePositiveInteger(windowMs, 60_000);
  const configuredMaxRequests = parsePositiveInteger(maxRequests, 120);
  const rateLimitCollection = firestore.collection(collectionName.trim());

  return async function reserveRateLimitSlot(boundary, now = Date.now()) {
    if ((typeof boundary !== 'string' && typeof boundary !== 'number')
      || (typeof boundary === 'number' && !Number.isFinite(boundary))) {
      throw new TypeError('A string or finite number rate-limit boundary is required.');
    }
    const normalizedBoundary = String(boundary).trim();
    if (!normalizedBoundary) {
      throw new TypeError('A non-empty rate-limit boundary is required.');
    }
    if (Buffer.byteLength(normalizedBoundary, 'utf8') > MAX_RATE_LIMIT_BOUNDARY_BYTES) {
      throw new RangeError('The rate-limit boundary is too long.');
    }
    const documentId = crypto.createHash('sha256').update(normalizedBoundary, 'utf8').digest('hex');
    const limitRef = rateLimitCollection.doc(documentId);

    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(limitRef);
      const existing = snapshot.exists ? snapshot.data() || {} : {};
      const existingResetAt = Number(existing.resetAt);
      const windowActive = Number.isFinite(existingResetAt) && existingResetAt > now;
      const resetAt = windowActive ? existingResetAt : now + configuredWindowMs;
      const existingCount = Number(existing.count);
      const count = windowActive
        && Number.isSafeInteger(existingCount)
        && existingCount >= 0
        && existingCount < Number.MAX_SAFE_INTEGER
        ? existingCount + 1
        : 1;

      transaction.set(limitRef, { count, resetAt });

      return {
        allowed: count <= configuredMaxRequests,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
        remaining: Math.max(0, configuredMaxRequests - count)
      };
    });
  };
}

module.exports = {
  createFirestoreFixedWindowRateLimiter,
  createInMemoryRateLimiter,
  getRequestIp
};
