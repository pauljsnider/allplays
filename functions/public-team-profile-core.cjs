const PUBLIC_TEAM_PROFILE_FIELDS = Object.freeze([
  'publicSchemaVersion',
  'name',
  'sport',
  'description',
  'photoUrl',
  'city',
  'state',
  'zip',
  'leagueUrl',
  'websiteUrl',
  'socialLinks',
  'twitchChannel',
  'streamUrl',
  'livestreamUrl',
  'streamEmbedUrl',
  'youtubeEmbedUrl',
  'standingsConfig',
  'tournament',
  'tournamentDivisions',
  'tournamentPools',
  'tournamentPoolOverrides',
  'appAccess',
  'webAccess',
  'active',
  'archived',
  'status',
  'isPublic',
  'publicSearchName',
  'publicSearchCity',
  'publicSearchState',
  'publicSearchZip',
  'publicSearchCityState',
  'sourceUpdatedAt'
]);

const PUBLIC_TEAM_PROFILE_FIELD_SET = new Set(PUBLIC_TEAM_PROFILE_FIELDS);
const PUBLIC_SCHEMA_VERSION = 1;
const MAX_ARRAY_ITEMS = 200;
const NESTED_PRESENTATION_FIELDS = new Set([
  'standingsConfig', 'tournament', 'tournamentDivisions',
  'tournamentPools', 'tournamentPoolOverrides'
]);
const STANDINGS_TIEBREAKER_VALUES = new Set([
  'head_to_head', 'group_head_to_head',
  'goal_diff', 'point_diff',
  'goals_for', 'points_for',
  'fewest_goals_allowed', 'fewest_points_against',
  'most_games_won', 'wins', 'name'
]);
const TEXT_LIMITS = Object.freeze({
  name: 100,
  sport: 60,
  description: 1000,
  photoUrl: 1000,
  city: 80,
  state: 40,
  zip: 16,
  leagueUrl: 1000,
  websiteUrl: 1000,
  twitchChannel: 200,
  streamUrl: 1000,
  livestreamUrl: 1000,
  streamEmbedUrl: 1000,
  youtubeEmbedUrl: 1000,
  status: 40
});
const PUBLIC_TEAM_PROFILE_STRING_FIELDS = Object.freeze([
  ...Object.keys(TEXT_LIMITS),
  'publicSearchName',
  'publicSearchCity',
  'publicSearchState',
  'publicSearchZip',
  'publicSearchCityState'
]);
const PUBLIC_TEAM_PROFILE_BOOLEAN_FIELDS = Object.freeze([
  'appAccess', 'webAccess', 'active', 'archived', 'isPublic'
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function sanitizeText(value, limit) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim();
  return text ? text.slice(0, limit) : undefined;
}

function sanitizeUrl(value) {
  const text = sanitizeText(value, 1000);
  if (!text) return undefined;
  try {
    const parsed = new URL(text);
    return ['https:', 'http:'].includes(parsed.protocol) ? text : undefined;
  } catch (_error) {
    return undefined;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isTimestampLike(value) {
  return value === null ||
    value instanceof Date ||
    Boolean(value && typeof value === 'object' && typeof value.toMillis === 'function');
}

function sanitizeFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function sanitizeStandingsTiebreakers(value) {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 20)
    .map((item) => normalizeText(item).toLowerCase())
    .filter((item) => STANDINGS_TIEBREAKER_VALUES.has(item));
}

function sanitizeStandingsConfig(value) {
  if (!isPlainObject(value)) return undefined;
  const result = {};
  if (typeof value.enabled === 'boolean') result.enabled = value.enabled;
  if (['points', 'win_pct'].includes(value.rankingMode)) result.rankingMode = value.rankingMode;
  if (isPlainObject(value.points)) {
    const points = {};
    ['win', 'tie', 'loss'].forEach((key) => {
      const number = sanitizeFiniteNumber(value.points[key]);
      if (number !== undefined) points[key] = number;
    });
    if (Object.keys(points).length) result.points = points;
  }
  const maxGoalDiff = sanitizeFiniteNumber(value.maxGoalDiff);
  if (maxGoalDiff !== undefined && maxGoalDiff > 0) result.maxGoalDiff = maxGoalDiff;
  if (value.maxGoalDiff === null) result.maxGoalDiff = null;
  ['tiebreakers', 'twoTeamTiebreakers', 'multiTeamTiebreakers'].forEach((key) => {
    const tiebreakers = sanitizeStandingsTiebreakers(value[key]);
    if (tiebreakers !== undefined) result[key] = tiebreakers;
  });
  return result;
}

function sanitizeTournamentGroup(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    return sanitizeText(value, 200);
  }
  if (!isPlainObject(value)) return undefined;
  const result = {};
  ['name', 'label', 'divisionName', 'division', 'poolName'].forEach((key) => {
    const text = sanitizeText(value[key], 200);
    if (text !== undefined) result[key] = text;
  });
  return Object.keys(result).length ? result : undefined;
}

function sanitizeTournamentGroups(value) {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, MAX_ARRAY_ITEMS)
    .map(sanitizeTournamentGroup)
    .filter((item) => item !== undefined);
}

