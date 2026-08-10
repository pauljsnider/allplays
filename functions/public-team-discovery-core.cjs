const PUBLIC_TEAM_DISCOVERY_MAX_PAGE_SIZE = 100;
const PUBLIC_TEAM_DISCOVERY_DEFAULT_PAGE_SIZE = 24;
const PUBLIC_TEAM_DISCOVERY_MAX_SCAN_DOCUMENTS = 200;
const PUBLIC_TEAM_DISCOVERY_MAX_SEARCH_QUERIES = 4;

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

function toTitleCase(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ');
}

function buildPublicTeamSearchStrategies(searchText = '') {
  const rawSearch = String(searchText || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!rawSearch) return [];

  const normalizedSearch = rawSearch.toLowerCase();
  const strategies = [
    { field: 'publicSearchName', start: normalizedSearch, end: `${normalizedSearch}\uf8ff` },
    { field: 'name', start: toTitleCase(rawSearch), end: `${toTitleCase(rawSearch)}\uf8ff` }
  ];

  if (/^\d{1,5}$/.test(rawSearch)) {
    strategies.push(
      { field: 'publicSearchZip', start: rawSearch, end: `${rawSearch}\uf8ff` },
      { field: 'zip', start: rawSearch, end: `${rawSearch}\uf8ff` }
    );
    return strategies;
  }

  if (/^[A-Za-z]{2}$/.test(rawSearch)) {
    const state = rawSearch.toUpperCase();
    strategies.push(
      { field: 'publicSearchState', start: state, end: `${state}\uf8ff` },
      { field: 'state', start: state, end: `${state}\uf8ff` }
    );
    return strategies;
  }

  const [cityPart, statePart = ''] = rawSearch.split(',').map((part) => part.trim());
  const city = String(cityPart || rawSearch).toLowerCase();
  const legacyCity = toTitleCase(cityPart || rawSearch);
  const state = statePart.toUpperCase();
  strategies.push(
    { field: 'publicSearchCity', start: city, end: `${city}\uf8ff`, state },
    { field: 'city', start: legacyCity, end: `${legacyCity}\uf8ff`, state }
  );
  return strategies;
}

function publicTeamMatchesSearchStrategy(team = {}, strategy = {}) {
  const fieldValue = String(team?.[strategy.field] || '').trim();
  if (!fieldValue.startsWith(strategy.start)) return false;
  if (!strategy.state) return true;
  const teamState = String(team.publicSearchState || team.state || '').trim().toUpperCase();
  return teamState.startsWith(strategy.state);
}

function encodeSearchCursor(searchText, strategyCursors, rotation = 0) {
  if (!strategyCursors.some((cursor) => cursor?.done !== true)) return null;
  return Buffer.from(JSON.stringify({
    v: 3,
    s: normalizePublicTeamSearch(searchText),
    r: rotation,
    c: strategyCursors.map((cursor) => cursor?.done === true
      ? { d: true }
      : cursor?.value && cursor?.id
        ? { v: cursor.value, i: cursor.id }
        : null)
  }), 'utf8').toString('base64url');
}

function decodeSearchCursor(value, searchText, strategyCount) {
  const empty = {
    rotation: 0,
    strategyCursors: Array.from({ length: strategyCount }, () => null)
  };
  if (!value || typeof value !== 'string' || value.length > 10000) return empty;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (decoded?.v !== 3 ||
        decoded?.s !== normalizePublicTeamSearch(searchText) ||
        !Array.isArray(decoded?.c) ||
        decoded.c.length !== strategyCount) {
      return empty;
    }
    const strategyCursors = decoded.c.map((cursor) => {
      if (cursor?.d === true) return { done: true };
      if (cursor === null) return null;
      if (typeof cursor?.v !== 'string' || !cursor.v || typeof cursor?.i !== 'string' || !cursor.i) {
        throw new TypeError('Invalid strategy cursor.');
      }
      return { value: cursor.v, id: cursor.i };
    });
    return {
      rotation: Number.isInteger(decoded.r) && decoded.r >= 0 ? decoded.r % strategyCount : 0,
      strategyCursors
    };
  } catch {
    return empty;
  }
}

function allocateSearchStrategyLimits(strategyCursors, pageSize, rotation = 0) {
  const activeIndexes = strategyCursors
    .map((cursor, index) => cursor?.done === true ? -1 : index)
    .filter((index) => index >= 0);
  const limits = Array.from({ length: strategyCursors.length }, () => 0);
  if (!activeIndexes.length) return limits;
  const baseLimit = Math.floor(pageSize / activeIndexes.length);
  const remainder = pageSize % activeIndexes.length;
  activeIndexes.forEach((index) => { limits[index] = baseLimit; });
  for (let offset = 0; offset < remainder; offset += 1) {
    const activeIndex = activeIndexes[(rotation + offset) % activeIndexes.length];
    limits[activeIndex] += 1;
  }
  return limits;
}

