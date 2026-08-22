function compactString(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeParentScopeId(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= 128 && !normalized.includes('/') ? normalized : '';
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  const millis = date?.getTime?.();
  return Number.isFinite(millis) ? millis : 0;
}

function isFamilyShareTokenReadable(token = {}, nowMs = Date.now()) {
  if (!token || typeof token !== 'object') return false;
  if (token.active === false || token.revoked === true || token.revokedAt) return false;
  const expiresAtMs = toMillis(token.expiresAt);
  return expiresAtMs === 0 || expiresAtMs > nowMs;
}

function isTeamActive(team = {}) {
  const status = compactString(team.status).toLowerCase();
  return team.active !== false &&
    team.archived !== true &&
    !['archived', 'inactive', 'disabled'].includes(status);
}

function parseParentPlayerKey(value) {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split('::');
  if (parts.length !== 2) return null;
  const teamId = normalizeParentScopeId(parts[0]);
  const playerId = normalizeParentScopeId(parts[1]);
  if (!teamId || !playerId) return null;
  return { teamId, playerId };
}

function collectOwnerParentLinks(profile = {}) {
  const linksByKey = new Map();
  const hasCanonicalTeamIds = Object.prototype.hasOwnProperty.call(profile, 'parentTeamIds');
  const canonicalTeamIds = new Set(
    (hasCanonicalTeamIds && Array.isArray(profile.parentTeamIds) ? profile.parentTeamIds : [])
      .map(normalizeParentScopeId)
      .filter(Boolean)
  );
  const hasCanonicalPlayerKeys = Object.prototype.hasOwnProperty.call(profile, 'parentPlayerKeys');
  const canonicalPlayerLinks = (hasCanonicalPlayerKeys && Array.isArray(profile.parentPlayerKeys)
    ? profile.parentPlayerKeys
    : [])
    .map(parseParentPlayerKey)
    .filter(Boolean);
  const canonicalPlayerKeys = new Set(
    canonicalPlayerLinks.map((link) => `${link.teamId}::${link.playerId}`)
  );

  function addLink(raw = {}) {
    const teamId = normalizeParentScopeId(raw.teamId);
    const playerId = normalizeParentScopeId(raw.playerId || raw.childId);
    if (!teamId || !playerId) return;
    const key = `${teamId}::${playerId}`;
    // Canonical revocable fields are authoritative whenever present. A
    // malformed/null value therefore means no access, and stale parentOf rows
    // cannot restore either a removed team or a removed sibling player.
    if (hasCanonicalTeamIds && !canonicalTeamIds.has(teamId)) return;
    if (hasCanonicalPlayerKeys && !canonicalPlayerKeys.has(key)) return;
    if (hasCanonicalTeamIds && !hasCanonicalPlayerKeys) return;
    if (!linksByKey.has(key)) {
      linksByKey.set(key, {
        teamId,
        teamName: compactString(raw.teamName || raw.team),
        playerId,
        playerName: compactString(raw.playerName || raw.childName || raw.name),
        playerNumber: compactString(raw.playerNumber ?? raw.number),
        playerPhotoUrl: compactString(raw.playerPhotoUrl || raw.photoUrl) || null
      });
    }
  }

  (Array.isArray(profile.parentOf) ? profile.parentOf : []).forEach(addLink);
  canonicalPlayerLinks.forEach(addLink);

  return [...linksByKey.values()];
}

async function resolveFamilyShareChildrenFromOwnerProfile(profile = {}, loaders = {}) {
  const loadTeam = loaders.loadTeam;
  const loadPlayer = loaders.loadPlayer;
  if (typeof loadTeam !== 'function' || typeof loadPlayer !== 'function') {
    throw new TypeError('Family share child resolution requires team and player loaders.');
  }

  const children = [];
  const allowedKeys = loaders.allowedKeys instanceof Set
    ? loaders.allowedKeys
    : Array.isArray(loaders.allowedKeys)
      ? new Set(loaders.allowedKeys.map(compactString).filter(Boolean))
      : null;
  const maxChildren = Number.isFinite(loaders.maxChildren) && loaders.maxChildren >= 0
    ? Math.floor(loaders.maxChildren)
    : Number.POSITIVE_INFINITY;
  const links = collectOwnerParentLinks(profile).filter((link) => (
    !allowedKeys || allowedKeys.has(`${link.teamId}::${link.playerId}`)
  ));
  const teamCache = new Map();

  for (const link of links) {
    if (children.length >= maxChildren) break;
    if (!teamCache.has(link.teamId)) {
      teamCache.set(link.teamId, await loadTeam(link.teamId));
    }
    const team = teamCache.get(link.teamId);
    if (!team || !isTeamActive(team)) continue;

    const player = await loadPlayer(link.teamId, link.playerId);
    if (!player || player.active === false) continue;

    children.push({
      teamId: link.teamId,
      teamName: compactString(team.name || link.teamName),
      playerId: link.playerId,
      playerName: compactString(player.name || link.playerName),
      playerNumber: compactString(player.number ?? link.playerNumber),
      playerPhotoUrl: compactString(player.photoUrl || link.playerPhotoUrl) || null
    });
  }

  return children;
}

module.exports = {
  collectOwnerParentLinks,
  isFamilyShareTokenReadable,
  resolveFamilyShareChildrenFromOwnerProfile
};
