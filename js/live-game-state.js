import { escapeHtml } from './utils.js';
import { getDefaultLivePeriod, getGoalSportProfile } from './live-sport-config.js';

const statKeyMap = {
  PTS: 'pts',
  POINTS: 'pts',
  REB: 'reb',
  AST: 'ast',
  STL: 'stl',
  BLK: 'blk',
  BLOCK: 'blk',
  TO: 'to',
  TOV: 'to',
  GOALS: 'goals',
  GOAL: 'goals',
  FOUL: 'fouls',
  FOULS: 'fouls',
  FLS: 'fouls'
};

export function resolveOpponentDisplayName(game) {
  const opponent = String(game?.opponent || '').trim();
  if (opponent) return opponent;
  const linkedName = String(game?.opponentTeamName || '').trim();
  if (linkedName) return linkedName;
  return 'Opponent';
}

export function normalizeLiveStatColumns(columns) {
  const normalized = Array.isArray(columns)
    ? columns.map((column) => String(column || '').trim().toUpperCase()).filter(Boolean)
    : [];
  if (normalized.length) return normalized;
  return ['PTS', 'REB', 'AST', 'STL', 'TO'];
}

function normalizeSportLabel(value) {
  return String(value || '').trim().toLowerCase();
}

export function resolveLiveStatConfig({ configs = [], game = null, team = null } = {}) {
  const safeConfigs = Array.isArray(configs) ? configs : [];
  const desiredSport = normalizeSportLabel(game?.sport || team?.sport);
  const configId = String(game?.statTrackerConfigId || '').trim();

  if (configId) {
    const configMatch = safeConfigs.find((config) => String(config?.id || '').trim() === configId);
    if (Array.isArray(configMatch?.columns) && configMatch.columns.length) {
      return configMatch;
    }
  }

  if (desiredSport) {
    const sportMatch = safeConfigs.find((config) => (
      normalizeSportLabel(config?.baseType) === desiredSport &&
      Array.isArray(config?.columns) &&
      config.columns.length
    ));
    if (sportMatch) return sportMatch;
  }

  if (safeConfigs.length === 1 && Array.isArray(safeConfigs[0]?.columns) && safeConfigs[0].columns.length) {
    return safeConfigs[0];
  }

  return null;
}

export function resolvePreferredStatConfigId({ configs = [], team = null } = {}) {
  const config = resolveLiveStatConfig({ configs, team });
  return String(config?.id || '').trim() || null;
}

export function resolveLiveStatColumns({ columns = [], configs = [], game = null, team = null } = {}) {
  const directColumns = normalizeLiveStatColumns(columns);
  if (Array.isArray(columns) && columns.length) return directColumns;

  const config = resolveLiveStatConfig({ configs, game, team });
  if (config) {
    return normalizeLiveStatColumns(config.columns);
  }

  const goalSportProfile = getGoalSportProfile({ game, team });
  if (goalSportProfile) return [...goalSportProfile.statColumns];

  return directColumns;
}

export function resolveViewerLineup({ players = [], onCourt = [], bench = [] } = {}) {
  const rosterIds = Array.isArray(players)
    ? players.map((player) => String(player?.id || '').trim()).filter(Boolean)
    : [];
  const rosterSet = new Set(rosterIds);
  const benchProvided = Array.isArray(bench);
  const seen = new Set();

  const keepPlayer = (playerId) => {
    const normalizedId = String(playerId || '').trim();
    if (!rosterSet.has(normalizedId)) return false;
    if (seen.has(normalizedId)) return false;
    seen.add(normalizedId);
    return true;
  };

  const rawOnCourt = Array.isArray(onCourt) ? onCourt : [];
  rawOnCourt.forEach((playerId) => keepPlayer(playerId));
  const onCourtSet = new Set(seen);
  const onCourtIds = rosterIds.filter((playerId) => onCourtSet.has(playerId));

  let benchIds;
  if (benchProvided) {
    const rawBench = Array.isArray(bench) ? bench : [];
    rawBench.forEach((playerId) => keepPlayer(playerId));
    const benchSet = new Set(seen);
    benchIds = rosterIds.filter((playerId) => benchSet.has(playerId) && !onCourtSet.has(playerId));
  } else {
    benchIds = rosterIds.filter((playerId) => !onCourtSet.has(playerId));
  }

  return { onCourtIds, benchIds };
}

