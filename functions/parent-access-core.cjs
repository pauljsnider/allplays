function normalizeParentScopeId(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= 128 && !normalized.includes('/') ? normalized : '';
}

function parseParentPlayerKey(value) {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split('::');
  if (parts.length !== 2) return null;
  const teamId = normalizeParentScopeId(parts[0]);
  const playerId = normalizeParentScopeId(parts[1]);
  if (!teamId || !playerId) return null;
  return { teamId, playerId, playerKey: `${teamId}::${playerId}` };
}

function normalizeParentLink(link = {}) {
  if (!link || typeof link !== 'object' || Array.isArray(link)) return null;
  const teamId = normalizeParentScopeId(link.teamId);
  const playerId = normalizeParentScopeId(link.playerId);
  if (!teamId || !playerId) return null;
  return { ...link, teamId, playerId };
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
}

function resolveCanonicalParentAccess(userData = {}) {
  const user = userData && typeof userData === 'object' ? userData : {};
  const hasCanonicalParentTeamIds = Object.prototype.hasOwnProperty.call(user, 'parentTeamIds');
  const hasCanonicalParentPlayerKeys = Object.prototype.hasOwnProperty.call(user, 'parentPlayerKeys');
  const canonicalTeamIds = new Set(
    (hasCanonicalParentTeamIds && Array.isArray(user.parentTeamIds) ? user.parentTeamIds : [])
      .map(normalizeParentScopeId)
      .filter(Boolean)
  );
  const canonicalPlayerLinks = (hasCanonicalParentPlayerKeys && Array.isArray(user.parentPlayerKeys)
    ? user.parentPlayerKeys
    : [])
    .map(parseParentPlayerKey)
    .filter(Boolean)
    .filter((link) => !hasCanonicalParentTeamIds || canonicalTeamIds.has(link.teamId));
  const metadataByPlayerKey = new Map();
  (Array.isArray(user.parentOf) ? user.parentOf : []).forEach((rawLink) => {
    const link = normalizeParentLink(rawLink);
    if (!link) return;
    const playerKey = `${link.teamId}::${link.playerId}`;
    if (!metadataByPlayerKey.has(playerKey)) metadataByPlayerKey.set(playerKey, link);
  });

  let parentLinks;
  if (hasCanonicalParentPlayerKeys) {
    parentLinks = canonicalPlayerLinks.map((link) => (
      metadataByPlayerKey.get(link.playerKey) || { teamId: link.teamId, playerId: link.playerId }
    ));
  } else if (hasCanonicalParentTeamIds) {
    // A team-only canonical profile does not prove which child links remain.
    parentLinks = [];
  } else {
    parentLinks = [...metadataByPlayerKey.values()];
  }

  const parentPlayerKeys = hasCanonicalParentPlayerKeys
    ? canonicalPlayerLinks.map((link) => link.playerKey)
    : hasCanonicalParentTeamIds
      ? []
      : parentLinks.map((link) => `${link.teamId}::${link.playerId}`);
  const parentTeamIds = hasCanonicalParentTeamIds
    ? [...canonicalTeamIds]
    : [...new Set(parentPlayerKeys.map((key) => parseParentPlayerKey(key)?.teamId).filter(Boolean))];

  return {
    parentLinks,
    parentTeamIds,
    parentPlayerKeys,
    hasCanonicalParentTeamIds,
    hasCanonicalParentPlayerKeys
  };
}

function addCanonicalParentAccessLink(userData = {}, rawLink = {}) {
  const link = normalizeParentLink(rawLink);
  if (!link) throw new Error('Parent access requires a valid team and player.');

  const current = resolveCanonicalParentAccess(userData);
  const playerKey = `${link.teamId}::${link.playerId}`;
  const parentLinks = [
    ...current.parentLinks.filter((existing) => (
      `${existing.teamId}::${existing.playerId}` !== playerKey
    )),
    link
  ];
  const parentPlayerKeys = uniqueStrings([...current.parentPlayerKeys, playerKey]);
  const parentTeamIds = uniqueStrings([...current.parentTeamIds, link.teamId]);

  return { parentOf: parentLinks, parentTeamIds, parentPlayerKeys };
}

function removeCanonicalParentAccessLinks(userData = {}, rawTargets = []) {
  const current = resolveCanonicalParentAccess(userData);
  const targetKeys = new Set();
  (Array.isArray(rawTargets) ? rawTargets : [rawTargets]).forEach((target) => {
    const parsed = typeof target === 'string'
      ? parseParentPlayerKey(target)
      : normalizeParentLink(target);
    if (!parsed) return;
    targetKeys.add(`${parsed.teamId}::${parsed.playerId}`);
  });
  const targetTeamIds = new Set(
    [...targetKeys].map((key) => parseParentPlayerKey(key)?.teamId).filter(Boolean)
  );
  const parentPlayerKeys = current.parentPlayerKeys.filter((key) => !targetKeys.has(key));
  const remainingTeamIdsFromPlayers = new Set(
    parentPlayerKeys.map((key) => parseParentPlayerKey(key)?.teamId).filter(Boolean)
  );
  const parentTeamIds = current.parentTeamIds.filter((teamId) => (
    !targetTeamIds.has(teamId) || remainingTeamIdsFromPlayers.has(teamId)
  ));
  const parentOf = current.parentLinks.filter((link) => (
    !targetKeys.has(`${link.teamId}::${link.playerId}`)
  ));
  const roles = uniqueStrings(userData.roles)
    .filter((role) => role !== 'parent' || parentTeamIds.length > 0 || parentPlayerKeys.length > 0);

  return { parentOf, parentTeamIds, parentPlayerKeys, roles };
}

function mergeCanonicalParentAccess(destination = {}, source = {}) {
  const destinationAccess = resolveCanonicalParentAccess(destination);
  const sourceAccess = resolveCanonicalParentAccess(source);
  const linksByKey = new Map();
  [...destinationAccess.parentLinks, ...sourceAccess.parentLinks].forEach((link) => {
    const key = `${link.teamId}::${link.playerId}`;
    linksByKey.set(key, { ...(linksByKey.get(key) || {}), ...link });
  });
  const parentPlayerKeys = uniqueStrings([
    ...destinationAccess.parentPlayerKeys,
    ...sourceAccess.parentPlayerKeys
  ]);
  const parentTeamIds = uniqueStrings([
    ...destinationAccess.parentTeamIds,
    ...sourceAccess.parentTeamIds
  ]);

  return {
    parentOf: [...linksByKey.values()].filter((link) => (
      parentPlayerKeys.includes(`${link.teamId}::${link.playerId}`)
    )),
    parentTeamIds,
    parentPlayerKeys
  };
}

module.exports = {
  addCanonicalParentAccessLink,
  mergeCanonicalParentAccess,
  normalizeParentScopeId,
  parseParentPlayerKey,
  removeCanonicalParentAccessLinks,
  resolveCanonicalParentAccess
};
