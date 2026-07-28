const {
  isStrictPublicTeam,
  normalizeTeamId,
  serializePublicGame,
  serializePublicTeam
} = require('./public-team-api-core.cjs');

const PUBLIC_HOMEPAGE_API_VERSION = 1;
const PUBLIC_HOMEPAGE_RESULT_LIMIT = 6;
const PUBLIC_HOMEPAGE_MAX_CANDIDATES_PER_QUERY = 120;
const PUBLIC_HOMEPAGE_MAX_TEAM_IDS_PER_CANDIDATE = 2;
const PUBLIC_HOMEPAGE_MAX_UNIQUE_TEAM_LOOKUPS = 240;

function compactText(value, maxLength = 128) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function limitPublicHomepageCandidates(candidates = []) {
  if (!Array.isArray(candidates)) return [];
  return candidates.slice(0, PUBLIC_HOMEPAGE_MAX_CANDIDATES_PER_QUERY);
}

function buildPublicHomepageCandidateBatch(candidates = []) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];
  return {
    candidates: limitPublicHomepageCandidates(safeCandidates),
    truncated: safeCandidates.length > PUBLIC_HOMEPAGE_MAX_CANDIDATES_PER_QUERY
  };
}

function buildPublicHomepageTeamIdBatch(values = []) {
  const validatedTeamIds = [...new Set(
    (Array.isArray(values) ? values : []).map(normalizeTeamId).filter(Boolean)
  )];
  return {
    teamIds: validatedTeamIds.slice(0, PUBLIC_HOMEPAGE_MAX_TEAM_IDS_PER_CANDIDATE),
    truncated: validatedTeamIds.length > PUBLIC_HOMEPAGE_MAX_TEAM_IDS_PER_CANDIDATE
  };
}

function buildSharedGameSyntheticId(sharedGamePath) {
  if (typeof sharedGamePath !== 'string' || !sharedGamePath) {
    throw new Error('sharedGamePath is required');
  }
  return `shared_${encodeURIComponent(sharedGamePath)}`;
}

function sharedGameSyntheticId(game = {}) {
  const path = typeof game._sharedGamePath === 'string' && game._sharedGamePath
    ? game._sharedGamePath
    : game.id ? `sharedGames/${game.id}` : '';
  return buildSharedGameSyntheticId(path);
}

function projectSharedGameForPublicTeam(game = {}, teamId) {
  const isHome = compactText(game.homeTeamId) === teamId;
  const isAway = compactText(game.awayTeamId) === teamId;
  if (!isHome && !isAway) return null;
  return {
    ...game,
    id: sharedGameSyntheticId(game),
    teamId,
    isHome,
    isSharedGame: true,
    opponent: isHome
      ? compactText(game.awayTeamName || game.awayPlaceholderName, 160) || 'TBD'
      : compactText(game.homeTeamName || game.homePlaceholderName, 160) || 'TBD'
  };
}

function serializeHomepageGame(game = {}, teamId, team = {}) {
  if (!isStrictPublicTeam(team)) return null;
  const projected = game.isSharedGame
    ? projectSharedGameForPublicTeam(game, teamId)
    : { ...game, teamId };
  if (!projected) return null;
  const serialized = serializePublicGame(projected);
  if (!serialized) return null;

  const homeScore = serialized.isHome ? serialized.teamScore : serialized.opponentScore;
  const awayScore = serialized.isHome ? serialized.opponentScore : serialized.teamScore;
  return {
    id: serialized.id,
    teamId,
    opponent: serialized.opponent,
    date: serialized.startsAt,
    endsAt: serialized.endsAt,
    location: serialized.location,
    isHome: serialized.isHome,
    status: serialized.status,
    liveStatus: serialized.status,
    homeScore,
    awayScore,
    liveViewerCount: finiteNonNegative(game.liveViewerCount),
    videoUrl: serialized.videoUrl,
    isSharedGame: projected.isSharedGame === true,
    team: serializePublicTeam(teamId, team)
  };
}

