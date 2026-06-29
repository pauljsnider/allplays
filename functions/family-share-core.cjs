function compactString(value) {
  return value == null ? '' : String(value).trim();
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
  const [teamId, playerId] = compactString(value).split('::').map(compactString);
  if (!teamId || !playerId) return null;
  return { teamId, playerId };
}

function collectOwnerParentLinks(profile = {}) {
  const linksByKey = new Map();

  function addLink(raw = {}) {
    const teamId = compactString(raw.teamId);
    const playerId = compactString(raw.playerId || raw.childId);
    if (!teamId || !playerId) return;
    const key = `${teamId}::${playerId}`;
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
  (Array.isArray(profile.parentPlayerKeys) ? profile.parentPlayerKeys : [])
    .map(parseParentPlayerKey)
    .filter(Boolean)
    .forEach(addLink);

  return [...linksByKey.values()];
}

async function resolveFamilyShareChildrenFromOwnerProfile(profile = {}, loaders = {}) {
  const loadTeam = loaders.loadTeam;
  const loadPlayer = loaders.loadPlayer;
  if (typeof loadTeam !== 'function' || typeof loadPlayer !== 'function') {
    throw new TypeError('Family share child resolution requires team and player loaders.');
  }

  const children = [];
  const links = collectOwnerParentLinks(profile);
  const teamCache = new Map();

  for (const link of links) {
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
