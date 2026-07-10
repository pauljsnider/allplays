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

function getForwardedIp(headers = {}) {
  const forwardedFor = getHeaderValue(headers, 'x-forwarded-for');
  if (typeof forwardedFor !== 'string' || !forwardedFor.trim()) {
    return '';
  }

  return forwardedFor.split(',')[0].trim();
}

function getRequestIp(req = {}) {
  const candidates = [
    typeof req.ip === 'string' ? req.ip.trim() : '',
    getForwardedIp(req.headers),
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
