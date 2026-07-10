const net = require('node:net');
const { isPrivateIpAddress } = require('./utils/ip-address-validation.js');

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getHeaderValue(headers = {}, name = '') {
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

module.exports = {
  createInMemoryRateLimiter,
  getRequestIp
};
