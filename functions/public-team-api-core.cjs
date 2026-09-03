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
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function publicTextArray(value, maxItems = 20, maxLength = 80) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => compactText(item, maxLength))
    .filter(Boolean);
}

function publicFiniteNumber(value, minimum = -1000, maximum = 1000) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function serializePublicStandingsConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const points = value.points && typeof value.points === 'object' && !Array.isArray(value.points)
    ? {
        win: publicFiniteNumber(value.points.win),
        tie: publicFiniteNumber(value.points.tie),
        loss: publicFiniteNumber(value.points.loss)
      }
    : null;
  return {
    enabled: value.enabled === true,
    rankingMode: value.rankingMode === 'win_pct' ? 'win_pct' : 'points',
    points,
    maxGoalDiff: publicFiniteNumber(value.maxGoalDiff, 1, 1000),
    tiebreakers: publicTextArray(value.tiebreakers, 20, 40),
    twoTeamTiebreakers: publicTextArray(value.twoTeamTiebreakers, 20, 40),
    multiTeamTiebreakers: publicTextArray(value.multiTeamTiebreakers, 20, 40)
  };
}

function serializePublicTournamentDescriptor(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    return compactText(value, 160) || null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const descriptor = {};
  ['name', 'label', 'divisionName', 'division', 'poolName'].forEach((key) => {
    const text = compactText(value[key], 160);
    if (text) descriptor[key] = text;
  });
  return Object.keys(descriptor).length ? descriptor : null;
}

function serializePublicTournamentDescriptors(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 100)
    .map(serializePublicTournamentDescriptor)
    .filter(Boolean);
}

function serializePublicTournamentPoolOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const overrides = {};
  Object.entries(value).slice(0, 200).forEach(([rawKey, rawOverride]) => {
    const key = compactText(rawKey, 512);
    if (!key ||
        ['__proto__', 'prototype', 'constructor'].includes(key) ||
        !rawOverride ||
        typeof rawOverride !== 'object' ||
        Array.isArray(rawOverride)) return;
    const override = {
      groupKey: nullableText(rawOverride.groupKey, 512),
      poolName: nullableText(rawOverride.poolName, 160),
      teamOrder: publicTextArray(rawOverride.teamOrder, 100, 160)
    };
    if (override.groupKey || override.poolName || override.teamOrder.length) {
      overrides[key] = override;
    }
  });
  return overrides;
}

function serializePublicGameTournament(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const tournament = {};
  ['divisionName', 'division', 'poolName'].forEach((key) => {
    const text = compactText(value[key], 160);
    if (text) tournament[key] = text;
  });
  return Object.keys(tournament).length ? tournament : null;
}

const KNOWN_PUBLIC_OPPONENT_STAT_KEYS = new Set([
  'ab', 'aces', 'assists', 'ast', 'bb', 'blk', 'blks', 'blocks', 'digs', 'fg3a', 'fg3m',
  'fga', 'fgm', 'fls', 'fouls', 'fp', 'fta', 'ftm', 'goal', 'goals', 'h', 'kills',
  'points', 'pts', 'r', 'reb', 'rebounds', 'rbi', 'sack', 'saves', 'shots',
  'shots_on_target', 'steals', 'stl', 'tack', 'td', 'to', 'turnovers', 'yds'
]);

function normalizePublicOpponentStatKey(value) {
  return compactText(value, 64)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '');
}

function getPublicOpponentStatKeys(config = null) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return [...KNOWN_PUBLIC_OPPONENT_STAT_KEYS];
  }
  const definitions = Array.isArray(config.statDefinitions) ? config.statDefinitions : [];
  const definitionsById = new Map();
  definitions.forEach((definition) => {
    const id = normalizePublicOpponentStatKey(
      definition?.id || definition?.acronym || definition?.label
    );
    if (id) definitionsById.set(id, definition || {});
  });
  const keys = new Set();
  (Array.isArray(config.columns) ? config.columns : []).forEach((column) => {
    const key = normalizePublicOpponentStatKey(column);
    const definition = definitionsById.get(key);
    if (key && definition?.visibility !== 'private' && definition?.scope !== 'team' && !definition?.formula) {
      keys.add(key);
    }
  });
  definitionsById.forEach((definition, key) => {
    if (definition?.visibility !== 'private' && definition?.scope !== 'team' && !definition?.formula) {
      keys.add(key);
    }
  });
  return [...keys];
}

