'use strict';

const FRIEND_INVITE_REDEMPTION_ERROR_MESSAGE = 'Unable to redeem friend invite.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

function normalizeVerifiedRecipientEmail(token) {
  if (token?.email_verified !== true || typeof token.email !== 'string') return '';
  const email = token.email.trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : '';
}

function normalizeVerifiedRecipientPhone(token) {
  if (typeof token?.phone_number !== 'string') return '';
  const phone = token.phone_number;
  return E164_PHONE_PATTERN.test(phone) ? phone : '';
}

function extractVerifiedFriendInviteRecipientIdentities(auth, HttpsError) {
  const uid = typeof auth?.uid === 'string' ? auth.uid : '';
  const token = auth?.token && typeof auth.token === 'object' && !Array.isArray(auth.token)
    ? auth.token
    : null;
  const email = normalizeVerifiedRecipientEmail(token);
  const phone = normalizeVerifiedRecipientPhone(token);

  if (!uid || !token || (!email && !phone)) {
    throw new HttpsError('permission-denied', FRIEND_INVITE_REDEMPTION_ERROR_MESSAGE);
  }

  return { uid, email, phone };
}

module.exports = {
  FRIEND_INVITE_REDEMPTION_ERROR_MESSAGE,
  extractVerifiedFriendInviteRecipientIdentities,
  normalizeVerifiedRecipientEmail,
  normalizeVerifiedRecipientPhone
};
