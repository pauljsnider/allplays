function slugifyStatId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeLabel(value, fallback = 'Stat') {
  const trimmed = String(value || '').trim();
  return trimmed || fallback;
}

function normalizeScope(value) {
  return String(value || '').trim().toLowerCase() === 'team' ? 'team' : 'player';
}

function normalizeVisibility(value) {
  return String(value || '').trim().toLowerCase() === 'private' ? 'private' : 'public';
}

function normalizeRankingOrder(value) {
  return String(value || '').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
}

function normalizeFormat(value) {
  return String(value || '').trim().toLowerCase() === 'percentage' ? 'percentage' : 'number';
}

function toPrecisionNumber(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return fallback;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeDefinition(definition = {}, defaults = {}) {
  const label = normalizeLabel(definition.label || definition.acronym || defaults.label);
  const acronym = normalizeLabel(definition.acronym || label, label);
  const explicitId = definition.id || defaults.id || '';
  const type = String(definition.formula || defaults.formula || '').trim() ? 'derived' : 'base';
  return {
    id: slugifyStatId(explicitId || acronym || label),
    label,
    acronym,
    type,
    formula: type === 'derived' ? String(definition.formula || defaults.formula || '').trim() : null,
    group: normalizeLabel(definition.group || defaults.group, 'General'),
    scope: normalizeScope(definition.scope || defaults.scope),
    visibility: normalizeVisibility(definition.visibility || defaults.visibility),
    format: normalizeFormat(definition.format || defaults.format),
    precision: toPrecisionNumber(definition.precision ?? defaults.precision, type === 'derived' ? 2 : 0),
    rankingOrder: normalizeRankingOrder(definition.rankingOrder || defaults.rankingOrder),
    topStat: toBoolean(definition.topStat ?? defaults.topStat, false)
  };
}

function dedupeDefinitions(definitions = []) {
  const seen = new Set();
  return definitions.filter((definition) => {
    if (!definition?.id || seen.has(definition.id)) return false;
    seen.add(definition.id);
    return true;
  });
}

function buildBaseDefinitions(columns = []) {
  return (Array.isArray(columns) ? columns : [])
    .map((column) => normalizeLabel(column))
    .filter(Boolean)
    .map((column) => normalizeDefinition({
      label: column,
      acronym: column,
      group: 'General',
      scope: 'player',
      visibility: 'public',
      rankingOrder: 'desc',
      topStat: false
    }));
}

function mergeDefinitions(baseDefinitions = [], providedDefinitions = []) {
  const byId = new Map();
  baseDefinitions.forEach((definition) => {
    byId.set(definition.id, definition);
  });

  (Array.isArray(providedDefinitions) ? providedDefinitions : []).forEach((definition) => {
    const normalized = normalizeDefinition(definition);
    if (!normalized.id) return;
    const existing = byId.get(normalized.id);
    if (existing) {
      byId.set(normalized.id, {
        ...existing,
        ...normalized,
        formula: normalized.formula || existing.formula,
        type: normalized.formula ? 'derived' : existing.type,
        precision: normalized.precision ?? existing.precision
      });
      return;
    }
    byId.set(normalized.id, normalized);
  });

  return Array.from(byId.values());
}

export function parseAdvancedStatDefinitions(text = '') {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [head, ...segments] = line.split('|').map((segment) => segment.trim()).filter(Boolean);
      const [labelPart, idPart] = head.split('=').map((segment) => segment.trim());
      const attributes = {};
      segments.forEach((segment) => {
        const [key, ...rawValue] = segment.split('=');
        if (!key || rawValue.length === 0) return;
        attributes[key.trim()] = rawValue.join('=').trim();
      });

      return normalizeDefinition({
        label: normalizeLabel(labelPart),
        acronym: normalizeLabel(labelPart),
        id: idPart || labelPart,
        formula: attributes.formula || null,
        group: attributes.group || 'General',
        scope: attributes.scope || 'player',
        visibility: attributes.visibility || 'public',
        format: attributes.format || 'number',
        precision: attributes.precision,
        rankingOrder: attributes.rankingOrder || 'desc',
        topStat: attributes.topStat
      });
    });
}

export function normalizeStatTrackerConfig(config = {}) {
  const columns = (Array.isArray(config.columns) ? config.columns : [])
    .map((column) => normalizeLabel(column))
    .filter(Boolean);
  const baseDefinitions = buildBaseDefinitions(columns);
  const providedDefinitions = Array.isArray(config.statDefinitions) ? config.statDefinitions : [];
  const statDefinitions = dedupeDefinitions(mergeDefinitions(baseDefinitions, providedDefinitions));

  return {
    ...config,
    columns,
    statDefinitions
  };
}

export function selectAnalyticsConfig(configs = [], preferredSport = '') {
  const normalizedSport = String(preferredSport || '').trim().toLowerCase();
  const safeConfigs = (Array.isArray(configs) ? configs : []).map((config) => normalizeStatTrackerConfig(config));
  if (!safeConfigs.length) return null;

  const scored = safeConfigs.map((config) => {
    const topStatCount = config.statDefinitions.filter((definition) => definition.topStat).length;
    const sportMatch = normalizedSport && String(config.baseType || '').trim().toLowerCase() === normalizedSport ? 1 : 0;
    return {
      config,
      score: (sportMatch * 100) + topStatCount
    };
  }).sort((a, b) => b.score - a.score || String(a.config.name || '').localeCompare(String(b.config.name || '')));

  return scored[0]?.config || safeConfigs[0];
}