function serializePublicOpponentStats(value, allowedStatKeys = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowlist = new Set(
    (Array.isArray(allowedStatKeys) ? allowedStatKeys : getPublicOpponentStatKeys())
      .map(normalizePublicOpponentStatKey)
      .filter(Boolean)
  );
  const opponentStats = {};
  Object.entries(value).slice(0, 100).forEach(([rawId, rawStats]) => {
    const id = compactText(rawId, 128);
    if (!id ||
        ['__proto__', 'prototype', 'constructor'].includes(id) ||
        !rawStats ||
        typeof rawStats !== 'object' ||
        Array.isArray(rawStats)) return;
    const stats = {};
    const name = compactText(rawStats.name, 160);
    const number = compactText(rawStats.number, 32);
    const photoUrl = publicHttpUrl(rawStats.photoUrl);
    if (name) stats.name = name;
    if (number) stats.number = number;
    if (photoUrl) stats.photoUrl = photoUrl;
    Object.entries(rawStats).slice(0, 100).forEach(([key, rawValue]) => {
      if (['name', 'number', 'photoUrl'].includes(key) ||
          !allowlist.has(normalizePublicOpponentStatKey(key))) return;
      const numberValue = publicFiniteNumber(rawValue, -1_000_000_000_000, 1_000_000_000_000);
      if (numberValue !== null) stats[key] = numberValue;
    });
    if (Object.keys(stats).length) opponentStats[id] = stats;
  });
  return opponentStats;
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
    game?.isDeleted !== true &&
    status !== 'deleted' &&
    liveStatus !== 'deleted';
}

function isExplicitlyShareableGame(game = {}) {
  if (!isPublicGame(game)) return false;
  const visibility = compactText(game?.visibility, 32).toLowerCase();
  return visibility === 'public' ||
    game?.isPublic === true ||
    game?.public === true ||
    game?.shareable === true ||
    game?.isShareable === true ||
    game?.publicCalendar === true;
}

function canProjectPublicGame(team = {}, game = {}) {
  return isPublicGame(game) &&
    (isStrictPublicTeam(team) || isExplicitlyShareableGame(game));
}

function serializePublicTeam(teamId, team = {}) {
  return {
    id: teamId,
    name: compactText(team?.name || team?.teamName, 160) || 'Team',
    sport: nullableText(team?.sport, 80),
    photoUrl: publicHttpUrl(team?.photoUrl || team?.logoUrl || team?.imageUrl),
    city: nullableText(team?.city, 80),
    state: nullableText(team?.state, 40),
    zip: nullableText(team?.zip, 10)
  };
}

function serializePublicTeamDiscovery(teamId, team = {}) {
  if (!isStrictPublicTeam(team)) return null;
  return {
    ...serializePublicTeam(teamId, team),
    description: nullableText(team?.description, 1000),
    appAccess: team?.appAccess === true,
    webAccess: team?.webAccess !== false,
    isPublic: true
  };
}

function serializePublicTeamProfile(teamId, team = {}) {
  const discovery = serializePublicTeamDiscovery(teamId, team);
  if (!discovery) return null;
  const tournamentDivisions = serializePublicTournamentDescriptors(team?.tournamentDivisions);
  const tournamentPools = serializePublicTournamentDescriptors(team?.tournamentPools);
  const legacyTournament = team?.tournament && typeof team.tournament === 'object' && !Array.isArray(team.tournament)
    ? {
        divisions: serializePublicTournamentDescriptors(team.tournament.divisions),
        pools: serializePublicTournamentDescriptors(team.tournament.pools)
      }
    : null;
  const tournament = legacyTournament &&
    (legacyTournament.divisions.length || legacyTournament.pools.length)
    ? legacyTournament
    : null;
  const twitchChannel = compactText(team?.twitchChannel, 25);
  return {
    ...discovery,
    active: true,
    ...(isRecordedReplayPaywallEnabled({}, team) ? { recordedReplayPaywallEnabled: true } : {}),
    leagueUrl: publicHttpUrl(team?.leagueUrl),
    twitchChannel: /^[A-Za-z0-9_]{1,25}$/.test(twitchChannel) ? twitchChannel : null,
    streamEmbedUrl: publicHttpUrl(team?.streamEmbedUrl),
    youtubeEmbedUrl: publicHttpUrl(team?.youtubeEmbedUrl),
    hasCalendarSources: Array.isArray(team?.calendarUrls) &&
      team.calendarUrls.some((url) => compactText(url, 2048)),
    standingsConfig: serializePublicStandingsConfig(team?.standingsConfig),
    tournament,
    tournamentDivisions,
    tournamentPools,
    tournamentPoolOverrides: serializePublicTournamentPoolOverrides(team?.tournamentPoolOverrides)
  };
}