function sanitizeTournament(value) {
  if (!isPlainObject(value)) return undefined;
  const result = {};
  ['name', 'label'].forEach((key) => {
    const text = sanitizeText(value[key], 200);
    if (text !== undefined) result[key] = text;
  });
  ['divisions', 'pools'].forEach((key) => {
    const groups = sanitizeTournamentGroups(value[key]);
    if (groups !== undefined) result[key] = groups;
  });
  return result;
}

function sanitizeTournamentPoolOverrides(value) {
  if (!isPlainObject(value)) return undefined;
  const result = {};
  Object.entries(value).slice(0, MAX_ARRAY_ITEMS).forEach(([rawKey, rawOverride]) => {
    const key = sanitizeText(rawKey, 300);
    if (!key || !isPlainObject(rawOverride)) return;
    const override = {};
    ['poolName', 'groupKey'].forEach((field) => {
      const text = sanitizeText(rawOverride[field], 300);
      if (text !== undefined) override[field] = text;
    });
    if (Array.isArray(rawOverride.teamOrder)) {
      override.teamOrder = rawOverride.teamOrder.slice(0, MAX_ARRAY_ITEMS)
        .map((teamName) => sanitizeText(teamName, 200))
        .filter(Boolean);
    }
    if (Object.keys(override).length) result[key] = override;
  });
  return result;
}

function sanitizeNestedPresentationField(field, value) {
  if (field === 'standingsConfig') return sanitizeStandingsConfig(value);
  if (field === 'tournament') return sanitizeTournament(value);
  if (field === 'tournamentDivisions' || field === 'tournamentPools') return sanitizeTournamentGroups(value);
  if (field === 'tournamentPoolOverrides') return sanitizeTournamentPoolOverrides(value);
  return undefined;
}

