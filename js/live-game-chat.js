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
  const lifecycle = getGameReplayLifecycle(game);
  if (lifecycle.isActiveLive) return true;
  if (lifecycle.type !== undefined && lifecycle.type !== 'game') return false;
  const statuses = [lifecycle.status, lifecycle.liveStatus].filter(Boolean);
  const hasNonScheduledStatus = statuses.some((status) => status !== 'scheduled');
  if (hasNonScheduledStatus
    || game?.isCancelled === true || game?.deleted === true || game?.isDeleted === true) return false;
  const gameDate = toDate(game?.date);
  return isSameDay(gameDate, now);
}
import { getGameReplayLifecycle } from './game-replay-video.js?v=3';