function serializePublicCalendarEvent(event = {}) {
  const startsAt = toDate(event?.date || event?.startsAt);
  if (!startsAt) return null;
  const endsAt = toDate(event?.endDate || event?.endsAt);
  const type = compactText(event?.type, 32).toLowerCase() === 'practice' ? 'practice' : 'game';
  return {
    id: compactText(event?.id || event?.eventKey, 256),
    type,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt?.toISOString() || null,
    title: type === 'practice' ? nullableText(event?.title, 240) : null,
    opponent: type === 'game' ? nullableText(event?.opponent, 240) : null,
    location: nullableText(event?.location, 300),
    status: event?.isCancelled === true
      ? 'cancelled'
      : (compactText(event?.status, 32).toLowerCase() || 'scheduled')
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
  if (game?.isCancelled === true) return 'cancelled';
  const statuses = [game?.status, game?.liveStatus]
    .map((value) => compactText(value, 32).toLowerCase())
    .filter(Boolean);
  if (statuses.some((value) => ['cancelled', 'canceled'].includes(value))) return 'cancelled';
  if (statuses.some((value) => ['postponed', 'delayed'].includes(value))) return 'postponed';
  if (statuses.some((value) => ['completed', 'complete', 'final', 'finished'].includes(value))) return 'completed';
  if (statuses.some((value) => ['live', 'in_progress', 'in-progress'].includes(value))) return 'live';
  return 'scheduled';
}

const EXACT_PUBLIC_LIFECYCLE_STATUSES = new Set([
  'completed',
  'complete',
  'finished',
  'final',
  'cancelled',
  'canceled',
  'live',
  'in_progress',
  'in-progress',
  'scheduled',
  'postponed',
  'delayed'
]);

const EXACT_PUBLIC_LIFECYCLE_ALIASES = new Map([
  ['complete', 'completed'],
  ['finished', 'completed'],
  ['canceled', 'cancelled']
]);

function canonicalizeExactPublicLifecycleStatus(value) {
  return EXACT_PUBLIC_LIFECYCLE_ALIASES.get(value) || value;
}

function normalizePublicLifecycleStatus(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !EXACT_PUBLIC_LIFECYCLE_STATUSES.has(value)) return 'invalid';
  return canonicalizeExactPublicLifecycleStatus(value);
}

function readExactPublicLifecycleField(game, field) {
  const source = game && typeof game === 'object' ? game : {};
  if (!Object.prototype.hasOwnProperty.call(source, field)) {
    return { valid: true, value: '' };
  }
  const value = source[field];
  if (field !== 'type' && (value === null || value === undefined || value === '')) {
    return { valid: true, value: '' };
  }
  if (typeof value !== 'string') {
    return { valid: false, value: '' };
  }
  if (field === 'type') {
    return { valid: value === 'game', value: value === 'game' ? value : '' };
  }
  return {
    valid: EXACT_PUBLIC_LIFECYCLE_STATUSES.has(value),
    value: EXACT_PUBLIC_LIFECYCLE_STATUSES.has(value)
      ? canonicalizeExactPublicLifecycleStatus(value)
      : ''
  };
}

function firstExplicitBoolean(values = []) {
  return values.find((value) => typeof value === 'boolean');
}

