export function buildCoachOverrideRsvpDocId(userId, playerId) {
  const uid = String(userId || '').trim();
  const pid = String(playerId || '').trim();
  if (!uid || !pid) return '';
  return `${uid}__${pid}`;
}

function extractLegacyPlayerIds(rsvp) {
  const ids = [];
  if (Array.isArray(rsvp?.playerIds)) {
    rsvp.playerIds.forEach((id) => {
      const normalized = String(id || '').trim();
      if (normalized) ids.push(normalized);
    });
  }

  const legacyPlayerId = String(rsvp?.playerId || '').trim();
  if (legacyPlayerId) ids.push(legacyPlayerId);

  const legacyChildId = String(rsvp?.childId || '').trim();
  if (legacyChildId) ids.push(legacyChildId);

  return Array.from(new Set(ids));
}

export function shouldDeleteLegacyRsvpForOverride(legacyRsvp, overridePlayerId) {
  const normalizedOverridePlayerId = String(overridePlayerId || '').trim();
  if (!normalizedOverridePlayerId || !legacyRsvp) return false;

  const legacyPlayerIds = extractLegacyPlayerIds(legacyRsvp);
  if (legacyPlayerIds.length !== 1) return false;
  return legacyPlayerIds[0] === normalizedOverridePlayerId;
}
