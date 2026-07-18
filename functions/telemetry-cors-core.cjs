'use strict';

const { isAllowedPublicRsvpOrigin } = require('./public-rsvp-cors-core.cjs');

function isAllowedTelemetryOrigin(origin, configuredOriginSet = new Set()) {
  if (typeof origin !== 'string' || !origin) return false;
  return isAllowedPublicRsvpOrigin(origin)
    || configuredOriginSet?.has?.(origin) === true;
}

module.exports = { isAllowedTelemetryOrigin };