function isRecordedReplayPaywallEnabled(game = {}, team = {}) {
  const gameOverride = firstExplicitBoolean([
    game?.teamPassConfig?.recordedReplayPaywallEnabled,
    game?.teamPass?.recordedReplayPaywallEnabled,
    game?.premiumFeatures?.recordedReplayPaywallEnabled,
    game?.recordedReplayPaywallEnabled,
    game?.recordedReplayTeamPassRequired
  ]);
  if (typeof gameOverride === 'boolean') return gameOverride;

  return firstExplicitBoolean([
    team?.teamPassConfig?.recordedReplayPaywallEnabled,
    team?.teamPass?.recordedReplayPaywallEnabled,
    team?.premiumFeatures?.recordedReplayPaywallEnabled,
    team?.recordedReplayPaywallEnabled,
    team?.recordedReplayTeamPassRequired
  ]) === true;
}

function getPublicVideoLifecycle(game = {}) {
  const typeField = readExactPublicLifecycleField(game, 'type');
  const statusField = readExactPublicLifecycleField(game, 'status');
  const liveStatusField = readExactPublicLifecycleField(game, 'liveStatus');
  const hasExactLifecycle = typeField.valid && statusField.valid && liveStatusField.valid;
  const status = statusField.value;
  const liveStatus = liveStatusField.value;
  const completedStatuses = new Set(['completed', 'final']);
  const terminalStatuses = new Set(['completed', 'final', 'cancelled']);
  const activeStatuses = new Set(['live', 'in_progress', 'in-progress']);
  const activeCompatibleStatuses = new Set(['scheduled', ...activeStatuses]);
  const upcomingStatuses = new Set(['scheduled', 'postponed', 'delayed']);
  const statuses = [status, liveStatus].filter(Boolean);
  const hasTerminalFlag = game?.isCancelled === true || game?.deleted === true || game?.isDeleted === true;
  const isCompleted = hasExactLifecycle && !hasTerminalFlag && ((completedStatuses.has(status)
      && (!liveStatus || completedStatuses.has(liveStatus) || liveStatus === 'scheduled'))
    || (!status && completedStatuses.has(liveStatus)));
  const isActiveLive = hasExactLifecycle && !hasTerminalFlag
    && statuses.some((value) => activeStatuses.has(value))
    && statuses.every((value) => activeCompatibleStatuses.has(value))
    && !statuses.some((value) => terminalStatuses.has(value));
  const isUpcoming = hasExactLifecycle && !hasTerminalFlag
    && statuses.every((value) => upcomingStatuses.has(value));
  return {
    isCompleted,
    isActiveLive,
    state: !hasExactLifecycle
      ? 'invalid'
      : isCompleted
        ? 'completed'
        : isActiveLive
          ? 'live'
          : isUpcoming
            ? 'upcoming'
            : 'inactive'
  };
}

function getCanonicalReplayPublicUrl(replayVideo) {
  if (!replayVideo || typeof replayVideo !== 'object') return null;
  const videoId = compactText(replayVideo.videoId, 32);
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || videoId === 'live_stream') return null;
  if (compactText(replayVideo.provider, 32).toLowerCase() !== 'youtube') return null;
  if (compactText(replayVideo.status, 32).toLowerCase() !== 'ready') return null;
  const embedUrl = `https://www.youtube.com/embed/${videoId}`;
  const publicUrl = `https://www.youtube.com/watch?v=${videoId}`;
  return replayVideo.embedUrl === embedUrl && replayVideo.publicUrl === publicUrl ? publicUrl : null;
}

const PUBLIC_YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const PUBLIC_YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const PUBLIC_YOUTUBE_NOCOOKIE_HOSTS = new Set([
  'youtube-nocookie.com',
  'www.youtube-nocookie.com'
]);
const READY_PUBLIC_REPLAY_STATUSES = new Set([
  'ready',
  'available',
  'complete',
  'completed',
  'archived',
  'published'
]);
const BLOCKED_PUBLIC_REPLAY_STATUSES = new Set([
  'processing',
  'pending',
  'queued',
  'recording',
  'transcoding',
  'encoding',
  'failed',
  'error',
  'errored',
  'unavailable',
  'rejected'
]);

function normalizePublicYouTubeReplayUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  const rawAuthority = raw.match(/^https:\/\/([^/?#]+)/i)?.[1] || '';
  if (
    parsed.protocol !== 'https:'
    || rawAuthority.toLowerCase() !== parsed.hostname.toLowerCase()
    || parsed.username
    || parsed.password
    || parsed.port
  ) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  let videoId = null;
  if (host === 'youtu.be') {
    const match = parsed.pathname.match(/^\/([^/]+)\/?$/);
    videoId = match?.[1] || null;
  } else if (PUBLIC_YOUTUBE_HOSTS.has(host)) {
    if (/^\/watch\/?$/.test(parsed.pathname)) {
      const videoIds = parsed.searchParams.getAll('v');
      videoId = videoIds.length === 1 ? videoIds[0] : null;
    } else {
      const match = parsed.pathname.match(/^\/(embed|live|shorts)\/([^/]+)\/?$/);
      videoId = match?.[2] || null;
    }
  } else if (PUBLIC_YOUTUBE_NOCOOKIE_HOSTS.has(host)) {
    const match = parsed.pathname.match(/^\/embed\/([^/]+)\/?$/);
    videoId = match?.[1] || null;
  }

  if (!PUBLIC_YOUTUBE_VIDEO_ID_PATTERN.test(videoId || '') || videoId === 'live_stream') {
    return null;
  }
  return {
    videoId,
    publicUrl: `https://www.youtube.com/watch?v=${videoId}`
  };
}

function normalizePublicReplayStatus(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return 'invalid';
  const status = value.trim().toLowerCase().replace(/[_\s-]+/g, '-');
  if (!status) return null;
  if (READY_PUBLIC_REPLAY_STATUSES.has(status)) return 'ready';
  if (BLOCKED_PUBLIC_REPLAY_STATUSES.has(status)) return 'blocked';
  return 'invalid';
}

function hasSafePublicReplayStatus(game = {}) {
  const replayObjects = [game?.replayVideo, game?.recordedVideo, game?.videoReplay]
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value));
  const statuses = [
    game?.replayStatus,
    game?.recordedReplayStatus,
    game?.videoReplayStatus,
    ...replayObjects.flatMap((value) => [value.status, value.processingStatus])
  ]
    .map(normalizePublicReplayStatus)
    .filter(Boolean);
  return statuses.every((status) => status === 'ready');
}

function normalizeHistoricalReplayObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const identityCandidates = [];
  for (const field of ['publicUrl', 'embedUrl']) {
    const candidate = value[field];
    if (candidate === null || candidate === undefined
      || (typeof candidate === 'string' && !candidate.trim())) continue;
    if (typeof candidate !== 'string') return { invalid: true };
    const normalized = normalizePublicYouTubeReplayUrl(candidate);
    if (!normalized) return { invalid: true };
    identityCandidates.push(normalized);
  }
  for (const field of ['url', 'src']) {
    const candidate = value[field];
    if (candidate === null || candidate === undefined
      || (typeof candidate === 'string' && !candidate.trim())) continue;
    if (typeof candidate !== 'string') return { invalid: true };
    const normalized = normalizePublicYouTubeReplayUrl(candidate);
    if (normalized) {
      identityCandidates.push(normalized);
      continue;
    }
    const safeDirectUrl = publicHttpUrl(candidate);
    if (!safeDirectUrl) return { invalid: true };
    const host = new URL(safeDirectUrl).hostname.toLowerCase();
    if (host === 'youtu.be' || PUBLIC_YOUTUBE_HOSTS.has(host) || PUBLIC_YOUTUBE_NOCOOKIE_HOSTS.has(host)) {
      return { invalid: true };
    }
  }

  if (value.provider !== null && value.provider !== undefined && value.provider !== '') {
    if (typeof value.provider !== 'string' || value.provider.trim().toLowerCase() !== 'youtube') {
      return { invalid: true };
    }
  }
  if (value.videoId !== null && value.videoId !== undefined && value.videoId !== '') {
    if (typeof value.videoId !== 'string') return { invalid: true };
    identityCandidates.push(normalizePublicYouTubeReplayUrl(`https://youtu.be/${value.videoId.trim()}`));
  }
  if (!identityCandidates.length
    || identityCandidates.some((candidate) => !candidate)
    || new Set(identityCandidates.map((candidate) => candidate.videoId)).size !== 1) {
    return { invalid: true };
  }
  return identityCandidates[0];
}

