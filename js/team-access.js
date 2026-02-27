/**
 * Check whether a user has full team management access.
 * Full access means owner, team admin email, platform admin, or coach assignment.
 */
export function hasFullTeamAccess(user, team) {
  if (!user || !team) return false;

  const isOwner = team.ownerId === user.uid;
  const normalizedEmail = (user.email || '').toLowerCase();
  const adminEmails = (team.adminEmails || []).map((email) => String(email || '').toLowerCase());
  const isTeamAdmin = adminEmails.includes(normalizedEmail);
  const isPlatformAdmin = user.isAdmin === true;

  return isOwner || isTeamAdmin || isPlatformAdmin;
}

/**
 * Determine user's access level for a team.
 * @returns {{ hasAccess: boolean, accessLevel: 'full'|'parent'|null, exitUrl: string }}
 */
export function getTeamAccessInfo(user, team) {
  if (!user || !team) {
    return { hasAccess: false, accessLevel: null, exitUrl: 'index.html' };
  }

  if (hasFullTeamAccess(user, team)) {
    return { hasAccess: true, accessLevel: 'full', exitUrl: 'dashboard.html' };
  }

  const isParent = (user.parentOf || []).some((p) => p.teamId === team.id);
  if (isParent) {
    return { hasAccess: true, accessLevel: 'parent', exitUrl: 'parent-dashboard.html' };
  }

  return { hasAccess: false, accessLevel: null, exitUrl: 'index.html' };
}
