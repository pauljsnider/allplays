function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getRequestIp(req = {}) {
  if (typeof req.ip === 'string' && req.ip.trim()) {
    return req.ip.trim();
  }

  const forwardedFor = req.headers?.['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  if (typeof forwardedValue === 'string' && forwardedValue.trim()) {
    return forwardedValue.split(',')[0].trim();
  }

  return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
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
