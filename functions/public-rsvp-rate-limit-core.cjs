const crypto = require('node:crypto');

const PUBLIC_RSVP_RATE_LIMITS = Object.freeze({
  read: Object.freeze({ token: 60, network: 600 }),
  write: Object.freeze({ token: 20, network: 200 })
});

function buildPublicRsvpRateLimitBoundaries({ operation, token, ip } = {}) {
  const normalizedOperation = operation === 'write' ? 'write' : 'read';
  const tokenHash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  return [
    {
      scope: 'token',
      boundary: `${normalizedOperation}:token:${tokenHash}`,
      maxRequests: PUBLIC_RSVP_RATE_LIMITS[normalizedOperation].token
    },
    {
      scope: 'network',
      boundary: `${normalizedOperation}:network:${String(ip || 'unknown')}`,
      maxRequests: PUBLIC_RSVP_RATE_LIMITS[normalizedOperation].network
    }
  ];
}

module.exports = {
  PUBLIC_RSVP_RATE_LIMITS,
  buildPublicRsvpRateLimitBoundaries
};