function sanitizeSocialLinks(value) {
  if (!isPlainObject(value)) return undefined;
  const allowed = new Set(['facebook', 'instagram', 'x', 'twitter', 'tiktok', 'youtube', 'linkedin', 'threads', 'bluesky']);
  const result = {};
  Object.entries(value).forEach(([key, url]) => {
    const normalizedKey = String(key || '').trim().toLowerCase();
    const sanitizedUrl = allowed.has(normalizedKey) ? sanitizeUrl(url) : undefined;
    if (sanitizedUrl) result[normalizedKey] = sanitizedUrl;
  });
  return result;
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isPublicTeamActive(team = {}) {
  const status = normalizeText(team.status).toLowerCase();
  return team.active !== false &&
    team.archived !== true &&
    !['archived', 'inactive', 'disabled'].includes(status);
}

function isPublicTeamDiscoverable(team = {}) {
  return team.isPublic === true && isPublicTeamActive(team);
}

function buildPublicTeamSearchFields(team = {}) {
  const city = normalizeText(team.city).toLowerCase();
  const state = normalizeText(team.state).toUpperCase();
  return {
    publicSearchName: normalizeText(team.name).toLowerCase(),
    publicSearchCity: city,
    publicSearchState: state,
    publicSearchZip: normalizeText(team.zip),
    publicSearchCityState: city && state ? `${city}, ${state.toLowerCase()}` : ''
  };
}

function buildPublicTeamProfile(team = {}, options = {}) {
  const active = isPublicTeamActive(team);
  const includeInactive = options?.includeInactive === true;
  if (team.isPublic !== true || (!includeInactive && !active)) return null;

  const profile = {};
  PUBLIC_TEAM_PROFILE_FIELDS.forEach((field) => {
    if (field === 'sourceUpdatedAt' || field === 'publicSchemaVersion') return;
    const value = team[field];
    if (TEXT_LIMITS[field]) {
      const sanitized = field.toLowerCase().includes('url') ? sanitizeUrl(value) : sanitizeText(value, TEXT_LIMITS[field]);
      if (sanitized !== undefined) profile[field] = sanitized;
      return;
    }
    if (field === 'socialLinks') {
      const sanitized = sanitizeSocialLinks(value);
      if (sanitized && Object.keys(sanitized).length) profile[field] = sanitized;
      return;
    }
    if (NESTED_PRESENTATION_FIELDS.has(field)) {
      const sanitized = sanitizeNestedPresentationField(field, value);
      if (sanitized !== undefined) profile[field] = sanitized;
      return;
    }
    if (['appAccess', 'webAccess'].includes(field) && typeof value === 'boolean') profile[field] = value;
  });

  return {
    ...profile,
    ...buildPublicTeamSearchFields(team),
    publicSchemaVersion: PUBLIC_SCHEMA_VERSION,
    isPublic: true,
    active,
    sourceUpdatedAt: team.updatedAt || null
  };
}

function matchesPublicTeamProfileSearch(profile = {}, searchText = '') {
  const search = normalizeText(searchText).toLowerCase();
  if (!search) return true;
  if (/^[a-z]{2}$/.test(search)) {
    return normalizeText(profile.state).toLowerCase() === search;
  }
  const fields = [
    profile.name,
    profile.sport,
    profile.city,
    profile.state,
    profile.zip,
    profile.publicSearchCityState
  ].map((value) => normalizeText(value).toLowerCase()).filter(Boolean);
  const combined = fields.join(' ');
  return search.split(/[\s,]+/).filter(Boolean).every((token) => combined.includes(token));
}

async function collectAllPublicTeamSourceDocuments(fetchPage, { pageSize = 500, maxDocuments } = {}) {
  if (typeof fetchPage !== 'function') throw new Error('A public team page loader is required.');
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 500, 1), 1000);
  const numericMaxDocuments = Number(maxDocuments);
  const normalizedMaxDocuments = Number.isFinite(numericMaxDocuments) && numericMaxDocuments > 0
    ? Math.floor(numericMaxDocuments)
    : Number.POSITIVE_INFINITY;
  const documents = [];
  let cursor = null;
  while (documents.length < normalizedMaxDocuments) {
    const requestedPageSize = Math.min(normalizedPageSize, normalizedMaxDocuments - documents.length);
    const page = await fetchPage({ cursor, pageSize: requestedPageSize });
    const pageDocuments = Array.isArray(page?.docs) ? page.docs : [];
    documents.push(...pageDocuments.slice(0, requestedPageSize));
    if (pageDocuments.length < requestedPageSize) break;
    cursor = pageDocuments.at(-1);
  }
  return documents;
}

function findUnexpectedPublicTeamProfileFields(profile = {}) {
  return Object.keys(profile).filter((field) => !PUBLIC_TEAM_PROFILE_FIELD_SET.has(field));
}

function isPublicTeamProfileSchemaValid(profile = {}) {
  return profile &&
    typeof profile === 'object' &&
    !Array.isArray(profile) &&
    profile.isPublic === true &&
    profile.active === true &&
    profile.publicSchemaVersion === PUBLIC_SCHEMA_VERSION &&
    normalizeText(profile.name).length > 0 &&
    findUnexpectedPublicTeamProfileFields(profile).length === 0 &&
    PUBLIC_TEAM_PROFILE_STRING_FIELDS.every((field) => (
      !Object.prototype.hasOwnProperty.call(profile, field) || typeof profile[field] === 'string'
    )) &&
    PUBLIC_TEAM_PROFILE_BOOLEAN_FIELDS.every((field) => (
      !Object.prototype.hasOwnProperty.call(profile, field) || typeof profile[field] === 'boolean'
    )) &&
    (!Object.prototype.hasOwnProperty.call(profile, 'sourceUpdatedAt') || isTimestampLike(profile.sourceUpdatedAt)) &&
    [...NESTED_PRESENTATION_FIELDS].every((field) => (
      !Object.prototype.hasOwnProperty.call(profile, field) ||
      stableSerialize(profile[field]) === stableSerialize(sanitizeNestedPresentationField(field, profile[field]))
    )) &&
    (!Object.prototype.hasOwnProperty.call(profile, 'socialLinks') || (
      isPlainObject(profile.socialLinks) &&
      Object.values(profile.socialLinks).every((url) => typeof url === 'string' && url.length <= 1000)
    ));
}

module.exports = {
  PUBLIC_TEAM_PROFILE_FIELDS,
  PUBLIC_SCHEMA_VERSION,
  buildPublicTeamProfile,
  buildPublicTeamSearchFields,
  collectAllPublicTeamSourceDocuments,
  findUnexpectedPublicTeamProfileFields,
  isPublicTeamActive,
  isPublicTeamDiscoverable,
  isPublicTeamProfileSchemaValid,
  matchesPublicTeamProfileSearch
};