function getHistoricalReplayPublicUrl(game = {}) {
  if (game?.replayVideoFallbackDisabled === true) return null;
  if (!hasSafePublicReplayStatus(game)) return null;

  const canonicalReplay = getCanonicalReplayPublicUrl(game?.replayVideo);
  if (canonicalReplay) return canonicalReplay;

  for (const field of ['replayVideo', 'recordedVideo', 'videoReplay']) {
    const value = game?.[field];
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  }

  const replayVideo = game?.replayVideo;
  if (replayVideo !== null && replayVideo !== undefined) {
    if (!replayVideo || typeof replayVideo !== 'object' || Array.isArray(replayVideo)) return null;
    const hasCanonicalIdentity = ['provider', 'videoId'].some((field) => {
      const value = replayVideo[field];
      return value !== null && value !== undefined
        && !(typeof value === 'string' && !value.trim());
    });
    const normalizedReplayVideo = hasCanonicalIdentity
      ? normalizeHistoricalReplayObject(replayVideo)
      : null;
    if (hasCanonicalIdentity && (!normalizedReplayVideo || normalizedReplayVideo.invalid)) return null;
  }

  const candidates = [];
  for (const replayObject of [game?.replayVideo, game?.recordedVideo, game?.videoReplay]) {
    if (!replayObject || typeof replayObject !== 'object' || Array.isArray(replayObject)) continue;
    const hasArchiveSource = ['url', 'src', 'publicUrl', 'embedUrl', 'videoId', 'provider'].some((field) => {
      const value = replayObject[field];
      return value !== null && value !== undefined
        && !(typeof value === 'string' && !value.trim());
    });
    if (!hasArchiveSource) {
      continue;
    }
    const normalized = normalizeHistoricalReplayObject(replayObject);
    if (!normalized || normalized.invalid) return null;
    candidates.push(normalized);
  }

  for (const value of [
    game?.replayVideoUrl,
    game?.recordedVideoUrl,
    game?.videoReplayUrl,
    game?.archivedVideoUrl,
    game?.replayVideoPublicUrl
  ]) {
    if (value === null || value === undefined
      || (typeof value === 'string' && !value.trim())) continue;
    const normalized = normalizePublicYouTubeReplayUrl(value);
    if (!normalized) return null;
    candidates.push(normalized);
  }

  if (candidates.length) {
    return new Set(candidates.map((candidate) => candidate.videoId)).size === 1
      ? candidates[0].publicUrl
      : null;
  }

  return normalizePublicYouTubeReplayUrl(game?.videoUrl)?.publicUrl || null;
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

function serializePublicGame(game = {}, options = {}) {
  if (!isPublicGame(game)) return null;
  const startsAt = toDate(game?.date || game?.startsAt || game?.startDate || game?.start);
  if (!startsAt) return null;

  const isHome = game?.isHome !== false;
  const homeScore = finiteScore(game?.homeScore);
  const awayScore = finiteScore(game?.awayScore);
  const teamScore = isHome ? homeScore : awayScore;
  const opponentScore = isHome ? awayScore : homeScore;
  const status = normalizeGameStatus(game);
  const videoLifecycle = getPublicVideoLifecycle(game);
  let sourceStatus = game?.isCancelled === true
    ? 'cancelled'
    : normalizePublicLifecycleStatus(game?.status);
  let liveStatus = normalizePublicLifecycleStatus(game?.liveStatus);
  if (videoLifecycle.state === 'invalid') {
    sourceStatus = 'invalid';
    liveStatus = 'invalid';
  }
  let result = null;
  if (status === 'completed' && teamScore !== null && opponentScore !== null) {
    result = teamScore > opponentScore ? 'win' : teamScore < opponentScore ? 'loss' : 'tie';
  }

  const endsAt = toDate(game?.endDate || game?.endsAt || game?.end || game?.dtend);
  const liveResetAt = toDate(game?.liveResetAt);
  const liveResetEventId = compactText(game?.liveResetEventId, 128);
  const tournament = serializePublicGameTournament(game?.tournament);
  const opponentStats = serializePublicOpponentStats(game?.opponentStats, options.opponentStatKeys);
  const teamName = nullableText(game?.teamName, 160);
  const homeTeamName = nullableText(game?.homeTeamName, 160);
  const sport = nullableText(game?.sport, 80);
  const teamPhotoUrl = publicHttpUrl(game?.teamPhotoUrl || game?.homeTeamPhoto);
  const opponentTeamPhoto = publicHttpUrl(game?.opponentTeamPhoto);
  const statSheetPhotoUrl = publicHttpUrl(game?.statSheetPhotoUrl);
  const replayPaywallEnabled = isRecordedReplayPaywallEnabled(game, options.team);
  const directVideoUrl = publicHttpUrl(game?.videoUrl);
  const replayVideoPublicUrl = videoLifecycle.isCompleted && !replayPaywallEnabled
    ? getHistoricalReplayPublicUrl(game)
    : null;
  // An anonymous projection cannot prove Team Pass entitlement. Keep an active
  // live feed available, but never project an archived or explicitly recorded
  // URL from a paywalled game.
  const videoUrl = videoLifecycle.isActiveLive
    ? directVideoUrl
    : (videoLifecycle.isCompleted && !replayPaywallEnabled ? replayVideoPublicUrl : null);
  const id = compactText(game?.id || game?.gameId, game?.isSharedGame === true ? 1000 : 128);
  return {
    id,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt ? endsAt.toISOString() : null,
    opponent: compactText(game?.opponent || game?.opponentTeamName, 160) || 'TBD',
    location: sanitizePublicLocation(game?.location),
    isHome,
    status,
    sourceStatus,
    liveStatus,
    teamScore,
    opponentScore,
    result,
    seasonLabel: nullableText(game?.seasonLabel, 100),
    competitionType: nullableText(game?.competitionType, 80),
    countsTowardSeasonRecord: game?.countsTowardSeasonRecord !== false,
    summary: nullableText(game?.summary || game?.publicSummary, 2000),
    videoLifecycle: videoLifecycle.state,
    videoUrl,
    ...(liveResetAt ? { liveResetAt: liveResetAt.toISOString() } : {}),
    ...(liveResetEventId ? { liveResetEventId } : {}),
    ...(tournament ? { tournament } : {}),
    ...(Object.keys(opponentStats).length ? { opponentStats } : {}),
    ...(teamName ? { teamName } : {}),
    ...(homeTeamName ? { homeTeamName } : {}),
    ...(sport ? { sport } : {}),
    ...(teamPhotoUrl ? { teamPhotoUrl, homeTeamPhoto: teamPhotoUrl } : {}),
    ...(opponentTeamPhoto ? { opponentTeamPhoto } : {}),
    ...(statSheetPhotoUrl ? { statSheetPhotoUrl } : {}),
    ...(game?.isSharedGame === true ? { isSharedGame: true } : {})
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
  now = new Date(),
  opponentStatKeysByGameId = new Map(),
  cursor = null
}) {
  const publicGames = games
    .map((game) => serializePublicGame(game, {
      team,
      opponentStatKeys: opponentStatKeysByGameId instanceof Map
        ? opponentStatKeysByGameId.get(String(game?.id || game?.gameId || ''))
        : undefined
    }))
    .filter(Boolean)
    .sort(comparePublicProjectionItems);
  const page = paginatePublicProjectionItems(publicGames, limit, cursor);
  return {
    version: PUBLIC_TEAM_API_VERSION,
    generatedAt: toDate(now).toISOString(),
    team: serializePublicTeam(teamId, team),
    range: {
      from,
      to,
      truncated: page.truncated
    },
    games: page.items,
    nextCursor: page.nextCursor
  };
}

function comparePublicProjectionItems(left, right) {
  return String(left?.startsAt || '').localeCompare(String(right?.startsAt || '')) ||
    String(left?.id || '').localeCompare(String(right?.id || ''));
}

function encodePublicProjectionCursor(item) {
  const startsAt = String(item?.startsAt || '');
  const id = String(item?.id || '');
  if (!startsAt || !id) return null;
  return Buffer.from(JSON.stringify({ startsAt, id })).toString('base64url');
}

function parsePublicProjectionCursor(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 1024) return { error: 'cursor must be a valid public projection cursor.' };
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const startsAt = String(parsed?.startsAt || '');
    const id = String(parsed?.id || '');
    if (!Number.isFinite(new Date(startsAt).getTime()) || !id || id.length > 1024) {
      return { error: 'cursor must be a valid public projection cursor.' };
    }
    return { startsAt, id };
  } catch {
    return { error: 'cursor must be a valid public projection cursor.' };
  }
}

