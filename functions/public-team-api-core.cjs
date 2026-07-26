const PUBLIC_TEAM_API_VERSION = 1;
const PUBLIC_TEAM_API_MAX_GAMES = 500;
const PUBLIC_TEAM_API_DEFAULT_GAMES = 100;
const PUBLIC_TEAM_API_MAX_RANGE_DAYS = 3660;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

function compactText(value, maxLength = 256) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 256) {
  return compactText(value, maxLength) || null;
}

function publicHttpUrl(value) {
  const text = compactText(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value?.toMillis === 'function') return new Date(value.toMillis());
  if (value instanceof Date) return new Date(value.getTime());
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeTeamId(value) {
  const teamId = compactText(value, 128);
  return /^[A-Za-z0-9_-]{1,128}$/.test(teamId) ? teamId : '';
}

function isStrictPublicTeam(team = {}) {
  const status = compactText(team?.status, 32).toLowerCase();
  return team?.isPublic === true &&
    team?.active !== false &&
    team?.archived !== true &&
    !['archived', 'inactive', 'disabled'].includes(status);
}

function isActivePublicPlayer(player = {}) {
  const status = compactText(player?.status, 32).toLowerCase();
  return player?.active !== false &&
    player?.archived !== true &&
    player?.deleted !== true &&
    !['archived', 'deleted', 'inactive', 'removed'].includes(status);
}

function isPublicGame(game = {}) {
  const type = compactText(game?.type || 'game', 32).toLowerCase();
  const visibility = compactText(game?.visibility, 32).toLowerCase();
  const status = compactText(game?.status, 32).toLowerCase();
  const liveStatus = compactText(game?.liveStatus, 32).toLowerCase();
  return type === 'game' &&
    visibility !== 'private' &&
    game?.isPrivate !== true &&
    game?.private !== true &&
    game?.deleted !== true &&
    status !== 'deleted' &&
    liveStatus !== 'deleted';
}

function serializePublicTeam(teamId, team = {}) {
  return {
    id: teamId,
    name: compactText(team?.name || team?.teamName, 160) || 'Team',
    sport: nullableText(team?.sport, 80),
    photoUrl: publicHttpUrl(team?.photoUrl || team?.logoUrl || team?.imageUrl)
  };
}

function serializePublicPlayer(player = {}) {
  if (!isActivePublicPlayer(player)) return null;
  const name = compactText(player?.name || player?.displayName, 160);
  if (!name) return null;
  return {
    id: compactText(player?.id, 128),
    name,
    number: compactText(player?.number ?? player?.jerseyNumber ?? player?.jersey, 32),
    photoUrl: publicHttpUrl(player?.photoUrl || player?.imageUrl),
    position: nullableText(player?.position, 80)
  };
}

function compareRosterPlayers(left, right) {
  const leftNumber = Number.parseInt(left.number, 10);
  const rightNumber = Number.parseInt(right.number, 10);
  const leftNumeric = Number.isFinite(leftNumber);
  const rightNumeric = Number.isFinite(rightNumber);
  if (leftNumeric && rightNumeric && leftNumber !== rightNumber) return leftNumber - rightNumber;
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  if (left.number !== right.number) return left.number.localeCompare(right.number, undefined, { numeric: true });
  return left.name.localeCompare(right.name);
}

function normalizeGameStatus(game = {}) {
  const statuses = [game?.status, game?.liveStatus]
    .map((value) => compactText(value, 32).toLowerCase())
    .filter(Boolean);
  if (statuses.some((value) => ['cancelled', 'canceled'].includes(value))) return 'cancelled';
  if (statuses.some((value) => ['postponed', 'delayed'].includes(value))) return 'postponed';
  if (statuses.some((value) => ['completed', 'complete', 'final', 'finished'].includes(value))) return 'completed';
  if (statuses.some((value) => ['live', 'in_progress', 'in-progress'].includes(value))) return 'live';
  return 'scheduled';
}

function finiteScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 ? score : null;
}

