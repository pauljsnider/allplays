'use strict';

function getCanonicalOwnerIdState(team = {}) {
  if (!Object.prototype.hasOwnProperty.call(team || {}, 'ownerId')) {
    return { state: 'legacy', ownerId: '' };
  }
  const ownerId = team.ownerId;
  if (ownerId === '') return { state: 'legacy', ownerId: '' };
  if (typeof ownerId === 'string'
    && ownerId === ownerId.trim()
    && ownerId.length <= 128
    && !ownerId.includes('/')) {
    return { state: 'canonical', ownerId };
  }
  return { state: 'invalid', ownerId: '' };
}

function hasTeamAdminAccess({ team, user = {}, uid, email }) {
  if (user?.isAdmin === true) return true;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  // Legacy owner aliases are an authorization boundary equivalent to
  // request.auth.token.email. Never recover them from a mutable/stale profile.
  const normalizedOwnerEmail = String(email || '').trim().toLowerCase();
  const ownerEmails = [...new Set([team?.ownerEmailLower, team?.ownerEmail]
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean))];
  const owner = getCanonicalOwnerIdState(team);
  const adminEmails = Array.isArray(team?.adminEmails)
    ? team.adminEmails.map((entry) => String(entry || '').trim().toLowerCase())
    : [];
  return Boolean(uid && owner.state === 'canonical' && owner.ownerId === uid) ||
    Boolean(owner.state === 'legacy' && ownerEmails.length === 1 && normalizedOwnerEmail === ownerEmails[0]) ||
    Boolean(normalizedEmail && adminEmails.includes(normalizedEmail));
}

function hasAdminInviteIssuerAccess({ team, user = {}, uid, authUser }) {
  if (!uid || !authUser || authUser.uid !== uid || authUser.disabled === true) return false;
  const owner = getCanonicalOwnerIdState(team);
  if (user?.isAdmin === true || (owner.state === 'canonical' && owner.ownerId === uid)) return true;

  const normalizedAuthEmail = String(authUser.email || '').trim().toLowerCase();
  const ownerEmails = [...new Set([team?.ownerEmailLower, team?.ownerEmail]
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean))];
  const adminEmails = Array.isArray(team?.adminEmails)
    ? team.adminEmails.map((entry) => String(entry || '').trim().toLowerCase())
    : [];
  return Boolean(normalizedAuthEmail && (
    (owner.state === 'legacy' && ownerEmails.length === 1 && ownerEmails[0] === normalizedAuthEmail) ||
    adminEmails.includes(normalizedAuthEmail)
  ));
}

module.exports = { getCanonicalOwnerIdState, hasAdminInviteIssuerAccess, hasTeamAdminAccess };
