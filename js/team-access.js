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
  if (!user || !team) return false; // Basic checks first

  if (hasFullTeamAccess(user, team)) return true; // Full access short-circuits

  // Case 1: No game context provided. This is where the config access check happens.
  if (!game) {
    if (team.teamPermissions?.streaming) {
      const permissions = normalizeTeamPermissions(team.teamPermissions);
      const streaming = permissions.streaming;
      // If stream access mode is 'selected' and the user's UID is in the memberIds,
      // grant access *for config purposes*.
      if (streaming.mode === 'selected' && normalizeMemberIdList(streaming.memberIds).includes(String(user.uid || '').trim())) {
        return true;
      }
    }
    // Check for legacy streamAccessMode config when no game is present
    const mode = String(team.streamAccessMode || '').trim().toLowerCase(); // Initialize mode here for config checks
    if (mode === 'selected_volunteers' || mode === 'selected') {
        const normalizedEmail = getNormalizedUserEmail(user);
        const streamVolunteerEmails = normalizeStreamVolunteerEmailList(team.streamVolunteerEmails);
        return Boolean(normalizedEmail && streamVolunteerEmails.includes(normalizedEmail));
    }

    // For all other cases when no game is present, and it's not the specific config access path above,
    // we should NOT grant stream access.
    return false;
  }

  // Case 2: A game context is provided. Proceed with game-specific stream access logic.
  if (!isScheduledGame(game)) return false;

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
 * Check whether a user has videographer access for a team.
 * Videography is always a selected-member-only permission.
 */
export function hasVideographerTeamAccess(user, team) {
  if (!user || !team) return false;
  if (hasFullTeamAccess(user, team)) return true;
  if (!team.teamPermissions?.videography) return false;
  const permissions = normalizeTeamPermissions(team.teamPermissions);
  return normalizeMemberIdList(permissions.videography.memberIds).includes(String(user.uid || '').trim());
}

function hasTeamMediaUploadGrant(user, teamId) {
  const normalizedTeamId = String(teamId || '').trim();
  if (!user || !normalizedTeamId) return false;

  return normalizeMemberIdList(user.teamMediaUploadTeamIds).includes(normalizedTeamId) ||
    normalizeMemberIdList(user.mediaUploadTeamIds).includes(normalizedTeamId);
}

/**
 * Check whether a user has delegated Team Media upload access.
 * Media upload access never implies full team management access.
 */
export function hasTeamMediaAccess(user, team) {
  if (!user || !team) return false;
  if (hasFullTeamAccess(user, team)) return true;
  return hasTeamMediaUploadGrant(user, team.id);
}

/**
 * Determine user's access level for a team.
 * @returns {{ hasAccess: boolean, accessLevel: 'full'|'scorekeep'|'stream'|'stream-score'|'videographer'|'media'|'parent'|null, exitUrl: string }}
 */
function hasParentTeamAccess(user, teamId) {
  if (!user || !teamId) return false;

  if ((Array.isArray(user.parentOf) ? user.parentOf : []).some((p) => p?.teamId === teamId)) {
    return true;
  }

  return (Array.isArray(user.parentPlayerKeys) ? user.parentPlayerKeys : []).some((key) => {
    const raw = String(key || '');
    const separatorIndex = raw.indexOf('::');
    return separatorIndex > 0 && raw.slice(0, separatorIndex) === teamId;
  });
}

export function getTeamAccessInfo(user, team, options = {}) {
  if (!user || !team) {
    return { hasAccess: false, accessLevel: null, exitUrl: 'index.html' };
  }

  if (hasFullTeamAccess(user, team)) {
    return { hasAccess: true, accessLevel: 'full', exitUrl: 'dashboard.html' };
  }

  const teamExitUrl = team.id ? `team.html#teamId=${team.id}` : 'team.html';
  const canScorekeep = hasScorekeepingTeamAccess(user, team, options.game, options.rsvp);
  const canStream = hasStreamTeamAccess(user, team, options.game, options.rsvp);

  if (canScorekeep && canStream) {
    return { hasAccess: true, accessLevel: 'stream-score', exitUrl: teamExitUrl };
  }

  if (canScorekeep) {
    return { hasAccess: true, accessLevel: 'scorekeep', exitUrl: teamExitUrl };
  }

  if (canStream) {
    return { hasAccess: true, accessLevel: 'stream', exitUrl: teamExitUrl };
  }

  if (hasVideographerTeamAccess(user, team)) {
    return { hasAccess: true, accessLevel: 'videographer', exitUrl: teamExitUrl };
  }

  if (hasTeamMediaAccess(user, team)) {
    return { hasAccess: true, accessLevel: 'media', exitUrl: teamExitUrl };
  }

  if (hasParentTeamAccess(user, team.id)) {
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
