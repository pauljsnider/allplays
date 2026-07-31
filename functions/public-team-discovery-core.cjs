const PUBLIC_TEAM_DISCOVERY_MAX_PAGE_SIZE = 100;
const PUBLIC_TEAM_DISCOVERY_DEFAULT_PAGE_SIZE = 24;
const PUBLIC_TEAM_DISCOVERY_MAX_SCAN_DOCUMENTS = 1000;

function normalizePublicTeamSearch(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 120);
}

function normalizePageSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return PUBLIC_TEAM_DISCOVERY_DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.floor(parsed), 1), PUBLIC_TEAM_DISCOVERY_MAX_PAGE_SIZE);
}

function publicTeamSearchText(team = {}) {
  return [
    team.name,
    team.sport,
    team.city,
    team.state,
    team.zip,
    team.city && team.state ? `${team.city}, ${team.state}` : ''
  ]
    .map(normalizePublicTeamSearch)
    .filter(Boolean)
    .join(' ');
}

function matchesPublicTeamSearch(team = {}, searchText = '') {
  const normalizedSearch = normalizePublicTeamSearch(searchText);
  if (!normalizedSearch) return true;
  const haystack = publicTeamSearchText(team);
  return normalizedSearch
    .split(/[\s,]+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function comparePublicTeams(left = {}, right = {}) {
  const nameResult = String(left.name || '').localeCompare(
    String(right.name || ''),
    undefined,
    { sensitivity: 'base', numeric: true }
  );
  return nameResult || String(left.id || '').localeCompare(String(right.id || ''));
}

function encodeCursor(searchText, team) {
  if (!team?.id) return null;
  return Buffer.from(JSON.stringify({
    v: 1,
    s: normalizePublicTeamSearch(searchText),
    n: normalizePublicTeamSearch(team.name),
    i: String(team.id)
  }), 'utf8').toString('base64url');
}

function decodeCursor(value, searchText) {
  if (!value || typeof value !== 'string' || value.length > 1000) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (decoded?.v !== 1 ||
        decoded?.s !== normalizePublicTeamSearch(searchText) ||
        typeof decoded?.n !== 'string' ||
        typeof decoded?.i !== 'string') {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function isAfterCursor(team, cursor) {
  if (!cursor) return true;
  const name = normalizePublicTeamSearch(team?.name);
  return name > cursor.n || (name === cursor.n && String(team?.id || '') > cursor.i);
}

function paginatePublicTeams(teams = [], options = {}) {
  const searchText = normalizePublicTeamSearch(options.searchText);
  const pageSize = normalizePageSize(options.pageSize);
  const cursor = decodeCursor(options.cursor, searchText);
  const candidates = (Array.isArray(teams) ? teams : [])
    .filter((team) => team?.id && matchesPublicTeamSearch(team, searchText))
    .sort(comparePublicTeams)
    .filter((team) => isAfterCursor(team, cursor));
  const items = candidates.slice(0, pageSize);
  return {
    items,
    nextCursor: candidates.length > pageSize
      ? encodeCursor(searchText, items[items.length - 1])
      : null
  };
}

module.exports = {
  PUBLIC_TEAM_DISCOVERY_DEFAULT_PAGE_SIZE,
  PUBLIC_TEAM_DISCOVERY_MAX_PAGE_SIZE,
  PUBLIC_TEAM_DISCOVERY_MAX_SCAN_DOCUMENTS,
  comparePublicTeams,
  decodeCursor,
  encodeCursor,
  matchesPublicTeamSearch,
  normalizePageSize,
  normalizePublicTeamSearch,
  paginatePublicTeams,
  publicTeamSearchText
};