async function serializePublicHomepageCandidates({
  candidates = [],
  category,
  getTeamIds,
  getTeam,
  teamLookupBudget = {
    seenTeamIds: new Set(),
    maxUniqueTeamLookups: PUBLIC_HOMEPAGE_MAX_UNIQUE_TEAM_LOOKUPS
  },
  onTeamError = () => undefined
} = {}) {
  const serialized = [];
  let partial = false;
  for (const candidate of candidates) {
    const teamIdResult = getTeamIds(candidate);
    const teamIds = Array.isArray(teamIdResult)
      ? teamIdResult
      : Array.isArray(teamIdResult?.teamIds) ? teamIdResult.teamIds : [];
    if (!Array.isArray(teamIdResult) && teamIdResult?.truncated === true) {
      partial = true;
    }
    for (const teamId of teamIds) {
      if (!teamLookupBudget.seenTeamIds.has(teamId)) {
        if (teamLookupBudget.seenTeamIds.size >= teamLookupBudget.maxUniqueTeamLookups) {
          partial = true;
          continue;
        }
        teamLookupBudget.seenTeamIds.add(teamId);
      }
      let team;
      try {
        team = await getTeam(teamId);
      } catch (error) {
        partial = true;
        onTeamError({ teamId, error });
        continue;
      }
      const game = team ? serializeHomepageGame(candidate, teamId, team) : null;
      const categoryMatches = game && (
        category === 'live'
          ? game.status === 'live'
          : category === 'replays'
            ? game.status === 'completed'
            : !['live', 'completed', 'cancelled'].includes(game.status)
      );
      if (categoryMatches) {
        serialized.push(game);
        break;
      }
    }
  }
  return { games: serialized, partial };
}

function dedupeAndLimit(games, limit, direction = 'asc') {
  const byKey = new Map();
  games.filter(Boolean).forEach((game) => {
    const key = `${game.teamId}:${game.id}`;
    if (!byKey.has(key)) byKey.set(key, game);
  });
  return [...byKey.values()]
    .sort((left, right) => direction === 'desc'
      ? right.date.localeCompare(left.date)
      : left.date.localeCompare(right.date))
    .slice(0, limit);
}

function buildPublicHomepageGamesResponse({
  live = [],
  upcoming = [],
  replays = [],
  partialCategories = [],
  limit = PUBLIC_HOMEPAGE_RESULT_LIMIT,
  now = new Date()
} = {}) {
  const safeLimit = Number.isSafeInteger(limit) && limit > 0
    ? Math.min(limit, PUBLIC_HOMEPAGE_RESULT_LIMIT)
    : PUBLIC_HOMEPAGE_RESULT_LIMIT;
  const safePartialCategories = [...new Set(
    (Array.isArray(partialCategories) ? partialCategories : [])
      .filter((category) => ['live', 'upcoming', 'replays'].includes(category))
  )];
  return {
    version: PUBLIC_HOMEPAGE_API_VERSION,
    generatedAt: new Date(now).toISOString(),
    partial: safePartialCategories.length > 0,
    partialCategories: safePartialCategories,
    live: dedupeAndLimit(live, safeLimit),
    upcoming: dedupeAndLimit(upcoming, safeLimit),
    replays: dedupeAndLimit(replays, safeLimit, 'desc')
  };
}

module.exports = {
  PUBLIC_HOMEPAGE_API_VERSION,
  PUBLIC_HOMEPAGE_MAX_CANDIDATES_PER_QUERY,
  PUBLIC_HOMEPAGE_MAX_TEAM_IDS_PER_CANDIDATE,
  PUBLIC_HOMEPAGE_MAX_UNIQUE_TEAM_LOOKUPS,
  PUBLIC_HOMEPAGE_RESULT_LIMIT,
  buildSharedGameSyntheticId,
  buildPublicHomepageCandidateBatch,
  buildPublicHomepageGamesResponse,
  buildPublicHomepageTeamIdBatch,
  limitPublicHomepageCandidates,
  projectSharedGameForPublicTeam,
  serializeHomepageGame,
  serializePublicHomepageCandidates
};
