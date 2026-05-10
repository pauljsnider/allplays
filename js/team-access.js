function getNormalizedUserEmail(user) {
  return String(user?.email || user?.profileEmail || '').trim().toLowerCase();
}

export function normalizeAdminEmailList(adminEmails) {
  return Array.from(
    new Set(
      (Array.isArray(adminEmails) ? adminEmails : [])
        .map((email) => String(email || '').trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function normalizeStreamVolunteerEmailList(streamVolunteerEmails) {
  return normalizeAdminEmailList(streamVolunteerEmails);
}

/**
 * Check whether a user has full team management access.
 * Full access means owner, team admin email, or platform admin.
 */
export function hasFullTeamAccess(user, team) {
  if (!user || !team) return false;

  const isOwner = team.ownerId === user.uid;
  const normalizedEmail = getNormalizedUserEmail(user);
  const adminEmails = normalizeAdminEmailList(team.adminEmails);
  const isTeamAdmin = adminEmails.includes(normalizedEmail);
  const isPlatformAdmin = user.isAdmin === true;

  return isOwner || isTeamAdmin || isPlatformAdmin;
}

function isScheduledGame(game) {
  if (!game) return false;
  const status = String(game.status || game.liveStatus || '').toLowerCase();
  return status !== 'cancelled' && status !== 'deleted';
}

function hasConfirmedRsvp(rsvp) {
  const response = String(rsvp?.response || rsvp?.status || '').trim().toLowerCase();
  return ['going', 'yes', 'confirmed', 'attending'].includes(response);
}

/**
 * Check whether a user can use limited stream actions for a scheduled event.
 * Stream access never implies full team management access.
 */
export function hasStreamTeamAccess(user, team, game = null, rsvp = null) {
  if (!user || !team || !isScheduledGame(game)) return false;
  if (hasFullTeamAccess(user, team)) return true;

  if (team.teamPermissions?.streaming) {
    const permissions = normalizeTeamPermissions(team.teamPermissions);
    const streaming = permissions.streaming;
    if (streaming.mode === 'all_confirmed' && hasConfirmedRsvp(rsvp)) {
      return true;
    }
    if (streaming.mode === 'selected' && normalizeMemberIdList(streaming.memberIds).includes(String(user.uid || '').trim())) {
      return true;
    }
  }

  const mode = String(team.streamAccessMode || 'admins').trim().toLowerCase();
  if (mode === 'confirmed_members' || mode === 'all_confirmed') {
    return hasConfirmedRsvp(rsvp);
  }

  if (mode === 'selected_volunteers' || mode === 'selected') {
    const normalizedEmail = getNormalizedUserEmail(user);
    const streamVolunteerEmails = normalizeStreamVolunteerEmailList(team.streamVolunteerEmails);
    return Boolean(normalizedEmail && streamVolunteerEmails.includes(normalizedEmail));
  }

  return false;
}


/**
 * Check whether a user can scorekeep a scheduled game without full team access.
 * Scorekeeping access never implies team management, roster, schedule, or settings access.
 */
export function hasScorekeepingTeamAccess(user, team, game = null, rsvp = null) {
  if (!user || !team || !isScheduledGame(game)) return false;
  if (hasFullTeamAccess(user, team)) return true;

  if (!team.teamPermissions?.scorekeeping) return false;

  const permissions = normalizeTeamPermissions(team.teamPermissions);
  const scorekeeping = permissions.scorekeeping;
  if (scorekeeping.mode === 'all_confirmed') {
    return hasConfirmedRsvp(rsvp);
  }

  return normalizeMemberIdList(scorekeeping.memberIds).includes(String(user.uid || '').trim());
}

/**
 * Determine user's access level for a team.
 * @returns {{ hasAccess: boolean, accessLevel: 'full'|'scorekeep'|'stream'|'parent'|null, exitUrl: string }}
 */
export function getTeamAccessInfo(user, team, options = {}) {
  if (!user || !team) {
    return { hasAccess: false, accessLevel: null, exitUrl: 'index.html' };
  }

  if (hasFullTeamAccess(user, team)) {
    return { hasAccess: true, accessLevel: 'full', exitUrl: 'dashboard.html' };
  }

  if (hasScorekeepingTeamAccess(user, team, options.game, options.rsvp)) {
    const teamExitUrl = team.id ? `team.html#teamId=${team.id}` : 'team.html';
    return { hasAccess: true, accessLevel: 'scorekeep', exitUrl: teamExitUrl };
  }

  if (hasStreamTeamAccess(user, team, options.game, options.rsvp)) {
    const teamExitUrl = team.id ? `team.html#teamId=${team.id}` : 'team.html';
    return { hasAccess: true, accessLevel: 'stream', exitUrl: teamExitUrl };
  }

  const isParent = (user.parentOf || []).some((p) => p.teamId === team.id);
  if (isParent) {
    return { hasAccess: true, accessLevel: 'parent', exitUrl: 'parent-dashboard.html' };
  }

  return { hasAccess: false, accessLevel: null, exitUrl: 'index.html' };
}

function normalizeMemberIdList(memberIds) {
  return Array.from(
    new Set(
      (Array.isArray(memberIds) ? memberIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    )
  );
}

function normalizeCapabilityPermission(permission) {
  const mode = permission?.mode === 'selected' ? 'selected' : 'all_confirmed';
  return {
    mode,
    memberIds: mode === 'selected' ? normalizeMemberIdList(permission?.memberIds) : []
  };
}

function normalizeSelectedMemberPermission(permission) {
  return {
    mode: 'selected',
    memberIds: normalizeMemberIdList(permission?.memberIds)
  };
}

export function normalizeTeamPermissions(teamPermissions = {}) {
  return {
    scorekeeping: normalizeCapabilityPermission(teamPermissions.scorekeeping),
    streaming: normalizeCapabilityPermission(teamPermissions.streaming),
    videography: normalizeSelectedMemberPermission(teamPermissions.videography)
  };
}