function renderViewerLineupList({
  ids = [],
  emptyLabel = '',
  players = [],
  stats = {},
  statColumns = [],
  lastStatChange = null
} = {}) {
  if (!ids.length) {
    return `<div class="text-sand/40 text-xs">${emptyLabel}</div>`;
  }

  const columns = normalizeLiveStatColumns(statColumns);
  return ids.map((id) => {
    const player = players.find((entry) => entry?.id === id);
    const playerStats = stats[id] || {};
    const highlight = lastStatChange?.playerId === id && !lastStatChange?.isOpponent;
    const nameClass = highlight ? 'text-teal' : 'text-sand';
    const statClass = highlight ? 'text-teal' : 'text-sand';
    const statItems = columns.map((column) => {
      const key = statKeyMap[column] || column.toLowerCase();
      const value = playerStats[key] || 0;
      return `<span class="${statClass}">${value} ${escapeHtml(column)}</span>`;
    }).join('');

    return `
      <div class="bg-slate/50 rounded-lg px-3 py-2">
        <div class="flex items-center gap-2 min-w-0">
          ${player?.photoUrl ? `
            <img src="${escapeHtml(player.photoUrl)}" class="w-6 h-6 rounded-full object-cover" alt="${escapeHtml(player?.name || 'Player')}">
          ` : `
            <div class="w-6 h-6 rounded-full bg-teal/20 text-teal text-[10px] flex items-center justify-center">
              ${escapeHtml((player?.name || 'P')[0])}
            </div>
          `}
          <span class="text-teal font-mono text-xs">#${escapeHtml(player?.num || '')}</span>
          <span class="${nameClass} text-xs truncate">${escapeHtml(player?.name || 'Player')}</span>
        </div>
        <div class="mt-2 flex flex-wrap gap-2 text-[11px] text-sand/70">
          ${statItems}
        </div>
      </div>
    `;
  }).join('');
}

export function renderViewerLineupSections({
  players = [],
  stats = {},
  statColumns = [],
  onCourt = [],
  bench = [],
  lastStatChange = null
} = {}) {
  const { onCourtIds, benchIds } = resolveViewerLineup({ players, onCourt, bench });
  return {
    onCourtIds,
    benchIds,
    onCourtHtml: renderViewerLineupList({
      ids: onCourtIds,
      emptyLabel: 'No players currently on field',
      players,
      stats,
      statColumns,
      lastStatChange
    }),
    benchHtml: renderViewerLineupList({
      ids: benchIds,
      emptyLabel: 'No players currently on bench',
      players,
      stats,
      statColumns,
      lastStatChange
    })
  };
}

export function resolveOpponentStatColumns(statColumns = [], opponentStats = {}) {
  const columns = normalizeLiveStatColumns(statColumns);
  const hasFoulAlias = columns.some((column) => statKeyMap[column] === 'fouls');
  const hasOpponentEntries = Object.keys(opponentStats || {}).length > 0;

  if (!hasFoulAlias && hasOpponentEntries) {
    return [...columns, 'FLS'];
  }

  return columns;
}

export function renderOpponentStatsCards({
  opponentStats = {},
  statColumns = [],
  lastStatChange = null
} = {}) {
  const oppEntries = Object.entries(opponentStats || {});
  if (!oppEntries.length) {
    return '<div class="text-sand/40 text-xs">No opponent stats yet</div>';
  }

  const columns = resolveOpponentStatColumns(statColumns, opponentStats);
  return oppEntries.map(([id, player]) => {
    const highlight = lastStatChange?.isOpponent && lastStatChange?.playerId === id;
    const nameClass = highlight ? 'text-coral' : 'text-sand';
    const statClass = highlight ? 'text-coral' : 'text-sand';
    const statItems = columns.map((column) => {
      const key = statKeyMap[column] || column.toLowerCase();
      const value = player?.[key] || 0;
      return `<span class="${statClass}">${value} ${escapeHtml(column)}</span>`;
    }).join('');
    const initial = escapeHtml((player?.name || 'O')[0]);
    const avatar = player?.photoUrl
      ? `<img src="${escapeHtml(player.photoUrl)}" class="w-6 h-6 rounded-full object-cover" alt="">`
      : `<div class="w-6 h-6 rounded-full bg-coral/20 text-coral text-[10px] flex items-center justify-center">${initial}</div>`;

    return `
      <div class="bg-slate/50 rounded-lg px-3 py-2">
        <div class="flex items-center gap-2 min-w-0">
          ${avatar}
          <span class="text-coral font-mono text-xs">#${escapeHtml(player?.number || '')}</span>
          <span class="${nameClass} text-xs truncate">${escapeHtml(player?.name || 'Opponent')}</span>
        </div>
        <div class="mt-2 flex flex-wrap gap-2 text-[11px] text-sand/70">
          ${statItems}
        </div>
      </div>
    `;
  }).join('');
}

