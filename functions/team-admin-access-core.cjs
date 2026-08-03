'use strict';

function hasTeamAdminAccess({ team, user = {}, uid, email }) {
  if (user?.isAdmin === true) return true;
  const normalizedEmail = String(email || user?.email || user?.profileEmail || '').trim().toLowerCase();
  // Legacy owner aliases are an authorization boundary equivalent to
  // request.auth.token.email. Never recover them from a mutable/stale profile.
  const normalizedOwnerEmail = String(email || '').trim().toLowerCase();
  const ownerEmails = [team?.ownerEmailLower, team?.ownerEmail]
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
  const hasCanonicalOwner = Boolean(String(team?.ownerId || '').trim());
  const adminEmails = Array.isArray(team?.adminEmails)
    ? team.adminEmails.map((entry) => String(entry || '').trim().toLowerCase())
    : [];
  return Boolean(uid && team?.ownerId === uid) ||
    Boolean(!hasCanonicalOwner && normalizedOwnerEmail && ownerEmails.includes(normalizedOwnerEmail)) ||
    Boolean(normalizedEmail && adminEmails.includes(normalizedEmail));
}

function hasAdminInviteIssuerAccess({ team, user = {}, uid, authUser }) {
  if (!uid || !authUser || authUser.uid !== uid || authUser.disabled === true) return false;
  if (user?.isAdmin === true || team?.ownerId === uid) return true;

  const normalizedAuthEmail = String(authUser.email || '').trim().toLowerCase();
  const ownerEmails = [team?.ownerEmailLower, team?.ownerEmail]
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
  const hasCanonicalOwner = Boolean(String(team?.ownerId || '').trim());
  const adminEmails = Array.isArray(team?.adminEmails)
    ? team.adminEmails.map((entry) => String(entry || '').trim().toLowerCase())
    : [];
  return Boolean(normalizedAuthEmail && (
    (!hasCanonicalOwner && ownerEmails.includes(normalizedAuthEmail)) ||
    adminEmails.includes(normalizedAuthEmail)
  ));
}

module.exports = { hasAdminInviteIssuerAccess, hasTeamAdminAccess };
