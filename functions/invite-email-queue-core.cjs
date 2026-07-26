'use strict';

function sanitizeInviteMailIdPart(value, maxLength = 240) {
  return String(value || '').replace(/[^\w.-]+/g, '_').slice(0, maxLength);
}

function buildInviteMailDocId(codeId, options = {}) {
  const safeCodeId = sanitizeInviteMailIdPart(codeId);
  if (options.forceNewDelivery !== true) return `invite_${safeCodeId}`;
  const safeDeliveryId = sanitizeInviteMailIdPart(options.deliveryId, 80);
  if (!safeDeliveryId) {
    throw new Error('A delivery ID is required for an invite email resend.');
  }
  return `invite_${safeCodeId}_retry_${safeDeliveryId}`;
}

module.exports = {
  buildInviteMailDocId,
  sanitizeInviteMailIdPart
};