export function applyResetEventState(currentState, event) {
  const period = event?.period || currentState?.period || getDefaultLivePeriod({
    sport: event?.sport || currentState?.sport,
    periods: event?.periods || currentState?.periods
  });
  const onCourt = Array.isArray(event?.onCourt) ? [...event.onCourt] : [];
  const bench = Array.isArray(event?.bench) ? [...event.bench] : [];
  const priorEventIds = currentState?.eventIds instanceof Set
    ? new Set(currentState.eventIds)
    : new Set();
  return {
    ...currentState,
    homeScore: Number.isFinite(event?.homeScore) ? event.homeScore : 0,
    awayScore: Number.isFinite(event?.awayScore) ? event.awayScore : 0,
    period,
    gameClockMs: Number.isFinite(event?.gameClockMs) ? event.gameClockMs : 0,
    events: [],
    // Keep already-seen ids so pre-reset events are not replayed into fresh state.
    eventIds: priorEventIds,
    stats: {},
    opponentStats: {},
    onCourt,
    bench,
    lastStatChange: null,
    scoringRun: { team: null, points: 0 },
    lastRunAnnounced: 0,
    sport: event?.sport || currentState?.sport || null,
    periods: Array.isArray(event?.periods) ? [...event.periods] : currentState?.periods || null
  };
}

export function applyViewerEventToState(currentState = {}, event = {}) {
  const nextState = {
    ...currentState,
    events: Array.isArray(currentState?.events) ? currentState.events : [],
    stats: currentState?.stats || {},
    opponentStats: currentState?.opponentStats || {}
  };

  let shouldRenderLineup = false;

  if (Array.isArray(event?.onCourt)) {
    nextState.onCourt = [...event.onCourt];
    shouldRenderLineup = true;
  }
  if (Array.isArray(event?.bench)) {
    nextState.bench = [...event.bench];
    shouldRenderLineup = true;
  }

  if (event?.type === 'lineup') {
    return {
      state: nextState,
      shouldRenderLineup,
      shouldRenderScoreboard: false,
      shouldRenderPlayByPlay: false,
      shouldRenderStats: false,
      animateScoreboard: false,
      shouldCelebrateScore: false,
      shouldCelebrateEvent: false
    };
  }

  if (event?.type === 'clock_sync') {
    if (event.homeScore !== undefined) nextState.homeScore = event.homeScore;
    if (event.awayScore !== undefined) nextState.awayScore = event.awayScore;
    if (event.period) nextState.period = event.period;
    if (event.gameClockMs !== undefined) nextState.gameClockMs = event.gameClockMs;

    return {
      state: nextState,
      shouldRenderLineup,
      shouldRenderScoreboard: true,
      shouldRenderPlayByPlay: false,
      shouldRenderStats: false,
      animateScoreboard: false,
      shouldCelebrateScore: false,
      shouldCelebrateEvent: false
    };
  }

  nextState.events = Array.isArray(currentState?.events) ? [...currentState.events, event] : [event];

  if (event.homeScore !== undefined) nextState.homeScore = event.homeScore;
  if (event.awayScore !== undefined) nextState.awayScore = event.awayScore;
  if (event.period) nextState.period = event.period;
  if (event.gameClockMs !== undefined) nextState.gameClockMs = event.gameClockMs;

  if (event.type === 'stat' && event.playerId && event.statKey) {
    if (event.isOpponent) {
      const existing = currentState?.opponentStats?.[event.playerId] || {};
      nextState.opponentStats = { ...currentState?.opponentStats };
      nextState.opponentStats[event.playerId] = {
        ...existing,
        name: event.opponentPlayerName || existing.name || '',
        number: event.opponentPlayerNumber || existing.number || '',
        photoUrl: event.opponentPlayerPhoto || existing.photoUrl || ''
      };
      nextState.opponentStats[event.playerId][event.statKey] =
        (nextState.opponentStats[event.playerId][event.statKey] || 0) + (event.value || 0);
    } else {
      const existing = currentState?.stats?.[event.playerId] || {};
      nextState.stats = { ...currentState?.stats };
      nextState.stats[event.playerId] = { ...existing };
      nextState.stats[event.playerId][event.statKey] =
        (nextState.stats[event.playerId][event.statKey] || 0) + (event.value || 0);
    }
    nextState.lastStatChange = {
      playerId: event.playerId,
      statKey: event.statKey,
      isOpponent: !!event.isOpponent
    };
    shouldRenderLineup = true;
  }

  const statKey = String(event.statKey || '').toLowerCase();
  const isScoreEvent = event.type === 'goal' ||
    (event.type === 'stat' && ['pts', 'points', 'goals'].includes(statKey));

  return {
    state: nextState,
    shouldRenderLineup,
    shouldRenderScoreboard: true,
    shouldRenderPlayByPlay: true,
    shouldRenderStats: true,
    animateScoreboard: isScoreEvent,
    shouldCelebrateScore: isScoreEvent,
    shouldCelebrateEvent: !isScoreEvent
  };
}

