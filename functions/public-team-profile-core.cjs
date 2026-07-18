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
const MAX_NESTED_DEPTH = 6;
const MAX_OBJECT_KEYS = 100;
const MAX_ARRAY_ITEMS = 200;
const MAX_NESTED_STRING_LENGTH = 2000;
const BLOCKED_NESTED_KEY_PATTERN = /(token|secret|password|credential|private|admin|owner|manager|email|phone|contact|provider|registration|auth|api.?key|access.?key|webhook|calendar.?url)/i;
const NESTED_PRESENTATION_FIELDS = new Set([
  'standingsConfig', 'tournament', 'tournamentDivisions',
  'tournamentPools', 'tournamentPoolOverrides'
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

function sanitizeNestedPresentationValue(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.slice(0, MAX_NESTED_STRING_LENGTH);
  if (depth >= MAX_NESTED_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeNestedPresentationValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!isPlainObject(value)) return undefined;
  const result = {};
  Object.entries(value).slice(0, MAX_OBJECT_KEYS).forEach(([key, item]) => {
    const normalizedKey = String(key || '').trim().slice(0, 100);
    if (!normalizedKey || BLOCKED_NESTED_KEY_PATTERN.test(normalizedKey)) return;
    const sanitized = sanitizeNestedPresentationValue(item, depth + 1);
    if (sanitized !== undefined) result[normalizedKey] = sanitized;
  });
  return result;
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

function isSafeNestedPresentationValue(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= MAX_NESTED_STRING_LENGTH;
  if (depth >= MAX_NESTED_DEPTH) return false;
  if (Array.isArray(value)) {
    return value.length <= MAX_ARRAY_ITEMS && value.every((item) => isSafeNestedPresentationValue(item, depth + 1));
  }
  if (!isPlainObject(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_OBJECT_KEYS && entries.every(([key, item]) => (
    key.length > 0 && key.length <= 100 &&
    !BLOCKED_NESTED_KEY_PATTERN.test(key) &&
    isSafeNestedPresentationValue(item, depth + 1)
  ));
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

function buildPublicTeamProfile(team = {}) {
  if (!isPublicTeamDiscoverable(team)) return null;

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
      const sanitized = sanitizeNestedPresentationValue(value);
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
    active: true,
    sourceUpdatedAt: team.updatedAt || null
  };
}

function matchesPublicTeamProfileSearch(profile = {}, searchText = '') {
  const search = normalizeText(searchText).toLowerCase();
  if (!search) return true;
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
    [...NESTED_PRESENTATION_FIELDS].every((field) => (
      !Object.prototype.hasOwnProperty.call(profile, field) || isSafeNestedPresentationValue(profile[field])
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
  findUnexpectedPublicTeamProfileFields,
  isPublicTeamActive,
  isPublicTeamDiscoverable,
  isPublicTeamProfileSchemaValid,
  matchesPublicTeamProfileSearch
};
