'use strict';

function normalizeAuthEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function resolveAuthenticatedFamilyInviteEmail({ auth, getUser }) {
  const uid = String(auth?.uid || '').trim();
  if (!uid) return '';

  const tokenEmail = normalizeAuthEmail(auth?.token?.email);
  if (tokenEmail) return tokenEmail;

  if (typeof getUser !== 'function') return '';
  const authUser = await getUser(uid);
  return normalizeAuthEmail(authUser?.email);
}

module.exports = {
  normalizeAuthEmail,
  resolveAuthenticatedFamilyInviteEmail
};
