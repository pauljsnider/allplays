function compactString(value) {
  return value == null ? '' : String(value).trim();
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(compactString)
    .filter(Boolean))];
}

function isTargetParentLink(link = {}, teamId, playerId) {
  return compactString(link.teamId) === teamId && compactString(link.playerId) === playerId;
}

function buildRevokedParentAccess(userData = {}, target = {}) {
  const teamId = compactString(target.teamId);
  const playerId = compactString(target.playerId);
  if (!teamId || !playerId) {
    throw new Error('Household access revocation requires a team and player.');
  }

  const parentOf = (Array.isArray(userData.parentOf) ? userData.parentOf : [])
    .filter((link) => !isTargetParentLink(link, teamId, playerId));
  const parentTeamIds = uniqueStrings(parentOf.map((link) => link?.teamId));
  const parentPlayerKeys = uniqueStrings(parentOf.map((link) => (
    link?.teamId && link?.playerId ? `${link.teamId}::${link.playerId}` : ''
  )));
  const roles = uniqueStrings(userData.roles)
    .filter((role) => role !== 'parent' || parentOf.length > 0);

  return {
    parentOf,
    parentTeamIds,
    parentPlayerKeys,
    roles
  };
}

function buildRevokedPrivatePlayerAccess(privateProfile = {}, invitedUserId) {
  const userId = compactString(invitedUserId);
  if (!userId) return { parents: Array.isArray(privateProfile.parents) ? privateProfile.parents : [] };
  return {
    parents: (Array.isArray(privateProfile.parents) ? privateProfile.parents : [])
      .filter((parent) => compactString(parent?.userId) !== userId)
  };
}

function isMatchingHouseholdAccessCode(code = {}, organizerUserId, membershipId) {
  return compactString(code.type) === 'household_invite' &&
    compactString(code.organizerUserId) === organizerUserId &&
    compactString(code.familyMembershipId) === membershipId;
}

function hasIndependentPlayerAccessReference({
  accessCodes = [],
  revokedCodeIds = [],
  invitedUserId,
  teamId,
  playerId,
  player = {}
} = {}) {
  const userId = compactString(invitedUserId);
  const targetTeamId = compactString(teamId);
  const targetPlayerId = compactString(playerId);
  if (!userId || !targetTeamId || !targetPlayerId) return false;

  const revokedIds = new Set((Array.isArray(revokedCodeIds) ? revokedCodeIds : []).map(compactString));
  const parentGrantTypes = new Set(['parent_invite', 'household_invite', 'coparent_invite']);
  const hasAnotherAcceptedCode = (Array.isArray(accessCodes) ? accessCodes : []).some((code) => {
    const status = compactString(code?.status).toLowerCase();
    return !revokedIds.has(compactString(code?.id)) &&
      parentGrantTypes.has(compactString(code?.type)) &&
      code?.used === true &&
      code?.revoked !== true &&
      !['removed', 'revoked'].includes(status) &&
      compactString(code?.usedBy) === userId &&
      compactString(code?.teamId) === targetTeamId &&
      compactString(code?.playerId) === targetPlayerId;
  });
  if (hasAnotherAcceptedCode) return true;

  return (Array.isArray(player?.parents) ? player.parents : []).some((parent) => {
    const status = compactString(parent?.status).toLowerCase();
    return compactString(parent?.userId) === userId && !['removed', 'revoked'].includes(status);
  });
}

function buildHouseholdAccessRevocationPlan({
  organizerUserId,
  membershipId,
  membership = {},
  accessCodes = [],
  userData = {},
  player = {},
  privateProfile = {},
  timestamp
} = {}) {
  const organizerId = compactString(organizerUserId);
  const memberId = compactString(membershipId);
  if (!organizerId || !memberId) {
    throw new Error('Household access revocation requires an organizer and membership.');
  }
  if (compactString(membership.organizerUserId) !== organizerId) {
    throw new Error('Only the household organizer can revoke this membership.');
  }

  const membershipStatus = compactString(membership.status).toLowerCase();
  if (!['pending', 'active', 'removed'].includes(membershipStatus)) {
    throw new Error('Household membership is not in a revocable state.');
  }

  const matchingCodes = (Array.isArray(accessCodes) ? accessCodes : [])
    .filter((code) => isMatchingHouseholdAccessCode(code, organizerId, memberId));
  const invitedUserId = compactString(membership.userId) ||
    compactString(matchingCodes.find((code) => compactString(code.usedBy))?.usedBy);
  const teamId = compactString(membership.teamId);
  const playerId = compactString(membership.playerId);
  if ((!teamId || !playerId) && invitedUserId) {
    throw new Error('Household membership is missing its delegated player link.');
  }
  const matchingCodeIds = matchingCodes.map((code) => compactString(code.id)).filter(Boolean);
  const preservedPlayerAccess = invitedUserId
    ? hasIndependentPlayerAccessReference({
        accessCodes,
        revokedCodeIds: matchingCodeIds,
        invitedUserId,
        teamId,
        playerId,
        player
      })
    : false;
  const auditTimestamp = timestamp || new Date().toISOString();

  const plan = {
    teamId,
    playerId,
    invitedUserId,
    preservedPlayerAccess,
    membershipUpdate: {
      status: 'removed',
      accessStatus: 'revoked',
      removedAt: auditTimestamp,
      revokedAt: auditTimestamp,
      revokedBy: organizerId,
      updatedAt: auditTimestamp
    },
    accessCodeUpdates: matchingCodes.map((code) => ({
      id: compactString(code.id),
      update: {
        revoked: true,
        status: 'revoked',
        revokedAt: auditTimestamp,
        revokedBy: organizerId,
        updatedAt: auditTimestamp
      }
    })).filter((entry) => entry.id)
  };

  if (invitedUserId && !preservedPlayerAccess) {
    plan.userUpdate = buildRevokedParentAccess(userData, { teamId, playerId });
    plan.privateProfileUpdate = buildRevokedPrivatePlayerAccess(privateProfile, invitedUserId);
  }

  return plan;
}

module.exports = {
  buildHouseholdAccessRevocationPlan,
  buildRevokedParentAccess,
  buildRevokedPrivatePlayerAccess,
  hasIndependentPlayerAccessReference,
  isMatchingHouseholdAccessCode
};
