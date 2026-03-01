export function buildCoachOverrideRsvpDocId(userId, playerId) {
  const uid = String(userId || '').trim();
  const pid = String(playerId || '').trim();
  if (!uid || !pid) return '';
  return `${uid}__${pid}`;
}