async function searchDatastorePublicTeamPage(loadStrategyRecords, options = {}) {
  if (typeof loadStrategyRecords !== 'function') {
    throw new TypeError('loadStrategyRecords must be a function.');
  }
  const searchText = normalizePublicTeamSearch(options.searchText);
  const pageSize = normalizePageSize(options.pageSize);
  const strategies = buildPublicTeamSearchStrategies(searchText)
    .slice(0, PUBLIC_TEAM_DISCOVERY_MAX_SEARCH_QUERIES);
  if (!strategies.length) return { items: [], nextCursor: null };

  const decodedCursor = decodeSearchCursor(options.cursor, searchText, strategies.length);
  const strategyCursors = decodedCursor.strategyCursors;
  const limits = allocateSearchStrategyLimits(strategyCursors, pageSize, decodedCursor.rotation);
  const loadedPages = await Promise.all(strategies.map(async (strategy, index) => {
    if (!limits[index]) return null;
    const loaded = await loadStrategyRecords({
      strategy,
      strategyIndex: index,
      cursor: strategyCursors[index],
      limit: limits[index]
    });
    return Array.isArray(loaded?.records) ? loaded.records.slice(0, limits[index]) : [];
  }));

  const teamsById = new Map();
  loadedPages.forEach((records, strategyIndex) => {
    if (!records) return;
    const strategy = strategies[strategyIndex];
    records.forEach((record) => {
      const data = record?.data || {};
      const item = record?.item;
      if (!record?.id || !item?.id || !publicTeamMatchesSearchStrategy(data, strategy)) return;
      if (strategies.slice(0, strategyIndex)
        .some((earlierStrategy) => publicTeamMatchesSearchStrategy(data, earlierStrategy))) {
        return;
      }
      teamsById.set(item.id, item);
    });
    const lastRecord = records[records.length - 1];
    strategyCursors[strategyIndex] = records.length < limits[strategyIndex]
      ? { done: true }
      : {
          value: String(lastRecord?.value || lastRecord?.data?.[strategy.field] || ''),
          id: String(lastRecord?.id || '')
        };
  });

  const items = Array.from(teamsById.values()).sort(comparePublicTeams);
  const queriedCount = limits.filter(Boolean).length;
  const nextRotation = strategies.length
    ? (decodedCursor.rotation + Math.max(queriedCount, 1)) % strategies.length
    : 0;
  return {
    items,
    nextCursor: encodeSearchCursor(searchText, strategyCursors, nextRotation)
  };
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

function encodeDatastoreCursor(searchText, documentId) {
  if (!documentId) return null;
  return Buffer.from(JSON.stringify({
    v: 2,
    s: normalizePublicTeamSearch(searchText),
    i: String(documentId)
  }), 'utf8').toString('base64url');
}

function decodeDatastoreCursor(value, searchText) {
  if (!value || typeof value !== 'string' || value.length > 1000) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (decoded?.v !== 2 ||
        decoded?.s !== normalizePublicTeamSearch(searchText) ||
        typeof decoded?.i !== 'string' ||
        !decoded.i) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function buildDatastorePublicTeamPage(records = [], options = {}) {
  const searchText = normalizePublicTeamSearch(options.searchText);
  const pageSize = normalizePageSize(options.pageSize);
  const boundedRecords = (Array.isArray(records) ? records : [])
    .slice(0, PUBLIC_TEAM_DISCOVERY_MAX_SCAN_DOCUMENTS);
  const items = [];
  let lastScannedId = '';
  let lastScannedIndex = -1;

  for (const [index, record] of boundedRecords.entries()) {
    lastScannedIndex = index;
    lastScannedId = String(record?.id || '');
    if (record?.item?.id && matchesPublicTeamSearch(record.item, searchText)) {
      items.push(record.item);
      if (items.length === pageSize) break;
    }
  }

  const scannedAllLoadedRecords = lastScannedIndex === boundedRecords.length - 1;
  const hasMore = items.length === pageSize
    ? lastScannedIndex < records.length - 1
    : options.hasMore === true || !scannedAllLoadedRecords;

  return {
    items,
    nextCursor: hasMore && lastScannedId
      ? encodeDatastoreCursor(searchText, lastScannedId)
      : null
  };
}

async function scanDatastorePublicTeamPage(loadRecords, options = {}) {
  if (typeof loadRecords !== 'function') {
    throw new TypeError('loadRecords must be a function.');
  }
  const searchText = normalizePublicTeamSearch(options.searchText);
  const pageSize = normalizePageSize(options.pageSize);
  const initialCursor = decodeDatastoreCursor(options.cursor, searchText);
  const items = [];
  let afterId = initialCursor?.i || '';

  while (items.length < pageSize) {
    const loaded = await loadRecords({
      afterId,
      limit: searchText
        ? PUBLIC_TEAM_DISCOVERY_MAX_SCAN_DOCUMENTS + 1
        : (pageSize - items.length) + 1
    });
    const records = Array.isArray(loaded?.records) ? loaded.records : [];
    const page = buildDatastorePublicTeamPage(records, {
      searchText,
      pageSize: pageSize - items.length,
      hasMore: loaded?.hasMore === true
    });
    items.push(...page.items);

    if (!page.nextCursor) {
      return { items, nextCursor: null };
    }
    if (items.length === pageSize) {
      return { items, nextCursor: page.nextCursor };
    }

    const nextCursor = decodeDatastoreCursor(page.nextCursor, searchText);
    if (!nextCursor?.i || nextCursor.i === afterId) {
      throw new Error('Public team discovery scan did not advance.');
    }
    afterId = nextCursor.i;
  }

  return { items, nextCursor: null };
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
  return comparePublicTeams(team, { name: cursor.n, id: cursor.i }) > 0;
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
  PUBLIC_TEAM_DISCOVERY_MAX_SEARCH_QUERIES,
  allocateSearchStrategyLimits,
  buildPublicTeamSearchStrategies,
  comparePublicTeams,
  buildDatastorePublicTeamPage,
  decodeCursor,
  decodeDatastoreCursor,
  decodeSearchCursor,
  encodeCursor,
  encodeDatastoreCursor,
  matchesPublicTeamSearch,
  normalizePageSize,
  normalizePublicTeamSearch,
  paginatePublicTeams,
  publicTeamSearchText,
  publicTeamMatchesSearchStrategy,
  searchDatastorePublicTeamPage,
  scanDatastorePublicTeamPage
};