function isPublicProjectionItemAfterCursor(item, cursor) {
  if (!cursor) return true;
  return comparePublicProjectionItems(item, cursor) > 0;
}

function paginatePublicProjectionItems(items = [], limit = PUBLIC_TEAM_API_DEFAULT_GAMES, cursor = null) {
  const remaining = items.filter((item) => isPublicProjectionItemAfterCursor(item, cursor));
  const pageItems = remaining.slice(0, limit);
  const truncated = remaining.length > pageItems.length;
  return {
    items: pageItems,
    truncated,
    nextCursor: truncated ? encodePublicProjectionCursor(pageItems[pageItems.length - 1]) : null
  };
}

function canTrackedCalendarEventSuppressPublicProjection(event = {}) {
  return isPublicGame(event);
}

async function scanBoundedPublicCalendarTrackingEvents(loadPage, {
  maxDocuments = 5000,
  pageSize = 500
} = {}) {
  const trackedEvents = [];
  let after = null;
  let scannedDocuments = 0;
  while (scannedDocuments < maxDocuments) {
    const limit = Math.min(pageSize, maxDocuments - scannedDocuments);
    const page = await loadPage({ after, limit });
    const documents = Array.isArray(page?.documents) ? page.documents : [];
    if (documents.length > limit) throw new Error('Public calendar tracking page exceeded its requested limit.');
    trackedEvents.push(...documents.filter((event) => compactText(event?.calendarEventUid, 512)));
    scannedDocuments += documents.length;
    if (documents.length < limit) return trackedEvents;
    after = page?.nextCursor || null;
    if (!after || scannedDocuments >= maxDocuments) {
      throw new Error('Public calendar tracking scan limit exceeded.');
    }
  }
  throw new Error('Public calendar tracking scan limit exceeded.');
}

