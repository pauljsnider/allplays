'use strict';

function normalizeAuthEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function resolveAuthenticatedFamilyInviteEmail({ auth, getUser }) {
  const uid = String(auth?.uid || '').trim();
  if (!uid) return '';

  const token = auth?.token;
  if (token && Object.prototype.hasOwnProperty.call(token, 'email')) {
    if (token.email_verified !== true) return '';
    return normalizeAuthEmail(token.email);
  }

  if (typeof getUser !== 'function') return '';
  const authUser = await getUser(uid);
  if (authUser?.emailVerified !== true || authUser?.disabled === true) return '';
  return normalizeAuthEmail(authUser?.email);
}

module.exports = {
  normalizeAuthEmail,
  resolveAuthenticatedFamilyInviteEmail
};
