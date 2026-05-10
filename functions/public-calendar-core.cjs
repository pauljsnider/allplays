const PRODID = '-//ALL PLAYS//Public Games//EN';

function toBooleanTrue(value) {
  return value === true || String(value || '').toLowerCase() === 'true';
}

function isPublicTeam(team = {}) {
  return team?.isPublic !== false && team?.active !== false;
}

function canExposeEmptyPublicFeed(team = {}) {
  return isPublicTeam(team);
}

function isShareableGame(game = {}) {
  const visibility = String(game?.visibility || '').toLowerCase();
  if (visibility === 'private' || game?.isPrivate === true || game?.private === true) return false;
  return visibility === 'public' ||
    toBooleanTrue(game?.isPublic) ||
    toBooleanTrue(game?.public) ||
    toBooleanTrue(game?.shareable) ||
    toBooleanTrue(game?.isShareable) ||
    toBooleanTrue(game?.publicCalendar);
}

function isPublicFanGame(team = {}, game = {}) {
  const type = String(game?.type || 'game').toLowerCase();
  if (type !== 'game') return false;
  if (String(game?.visibility || '').toLowerCase() === 'private') return false;
  if (game?.isPrivate === true || game?.private === true) return false;
  if (String(game?.status || '').toLowerCase() === 'deleted') return false;
  if (String(game?.liveStatus || '').toLowerCase() === 'deleted') return false;
  return isPublicTeam(team) || isShareableGame(game);
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value?.toMillis === 'function') return new Date(value.toMillis());
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatIcsDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function stablePublicGameUid(teamId, game = {}) {
  const gameId = String(game?.id || game?.gameId || game?.sharedGameId || '').trim();
  const fallback = `${toDate(game?.date)?.toISOString() || 'unknown'}-${game?.opponent || 'tbd'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  return `${gameId || fallback}-${teamId}@allplays-public-games`;
}

function buildPublicGamesIcs({ teamId, team = {}, games = [], now = new Date() }) {
  const teamName = String(team?.name || 'Team').trim() || 'Team';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(`${teamName} games`)}`
  ];

  games
    .filter((game) => isPublicFanGame(team, game))
    .map((game) => ({ game, date: toDate(game?.date) }))
    .filter(({ date }) => date)
    .sort((a, b) => a.date - b.date)
    .forEach(({ game, date }) => {
      const endDate = toDate(game.endDate || game.end || game.dtend) || new Date(date.getTime() + 60 * 60 * 1000);
      const opponent = String(game?.opponent || game?.opponentTeamName || 'TBD').trim() || 'TBD';
      const summary = `${teamName} vs ${opponent}`;
      const status = String(game?.status || '').toLowerCase() === 'cancelled' ? 'CANCELLED' : 'CONFIRMED';
      lines.push(
        'BEGIN:VEVENT',
        `UID:${escapeIcsText(stablePublicGameUid(teamId, game))}`,
        `DTSTAMP:${formatIcsDate(now)}`,
        `DTSTART:${formatIcsDate(date)}`,
        `DTEND:${formatIcsDate(endDate)}`,
        `SUMMARY:${escapeIcsText(summary)}`,
        `LOCATION:${escapeIcsText(game?.location || 'TBD')}`,
        `STATUS:${status}`,
        'END:VEVENT'
      );
    });

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

module.exports = {
  buildPublicGamesIcs,
  canExposeEmptyPublicFeed,
  escapeIcsText,
  formatIcsDate,
  isPublicFanGame,
  isPublicTeam,
  isShareableGame,
  stablePublicGameUid
};