module.exports = {
  PUBLIC_TEAM_API_DEFAULT_GAMES,
  PUBLIC_TEAM_API_MAX_GAMES,
  PUBLIC_TEAM_API_MAX_RANGE_DAYS,
  PUBLIC_TEAM_API_VERSION,
  buildPublicGamesResponse,
  buildPublicRosterResponse,
  canTrackedCalendarEventSuppressPublicProjection,
  canProjectPublicGame,
  comparePublicProjectionItems,
  compareRosterPlayers,
  getPublicOpponentStatKeys,
  getCanonicalReplayPublicUrl,
  getHistoricalReplayPublicUrl,
  getPublicVideoLifecycle,
  isActivePublicPlayer,
  isExplicitlyShareableGame,
  isPublicGame,
  isStrictPublicTeam,
  isPublicProjectionItemAfterCursor,
  isRecordedReplayPaywallEnabled,
  normalizeGameStatus,
  normalizePublicLifecycleStatus,
  normalizePublicYouTubeReplayUrl,
  normalizeTeamId,
  paginatePublicProjectionItems,
  parsePublicProjectionCursor,
  parsePublicGamesQuery,
  publicHttpUrl,
  scanBoundedPublicCalendarTrackingEvents,
  sanitizePublicLocation,
  serializePublicCalendarEvent,
  serializePublicGame,
  serializePublicOpponentStats,
  serializePublicPlayer,
  serializePublicTeam,
  serializePublicTeamDiscovery,
  serializePublicTeamProfile,
  serializePublicTournamentPoolOverrides,
  toDate
};