function sanitizePublicLocation(value) {
  const raw = typeof value === 'string' ? value.replace(/\r/g, '') : '';
  if (!raw.trim()) return '';
  const sensitiveBoundaries = [
    raw.search(/(?:^|\n)\s*\(?\s*(?:arrival\s+time\b|assignments?\s*:)/i),
    raw.search(/\s+\(\s*(?:arrival\s+time\b|assignments?\s*:)/i),
    raw.search(/\s+assignments?\s*:/i)
  ].filter((index) => index >= 0);
  const sensitiveBoundary = sensitiveBoundaries.length ? Math.min(...sensitiveBoundaries) : -1;
  const publicPart = sensitiveBoundary >= 0 ? raw.slice(0, sensitiveBoundary) : raw;
  return publicPart
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(', ')
    .slice(0, 500);
}

function serializePublicGame(game = {}) {
  if (!isPublicGame(game)) return null;
  const startsAt = toDate(game?.date || game?.startsAt || game?.startDate || game?.start);
  if (!startsAt) return null;

  const isHome = game?.isHome !== false;
  const homeScore = finiteScore(game?.homeScore);
  const awayScore = finiteScore(game?.awayScore);
  const teamScore = isHome ? homeScore : awayScore;
  const opponentScore = isHome ? awayScore : homeScore;
  const status = normalizeGameStatus(game);
  let result = null;
  if (status === 'completed' && teamScore !== null && opponentScore !== null) {
    result = teamScore > opponentScore ? 'win' : teamScore < opponentScore ? 'loss' : 'tie';
  }

  const endsAt = toDate(game?.endDate || game?.endsAt || game?.end || game?.dtend);
  return {
    id: compactText(game?.id || game?.gameId, 128),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt ? endsAt.toISOString() : null,
    opponent: compactText(game?.opponent || game?.opponentTeamName, 160) || 'TBD',
    location: sanitizePublicLocation(game?.location),
    isHome,
    status,
    teamScore,
    opponentScore,
    result,
    seasonLabel: nullableText(game?.seasonLabel, 100),
    competitionType: nullableText(game?.competitionType, 80),
    countsTowardSeasonRecord: game?.countsTowardSeasonRecord !== false,
    summary: nullableText(game?.summary || game?.publicSummary, 2000),
    videoUrl: publicHttpUrl(game?.videoUrl)
  };
}

function parseDateOnly(value, endOfDay = false) {
  const text = compactText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
  const parsed = new Date(`${text}${suffix}`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text ? null : parsed;
}

function parsePublicGamesQuery(query = {}, now = new Date()) {
  const anchor = toDate(now);
  if (!anchor) throw new TypeError('A valid current date is required.');

  const hasFrom = query.from !== undefined && String(query.from).trim() !== '';
  const hasTo = query.to !== undefined && String(query.to).trim() !== '';
  const defaultDate = (yearOffset, endOfDay) => {
    const year = anchor.getUTCFullYear() + yearOffset;
    const month = anchor.getUTCMonth();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(anchor.getUTCDate(), lastDay);
    return new Date(Date.UTC(
      year,
      month,
      day,
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0
    ));
  };
  const fromDate = hasFrom
    ? parseDateOnly(query.from, false)
    : defaultDate(-1, false);
  const toDateValue = hasTo
    ? parseDateOnly(query.to, true)
    : defaultDate(2, true);
  if (!fromDate || !toDateValue) {
    return { error: 'from and to must use YYYY-MM-DD format.' };
  }
  if (toDateValue < fromDate) {
    return { error: 'to must be on or after from.' };
  }
  if (toDateValue.getTime() - fromDate.getTime() > PUBLIC_TEAM_API_MAX_RANGE_DAYS * MILLIS_PER_DAY) {
    return { error: `Date range cannot exceed ${PUBLIC_TEAM_API_MAX_RANGE_DAYS} days.` };
  }

  const requestedLimit = query.limit === undefined || String(query.limit).trim() === ''
    ? PUBLIC_TEAM_API_DEFAULT_GAMES
    : Number(query.limit);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > PUBLIC_TEAM_API_MAX_GAMES) {
    return { error: `limit must be an integer from 1 to ${PUBLIC_TEAM_API_MAX_GAMES}.` };
  }

  return {
    fromDate,
    toDate: toDateValue,
    from: fromDate.toISOString().slice(0, 10),
    to: toDateValue.toISOString().slice(0, 10),
    limit: requestedLimit
  };
}

function buildPublicRosterResponse({ teamId, team = {}, players = [], now = new Date() }) {
  return {
    version: PUBLIC_TEAM_API_VERSION,
    generatedAt: toDate(now).toISOString(),
    team: serializePublicTeam(teamId, team),
    players: players
      .map(serializePublicPlayer)
      .filter(Boolean)
      .sort(compareRosterPlayers)
  };
}

function buildPublicGamesResponse({
  teamId,
  team = {},
  games = [],
  from,
  to,
  limit = PUBLIC_TEAM_API_DEFAULT_GAMES,
  now = new Date()
}) {
  const publicGames = games
    .map(serializePublicGame)
    .filter(Boolean)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  return {
    version: PUBLIC_TEAM_API_VERSION,
    generatedAt: toDate(now).toISOString(),
    team: serializePublicTeam(teamId, team),
    range: {
      from,
      to,
      truncated: publicGames.length > limit
    },
    games: publicGames.slice(0, limit)
  };
}

module.exports = {
  PUBLIC_TEAM_API_DEFAULT_GAMES,
  PUBLIC_TEAM_API_MAX_GAMES,
  PUBLIC_TEAM_API_MAX_RANGE_DAYS,
  PUBLIC_TEAM_API_VERSION,
  buildPublicGamesResponse,
  buildPublicRosterResponse,
  compareRosterPlayers,
  isActivePublicPlayer,
  isPublicGame,
  isStrictPublicTeam,
  normalizeGameStatus,
  normalizeTeamId,
  parsePublicGamesQuery,
  publicHttpUrl,
  sanitizePublicLocation,
  serializePublicGame,
  serializePublicPlayer,
  serializePublicTeam,
  toDate
};
