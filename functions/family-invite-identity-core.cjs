'use strict';

function normalizeAuthEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function resolveAuthenticatedFamilyInviteIdentity({ auth, getUser }) {
  const uid = String(auth?.uid || '').trim();
  if (!uid) return { email: '', emailVerified: false };

  const token = auth?.token;
  if (token && Object.prototype.hasOwnProperty.call(token, 'email')) {
    return {
      email: normalizeAuthEmail(token.email),
      emailVerified: token.email_verified === true
    };
  }

  if (typeof getUser !== 'function') return { email: '', emailVerified: false };
  const authUser = await getUser(uid);
  if (authUser?.disabled === true) return { email: '', emailVerified: false };
  return {
    email: normalizeAuthEmail(authUser?.email),
    emailVerified: authUser?.emailVerified === true
  };
}

async function resolveAuthenticatedFamilyInviteEmail(options) {
  const identity = await resolveAuthenticatedFamilyInviteIdentity(options);
  return identity.emailVerified ? identity.email : '';
}

module.exports = {
  normalizeAuthEmail,
  resolveAuthenticatedFamilyInviteEmail,
  resolveAuthenticatedFamilyInviteIdentity
};
