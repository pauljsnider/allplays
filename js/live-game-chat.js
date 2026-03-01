function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSameDay(left, right) {
  if (!left || !right) return false;
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

export function isViewerChatEnabled(game, { isReplay = false, now = new Date() } = {}) {
  if (isReplay) return false;
  if (game?.liveStatus === 'live') return true;
  const gameDate = toDate(game?.date);
  return isSameDay(gameDate, now);
}