export function shouldResetViewerFromGameDoc(gameDoc = {}, currentState = {}) {
  const isScheduledReset =
    gameDoc?.liveStatus === 'scheduled' &&
    !gameDoc?.liveHasData &&
    (Number(gameDoc?.homeScore) || 0) === 0 &&
    (Number(gameDoc?.awayScore) || 0) === 0;

  if (!isScheduledReset) return false;

  const hasEvents = Array.isArray(currentState?.events) && currentState.events.length > 0;
  const hasHomeStats = !!(currentState?.stats && Object.keys(currentState.stats).length > 0);
  const hasOpponentStats = !!(currentState?.opponentStats && Object.keys(currentState.opponentStats).length > 0);
  const hasScore = (Number(currentState?.homeScore) || 0) > 0 || (Number(currentState?.awayScore) || 0) > 0;

  return hasEvents || hasHomeStats || hasOpponentStats || hasScore;
}

export function isLiveEventVisibleForResetBoundary(event = {}, resetBoundaryMs = 0) {
  if (!resetBoundaryMs) return true;

  if (event?.type === 'reset') return true;

  const createdAt = event?.createdAt;
  let eventMs = null;
  if (typeof createdAt === 'number') {
    eventMs = createdAt;
  } else if (createdAt && typeof createdAt.toMillis === 'function') {
    eventMs = createdAt.toMillis();
  }

  if (!Number.isFinite(eventMs)) return true;
  return eventMs >= resetBoundaryMs;
}
function getLiveEventTimestampMs(event = {}) {
  const createdAt = event?.createdAt;
  if (typeof createdAt === 'number') return createdAt;
  if (createdAt && typeof createdAt.toMillis === 'function') {
    return createdAt.toMillis();
  }
  return null;
}

export function collectVisibleLiveEventsSequentially(events = [], { seenIds = new Set(), resetBoundaryMs = 0 } = {}) {
  const visibleEvents = [];
  const seenEventIds = seenIds instanceof Set ? seenIds : new Set();
  let currentResetBoundaryMs = Number(resetBoundaryMs) || 0;

  events.forEach((event) => {
    if (!event || seenEventIds.has(event.id)) return;
    if (!isLiveEventVisibleForResetBoundary(event, currentResetBoundaryMs)) return;

    visibleEvents.push(event);

    if (event.type === 'reset') {
      const resetAt = getLiveEventTimestampMs(event);
      if (Number.isFinite(resetAt) && resetAt > currentResetBoundaryMs) {
        currentResetBoundaryMs = resetAt;
      }
    }
  });

  return visibleEvents;
}
