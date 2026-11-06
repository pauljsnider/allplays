"use strict";

// OAuth client IDs are opaque identity values, not Firestore path segments.
// The real broker binds callbacks with `${trustedClientId}.${base64urlDigest}`.
// Authentication still verifies the broker grant; this only bounds its shape.
const isBrokerClientId = (value) => typeof value === 'string' && /^[A-Za-z0-9._~-]{1,256}$/.test(value);
module.exports = { isBrokerClientId };
