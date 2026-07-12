'use strict';

function hasTeamAdminAccess({ team, user = {}, uid, email }) {
  if (user?.isAdmin === true) return true;
  const normalizedEmail = String(email || user?.email || user?.profileEmail || '').trim().toLowerCase();
  const adminEmails = Array.isArray(team?.adminEmails)
    ? team.adminEmails.map((entry) => String(entry || '').trim().toLowerCase())
    : [];
  return Boolean(uid && team?.ownerId === uid) || Boolean(normalizedEmail && adminEmails.includes(normalizedEmail));
}

module.exports = { hasTeamAdminAccess };
