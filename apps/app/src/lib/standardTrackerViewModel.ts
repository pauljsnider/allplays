export type StandardTrackerStatDefinition = {
  id?: string | null;
  label?: string | null;
  acronym?: string | null;
  scope?: string | null;
  visibility?: string | null;
};

export type StandardTrackerConfigInput = {
  columns?: unknown[];
  statDefinitions?: StandardTrackerStatDefinition[];
};

export type StandardTrackerRosterPlayerInput = {
  id?: string | null;
  name?: string | null;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  number?: string | number | null;
  playerNumber?: string | number | null;
  active?: boolean;
  archived?: boolean;
  status?: string | null;
  points?: number | null;
  fouls?: number | null;
  stats?: Record<string, unknown> | null;
};

export type StandardTrackerColumn = {
  key: string;
  label: string;
};

export type StandardTrackerPlayer = {
  id: string;
  name: string;
  number: string;
  stats: Record<string, number>;
};

export type StandardTrackerCell = {
  playerId: string;
  playerName: string;
  playerNumber: string;
  column: StandardTrackerColumn;
  value: number;
};

export type StandardTrackerRow = {
  player: StandardTrackerPlayer;
  cells: StandardTrackerCell[];
};

export type StandardTrackerTallies = Record<string, Record<string, number>>;

export type StandardTrackerViewModel = {
  columns: StandardTrackerColumn[];
  rows: StandardTrackerRow[];
  totals: Array<StandardTrackerColumn & { value: number }>;
};

function normalizeText(value: unknown) {
  return String(value || '').trim();
}

function normalizeLookupKey(value: unknown) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9_]+/g, '');
}

export function normalizeStandardTrackerStatKey(value: unknown) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizePlayerName(player: StandardTrackerRosterPlayerInput) {
  const directName = normalizeText(player.name || player.displayName);
  if (directName) return directName;
  const combinedName = [player.firstName, player.lastName].map(normalizeText).filter(Boolean).join(' ');
  return combinedName || 'Player';
}

function normalizePlayerNumber(player: StandardTrackerRosterPlayerInput) {
  return normalizeText(player.number ?? player.playerNumber ?? '');
}

function normalizeStatTotals(stats: Record<string, unknown> | null | undefined) {
  return Object.entries(stats || {}).reduce<Record<string, number>>((totals, [key, value]) => {
    const normalizedKey = normalizeStandardTrackerStatKey(key);
    if (!normalizedKey) return totals;
    const parsed = Number(value);
    totals[normalizedKey] = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    return totals;
  }, {});
}

function isActiveRosterPlayer(player: StandardTrackerRosterPlayerInput) {
  const status = normalizeText(player.status).toLowerCase();
  return player.active !== false && player.archived !== true && (!status || status === 'active');
}

function getDefinitionLookup(config: StandardTrackerConfigInput) {
  const lookup = new Map<string, StandardTrackerStatDefinition>();
  (Array.isArray(config.statDefinitions) ? config.statDefinitions : []).forEach((definition) => {
    [definition.id, definition.label, definition.acronym].forEach((candidate) => {
      const key = normalizeLookupKey(candidate);
      if (key) lookup.set(key, definition);
    });
  });
  return lookup;
}

export function buildStandardTrackerColumns(config: StandardTrackerConfigInput): StandardTrackerColumn[] {
  const definitionsByLabel = getDefinitionLookup(config || {});
  const seen = new Set<string>();

  return (Array.isArray(config?.columns) ? config.columns : [])
    .map((column) => {
      const label = normalizeText(column);
      if (!label) return null;
      const definition = definitionsByLabel.get(normalizeLookupKey(label));
      const key = normalizeStandardTrackerStatKey(definition?.id || label);
      if (!key || seen.has(key)) return null;
      seen.add(key);
      return { key, label };
    })
    .filter(Boolean) as StandardTrackerColumn[];
}

export function buildStandardTrackerPlayers(roster: StandardTrackerRosterPlayerInput[] = []): StandardTrackerPlayer[] {
  return (Array.isArray(roster) ? roster : [])
    .filter(isActiveRosterPlayer)
    .map((player) => {
      const id = normalizeText(player.id);
      if (!id) return null;
      const stats = normalizeStatTotals(player.stats);
      if (player.points !== undefined && player.points !== null) {
        stats.pts = Math.max(0, Number(player.points) || 0);
      }
      if (player.fouls !== undefined && player.fouls !== null) {
        stats.fouls = Math.max(0, Number(player.fouls) || 0);
      }
      return {
        id,
        name: normalizePlayerName(player),
        number: normalizePlayerNumber(player),
        stats
      };
    })
    .filter(Boolean) as StandardTrackerPlayer[];
}

export function buildStandardTrackerTallies(players: StandardTrackerPlayer[], columns: StandardTrackerColumn[]) {
  const allowedKeys = new Set(columns.map((column) => column.key));
  return players.reduce<StandardTrackerTallies>((tallies, player) => {
    tallies[player.id] = {};
    columns.forEach((column) => {
      const directValue = player.stats[column.key];
      const aliasValue = column.key === 'points' ? player.stats.pts : column.key === 'goal' ? player.stats.goals : undefined;
      tallies[player.id][column.key] = Math.max(0, Number(directValue ?? aliasValue ?? 0) || 0);
    });
    Object.entries(player.stats).forEach(([key, value]) => {
      if (allowedKeys.has(key)) tallies[player.id][key] = Math.max(0, Number(value) || 0);
    });
    return tallies;
  }, {});
}

export function applyStandardTrackerTallyDelta(tallies: StandardTrackerTallies, playerId: string, statKey: string, delta: number) {
  const normalizedPlayerId = normalizeText(playerId);
  const normalizedStatKey = normalizeStandardTrackerStatKey(statKey);
  if (!normalizedPlayerId || !normalizedStatKey) return { ...tallies };
  const playerTallies = { ...(tallies[normalizedPlayerId] || {}) };
  playerTallies[normalizedStatKey] = Math.max(0, Number(playerTallies[normalizedStatKey] || 0) + Number(delta || 0));
  return {
    ...tallies,
    [normalizedPlayerId]: playerTallies
  };
}

export function buildStandardTrackerViewModel({
  config,
  roster,
  tallies
}: {
  config: StandardTrackerConfigInput;
  roster: StandardTrackerRosterPlayerInput[];
  tallies?: StandardTrackerTallies;
}): StandardTrackerViewModel {
  const columns = buildStandardTrackerColumns(config);
  const players = buildStandardTrackerPlayers(roster);
  const resolvedTallies = tallies || buildStandardTrackerTallies(players, columns);
  const rows = players.map((player) => ({
    player,
    cells: columns.map((column) => ({
      playerId: player.id,
      playerName: player.name,
      playerNumber: player.number,
      column,
      value: Math.max(0, Number(resolvedTallies[player.id]?.[column.key] || 0))
    }))
  }));
  const totals = columns.map((column) => ({
    ...column,
    value: rows.reduce((sum, row) => sum + Math.max(0, Number(resolvedTallies[row.player.id]?.[column.key] || 0)), 0)
  }));
  return { columns, rows, totals };
}