function tokenizeFormula(formula = '') {
  return String(formula || '').match(/[A-Za-z][A-Za-z0-9_]*/g) || [];
}

function sanitizeFormula(formula = '') {
  const trimmed = String(formula || '').trim();
  if (!trimmed) return '';
  const stripped = trimmed.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9_+\-*/().% ]+$/.test(trimmed)) return '';
  return stripped.replace(/%/g, '/100');
}

export function evaluateDerivedFormula(formula = '', stats = {}) {
  const safeFormula = sanitizeFormula(formula);
  if (!safeFormula) return null;

  const scope = {};
  tokenizeFormula(safeFormula).forEach((token) => {
    const normalized = slugifyStatId(token);
    scope[token] = Number(stats?.[normalized] ?? stats?.[token] ?? 0) || 0;
  });

  try {
    const evaluator = new Function(...Object.keys(scope), `return ${safeFormula};`);
    const result = evaluator(...Object.values(scope));
    if (!Number.isFinite(result)) return null;
    return result;
  } catch (error) {
    return null;
  }
}

function formatStatValue(value, definition) {
  if (!isFiniteNumber(value)) return '0';
  const precision = toPrecisionNumber(definition?.precision, 0);
  const fixed = precision > 0 ? value.toFixed(precision) : String(Math.round(value));
  return definition?.format === 'percentage' ? `${fixed}%` : fixed;
}

function resolveDefinitionValue(definition, stats = {}) {
  if (definition.type === 'derived' && definition.formula) {
    return evaluateDerivedFormula(definition.formula, stats);
  }
  return Number(stats?.[definition.id] ?? 0) || 0;
}

function compareLeaderboardEntries(a, b, rankingOrder = 'desc') {
  if (a.value === b.value) {
    return a.playerName.localeCompare(b.playerName);
  }
  return rankingOrder === 'asc' ? a.value - b.value : b.value - a.value;
}

function assignRanks(entries = []) {
  let currentRank = 0;
  let lastValue = null;
  return entries.map((entry, index) => {
    if (lastValue === null || entry.value !== lastValue) {
      currentRank = index + 1;
      lastValue = entry.value;
    }
    return {
      ...entry,
      rank: currentRank
    };
  });
}

function buildStatLeaderboard(definition, players = [], seasonStatsByPlayerId = {}) {
  const entries = players
    .map((player) => {
      const playerStats = seasonStatsByPlayerId?.[player.id] || {};
      const value = resolveDefinitionValue(definition, playerStats);
      if (!isFiniteNumber(value)) return null;
      return {
        playerId: player.id,
        playerName: player.name || 'Player',
        playerNumber: player.number || '-',
        value,
        formattedValue: formatStatValue(value, definition)
      };
    })
    .filter(Boolean)
    .sort((a, b) => compareLeaderboardEntries(a, b, definition.rankingOrder));

  const leaders = assignRanks(entries);
  return {
    id: definition.id,
    label: definition.label,
    acronym: definition.acronym,
    group: definition.group,
    rankingOrder: definition.rankingOrder,
    format: definition.format,
    precision: definition.precision,
    leader: leaders[0] || null,
    leaders
  };
}

export function buildPlayerLeaderboardSnapshot({
  config = {},
  players = [],
  seasonStatsByPlayerId = {}
} = {}) {
  const normalizedConfig = normalizeStatTrackerConfig(config);
  const visibleTopStats = normalizedConfig.statDefinitions.filter((definition) => (
    definition.scope === 'player' &&
    definition.visibility === 'public' &&
    definition.topStat
  ));

  const topStats = visibleTopStats
    .map((definition) => buildStatLeaderboard(definition, players, seasonStatsByPlayerId))
    .filter((stat) => stat.leader);

  const groupsById = new Map();
  topStats.forEach((stat) => {
    const id = slugifyStatId(stat.group || 'general') || 'general';
    if (!groupsById.has(id)) {
      groupsById.set(id, {
        id,
        label: stat.group || 'General',
        stats: []
      });
    }
    groupsById.get(id).stats.push(stat);
  });

  return {
    config: normalizedConfig,
    topStats,
    groups: Array.from(groupsById.values())
  };
}

export function summarizePlayerTopStats(snapshot = {}, playerId = '') {
  return (Array.isArray(snapshot?.topStats) ? snapshot.topStats : [])
    .map((stat) => {
      const entry = (Array.isArray(stat.leaders) ? stat.leaders : []).find((leader) => leader.playerId === playerId);
      if (!entry) return null;
      return {
        id: stat.id,
        label: stat.label,
        rank: entry.rank,
        totalPlayers: stat.leaders.length,
        value: entry.value,
        formattedValue: entry.formattedValue
      };
    })
    .filter(Boolean);
}
