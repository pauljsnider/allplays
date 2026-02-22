/**
 * Shared practice + parent workflow helpers used by parent dashboard views.
 */

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

export function hasRecordedAttendance(attendance) {
  if (!attendance || !Array.isArray(attendance.players) || attendance.players.length === 0) {
    return false;
  }

  if (attendance.editedAt) return true;

  const checkedInCount = attendance.checkedInCount ?? attendance.players.length;
  if (checkedInCount !== attendance.players.length) return true;

  return attendance.players.some(player =>
    (player.status && player.status !== 'present') ||
    (typeof player.note === 'string' && player.note.trim())
  );
}

export function hasHomePacket(session) {
  const blocks = session?.homePacketContent?.blocks;
  return !!(session?.homePacketGenerated && Array.isArray(blocks) && blocks.length > 0);
}

export function getHomePacketBlocks(homePacket) {
  return Array.isArray(homePacket?.blocks) ? homePacket.blocks : [];
}

export function getHomePacketMinutes(homePacket) {
  const totalMinutes = Number.parseInt(homePacket?.totalMinutes, 10);
  if (Number.isFinite(totalMinutes) && totalMinutes > 0) return totalMinutes;

  return getHomePacketBlocks(homePacket).reduce((sum, block) => sum + (Number.parseInt(block?.duration, 10) || 0), 0);
}

export function getAttendanceBreakdown(attendance) {
  if (!hasRecordedAttendance(attendance)) {
    return { recorded: false, rosterSize: 0, presentLikeCount: 0, lateCount: 0, absentCount: 0 };
  }

  const players = Array.isArray(attendance.players) ? attendance.players : [];
  const presentLikeCount = players.filter(player => player.status === 'present' || player.status === 'late').length;
  const lateCount = players.filter(player => player.status === 'late').length;
  const absentCount = players.filter(player => player.status === 'absent').length;

  return { recorded: true, rosterSize: players.length, presentLikeCount, lateCount, absentCount };
}

export function getCompletedChildIds(completions) {
  return new Set(
    (completions || [])
      .filter(completion => completion?.status === 'completed' && completion.childId)
      .map(completion => completion.childId)
  );
}

export function countCompletedChildren(children, completions) {
  const completedChildIds = getCompletedChildIds(completions);
  return (children || []).filter(child => completedChildIds.has(child?.id)).length;
}

function toDate(value) {
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date?.getTime?.()) ? null : date;
}

export function filterPracticePacketRows(rows, options = {}) {
  const filter = options.filter === 'past' ? 'past' : 'recent_upcoming';
  const selectedPlayerId = options.selectedPlayerId || '';
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const recentCutoff = new Date(now.getTime() - TWO_WEEKS_MS);

  const normalized = (rows || [])
    .filter(row => !selectedPlayerId || (row?.childIds || []).includes(selectedPlayerId))
    .map(row => ({ row, date: toDate(row?.date) }))
    .filter(item => !!item.date);

  const filtered = filter === 'past'
    ? normalized.filter(item => item.date < recentCutoff)
    : normalized.filter(item => item.date >= recentCutoff);

  filtered.sort((a, b) => filter === 'past' ? b.date - a.date : a.date - b.date);
  return filtered.map(item => item.row);
}
