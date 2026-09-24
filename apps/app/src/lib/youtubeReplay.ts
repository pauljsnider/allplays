const youtubeVideoIdPattern = /^[A-Za-z0-9_-]{11}$/;

const youtubeHosts = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com'
]);

const youtubeNoCookieHosts = new Set([
  'youtube-nocookie.com',
  'www.youtube-nocookie.com'
]);

export type YouTubeReplayVideo = {
  provider: 'youtube';
  videoId: string;
  embedUrl: string;
  publicUrl: string;
  title?: string;
  status: 'ready';
  linkedBy?: string;
  linkedAt?: unknown;
};

export type NormalizedYouTubeReplay = Pick<
  YouTubeReplayVideo,
  'provider' | 'videoId' | 'embedUrl' | 'publicUrl'
>;

export const replayArchiveFieldNames = [
  'replayVideo',
  'recordedVideo',
  'videoReplay',
  'replayVideoUrl',
  'recordedVideoUrl',
  'videoReplayUrl',
  'archivedVideoUrl',
  'replayVideoPublicUrl',
  'replayVideoPosterUrl',
  'replayVideoTitle',
  'replayVideoDurationMs',
  'replayStatus',
  'recordedReplayStatus',
  'videoReplayStatus',
  'videoUrl',
  'replayVideoFallbackDisabled'
] as const;

export const legacyReplayArchiveFieldNames = [
  'recordedVideo',
  'videoReplay',
  'replayVideoUrl',
  'recordedVideoUrl',
  'videoReplayUrl',
  'archivedVideoUrl',
  'replayVideoPublicUrl',
  'replayVideoPosterUrl',
  'replayVideoTitle',
  'replayVideoDurationMs',
  'replayStatus',
  'recordedReplayStatus',
  'videoReplayStatus',
  'replayVideoFallbackDisabled'
] as const;

export type ReplayArchiveFieldName = typeof replayArchiveFieldNames[number];
export type ReplayArchiveState = Partial<Record<ReplayArchiveFieldName, unknown>>;

const replayTimestampMarker = '__allplaysReplayTimestampV1';

export type ReplayTimestampComponents = {
  seconds: number;
  nanoseconds: number;
};

/**
 * Firestore REST timestamps can carry nanoseconds that JavaScript Date drops.
 * This serializable marker survives the app's JSON cache so a later SDK
 * transaction can compare the exact replay state that the user loaded.
 */
export function createReplayTimestampValue(seconds: number, nanoseconds: number) {
  if (!Number.isSafeInteger(seconds)
    || !Number.isInteger(nanoseconds)
    || nanoseconds < 0
    || nanoseconds >= 1_000_000_000) {
    return null;
  }
  return {
    [replayTimestampMarker]: true,
    seconds,
    nanoseconds
  };
}

export function getReplayTimestampComponents(value: unknown): ReplayTimestampComponents | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  const hasAllPlaysMarker = source[replayTimestampMarker] === true;
  const hasFirestoreJsonMarker = source.type === 'firestore/timestamp/1.0';
  if ((!hasAllPlaysMarker && !hasFirestoreJsonMarker)
    || keys.length !== 3
    || !Object.prototype.hasOwnProperty.call(source, 'seconds')
    || !Object.prototype.hasOwnProperty.call(source, 'nanoseconds')
    || typeof source.seconds !== 'number'
    || typeof source.nanoseconds !== 'number') {
    return null;
  }
  const normalized = createReplayTimestampValue(source.seconds, source.nanoseconds);
  return normalized
    ? { seconds: normalized.seconds, nanoseconds: normalized.nanoseconds }
    : null;
}

function hasReplayArchiveFieldValue(value: unknown) {
  if (value === null || value === undefined) return false;
  return typeof value !== 'string' || Boolean(value.trim());
}

/**
 * Preserve every archive alias that playback understands. Keeping this raw
 * state separate from the normalized YouTube metadata makes replacement
 * explicit and gives the transaction a complete compare-and-swap boundary.
 */
export function getReplayArchiveState(value: unknown): ReplayArchiveState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return replayArchiveFieldNames.reduce<ReplayArchiveState>((state, field) => {
    if (Object.prototype.hasOwnProperty.call(source, field) && hasReplayArchiveFieldValue(source[field])) {
      state[field] = source[field];
    }
    return state;
  }, {});
}

export function hasReplayArchiveEvidence(value: unknown) {
  const state = getReplayArchiveState(value);
  if (state.replayVideoFallbackDisabled === true) return false;
  return Object.entries(state).some(([field, fieldValue]) => {
    if (field === 'replayVideoFallbackDisabled') return false;
    if (field === 'videoUrl') return false;
    return hasReplayArchiveFieldValue(fieldValue);
  });
}

const readyReplayStatuses = new Set([
  'ready', 'available', 'complete', 'completed', 'archived', 'published'
]);

function replayRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasSafeReplayAvailability(source: Record<string, unknown>) {
  const replayObjects = ['replayVideo', 'recordedVideo', 'videoReplay']
    .map((field) => replayRecord(source[field]))
    .filter((value): value is Record<string, unknown> => Boolean(value));
  const statuses = [
    source.replayStatus,
    source.recordedReplayStatus,
    source.videoReplayStatus,
    ...replayObjects.flatMap((value) => [value.status, value.processingStatus])
  ].filter((value) => value !== null && value !== undefined && value !== '');
  return statuses.every((value) => {
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase().replace(/[_\s-]+/g, '-');
    return !normalized || readyReplayStatuses.has(normalized);
  });
}

function isSafeReplayDirectUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function hasReplayFieldValue(value: unknown) {
  if (value === null || value === undefined) return false;
  return typeof value !== 'string' || Boolean(value.trim());
}

function isYouTubeProviderUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const host = new URL(value.trim()).hostname.toLowerCase();
    return host === 'youtu.be'
      || youtubeHosts.has(host)
      || youtubeNoCookieHosts.has(host);
  } catch {
    return false;
  }
}

function inspectReplayYouTubeMetadata(
  value: Record<string, unknown>,
  { strictYouTubeProvider = false, allowGenericPublicUrl = false } = {}
) {
  const candidates: NormalizedYouTubeReplay[] = [];
  const providerPresent = hasReplayFieldValue(value.provider);
  if (providerPresent && typeof value.provider !== 'string') return { invalid: true, candidate: null };
  const provider = typeof value.provider === 'string' ? value.provider.trim().toLowerCase() : '';

  if (hasReplayFieldValue(value.videoId)) {
    if (typeof value.videoId !== 'string') return { invalid: true, candidate: null };
    const normalized = normalizeYouTubeReplayUrl(`https://youtu.be/${value.videoId.trim()}`);
    if (!normalized) return { invalid: true, candidate: null };
    candidates.push(normalized);
  }

  if (hasReplayFieldValue(value.embedUrl)) {
    if (typeof value.embedUrl !== 'string') return { invalid: true, candidate: null };
    const normalized = normalizeYouTubeReplayUrl(value.embedUrl);
    if (!normalized) return { invalid: true, candidate: null };
    candidates.push(normalized);
  }

  if (hasReplayFieldValue(value.publicUrl)) {
    if (typeof value.publicUrl !== 'string') return { invalid: true, candidate: null };
    const normalized = normalizeYouTubeReplayUrl(value.publicUrl);
    if (normalized) {
      candidates.push(normalized);
    } else if (isYouTubeProviderUrl(value.publicUrl)
      || !allowGenericPublicUrl
      || !isSafeReplayDirectUrl(value.publicUrl)) {
      return { invalid: true, candidate: null };
    }
  }

  if ((strictYouTubeProvider || provider === 'youtube') && !candidates.length) {
    return { invalid: true, candidate: null };
  }
  if (provider && provider !== 'youtube' && candidates.length) {
    return { invalid: true, candidate: null };
  }
  if (new Set(candidates.map((candidate) => candidate.videoId)).size > 1) {
    return { invalid: true, candidate: null };
  }
  return { invalid: false, candidate: candidates[0] || null };
}

function hasPlayableReplaySource(source: Record<string, unknown>) {
  if (source.replayVideoFallbackDisabled === true) return false;
  if (!hasSafeReplayAvailability(source)) return false;
  const replayVideo = replayRecord(source.replayVideo);
  const recordedVideo = replayRecord(source.recordedVideo);
  const videoReplay = replayRecord(source.videoReplay);

  if (String(replayVideo?.provider || '').trim().toLowerCase() === 'youtube') {
    if (!replayVideo) return false;
    const canonical = inspectReplayYouTubeMetadata(replayVideo, { strictYouTubeProvider: true });
    return !canonical.invalid && Boolean(canonical.candidate);
  }

  for (const field of ['replayVideo', 'recordedVideo', 'videoReplay']) {
    if (hasReplayFieldValue(source[field]) && !replayRecord(source[field])) return false;
  }

  const directSources = [
    replayVideo?.url,
    replayVideo?.src,
    recordedVideo?.url,
    recordedVideo?.src,
    videoReplay?.url,
    videoReplay?.src,
    source.replayVideoUrl,
    source.recordedVideoUrl,
    source.videoReplayUrl,
    source.archivedVideoUrl
  ];
  const presentDirectSources = directSources.filter((candidate) => (
    hasReplayFieldValue(candidate)
  ));
  const directYouTubeCandidates: NormalizedYouTubeReplay[] = [];
  for (const candidate of presentDirectSources) {
    if (!isSafeReplayDirectUrl(candidate)) return false;
    const normalized = normalizeYouTubeReplayUrl(candidate);
    if (normalized) directYouTubeCandidates.push(normalized);
    else if (isYouTubeProviderUrl(candidate)) return false;
  }

  const publicCandidates: NormalizedYouTubeReplay[] = [];
  for (const replay of [replayVideo, recordedVideo, videoReplay]) {
    if (!replay) continue;
    const inspected = inspectReplayYouTubeMetadata(replay, {
      allowGenericPublicUrl: presentDirectSources.length > 0
    });
    if (inspected.invalid) return false;
    if (inspected.candidate) publicCandidates.push(inspected.candidate);
  }
  if (hasReplayFieldValue(source.replayVideoPublicUrl)) {
    if (typeof source.replayVideoPublicUrl !== 'string') return false;
    const normalized = normalizeYouTubeReplayUrl(source.replayVideoPublicUrl);
    if (normalized) publicCandidates.push(normalized);
    else if (isYouTubeProviderUrl(source.replayVideoPublicUrl)
      || !presentDirectSources.length
      || !isSafeReplayDirectUrl(source.replayVideoPublicUrl)) return false;
  }

  const youtubeCandidates = [...publicCandidates, ...directYouTubeCandidates];
  if (new Set(youtubeCandidates.map((candidate) => candidate.videoId)).size > 1) {
    return false;
  }
  if (presentDirectSources.length || youtubeCandidates.length) return true;

  return isCompletedGameForReplay(source)
    && typeof source.videoUrl === 'string'
    && Boolean(normalizeYouTubeReplayUrl(source.videoUrl));
}

export function hasReplayVideoSourceEvidence(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  const rawReplayState = source.rawReplayState;
  const rawSource = replayRecord(rawReplayState);
  const evidenceSource = rawSource && Object.keys(rawSource).length
    ? { ...source, ...rawSource }
    : source;
  if (evidenceSource.replayVideoFallbackDisabled === true) return false;
  if (hasPlayableReplaySource(evidenceSource)) return true;
  const hasLocalEvidence = hasReplayArchiveEvidence(evidenceSource)
    || hasReplayFieldValue(evidenceSource.videoUrl);
  return !hasLocalEvidence && source.hasReplayVideo === true;
}

function getRawHttpsAuthority(value: string) {
  const match = value.match(/^https:\/\/([^/?#]+)/i);
  return match?.[1] || '';
}

function getYouTubeVideoId(url: URL) {
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname;

  if (host === 'youtu.be') {
    const match = pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/);
    return match?.[1] || '';
  }

  if (youtubeNoCookieHosts.has(host)) {
    const match = pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})\/?$/);
    return match?.[1] || '';
  }

  if (!youtubeHosts.has(host)) return '';

  if (pathname === '/watch' || pathname === '/watch/') {
    const videoIds = url.searchParams.getAll('v');
    const videoId = videoIds.length === 1 ? videoIds[0] : '';
    return youtubeVideoIdPattern.test(videoId) ? videoId : '';
  }

  const pathMatch = pathname.match(/^\/(?:live|embed|shorts)\/([A-Za-z0-9_-]{11})\/?$/);
  return pathMatch?.[1] || '';
}

/**
 * Accept one exact, public YouTube video URL and remove all share/tracking data.
 * Channel pages and channel-level live feeds are intentionally rejected because
 * they do not identify a durable replay for one game.
 */
export function normalizeYouTubeReplayUrl(value: unknown): NormalizedYouTubeReplay | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  // URL normalizes an explicit default port away, so inspect the original
  // authority too. Replay destinations never need credentials or custom ports.
  const authority = getRawHttpsAuthority(raw);
  if (!authority || authority.includes('@') || authority.includes(':') || authority.includes('%')) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  if (authority.toLowerCase() !== parsed.hostname.toLowerCase()) return null;

  const videoId = getYouTubeVideoId(parsed);
  if (!youtubeVideoIdPattern.test(videoId) || videoId === 'live_stream') return null;

  return {
    provider: 'youtube',
    videoId,
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
    publicUrl: `https://www.youtube.com/watch?v=${videoId}`
  };
}

export function normalizeStoredYouTubeReplay(value: unknown): YouTubeReplayVideo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const replay = value as Record<string, unknown>;
  if (replay.provider !== 'youtube' || (replay.status !== undefined && replay.status !== 'ready')) return null;

  const candidateIds: string[] = [];
  const hasOwn = (field: string) => Object.prototype.hasOwnProperty.call(replay, field);

  if (hasOwn('videoId')) {
    const videoId = typeof replay.videoId === 'string' ? replay.videoId.trim() : '';
    if (!youtubeVideoIdPattern.test(videoId) || videoId === 'live_stream') return null;
    candidateIds.push(videoId);
  }

  for (const field of ['embedUrl', 'publicUrl'] as const) {
    if (!hasOwn(field)) continue;
    const normalizedCandidate = normalizeYouTubeReplayUrl(replay[field]);
    if (!normalizedCandidate) return null;
    candidateIds.push(normalizedCandidate.videoId);
  }

  if (!candidateIds.length || new Set(candidateIds).size !== 1) return null;
  const normalized = normalizeYouTubeReplayUrl(`https://www.youtube.com/watch?v=${candidateIds[0]}`);
  if (!normalized) return null;

  const title = typeof replay.title === 'string' ? replay.title.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  const linkedBy = typeof replay.linkedBy === 'string' ? replay.linkedBy.trim() : '';

  return {
    ...normalized,
    status: 'ready',
    ...(title ? { title } : {}),
    ...(linkedBy ? { linkedBy } : {}),
    ...(replay.linkedAt !== undefined && replay.linkedAt !== null ? { linkedAt: replay.linkedAt } : {})
  };
}

export function isCompletedGameForReplay(game: {
  status?: unknown;
  liveStatus?: unknown;
  type?: unknown;
  isDbGame?: unknown;
  rawReplayLifecycle?: unknown;
  isCancelled?: unknown;
  deleted?: unknown;
  isDeleted?: unknown;
} | null | undefined) {
  if (game?.isCancelled === true || game?.deleted === true || game?.isDeleted === true) return false;
  const rawLifecycle = replayRecord(game?.rawReplayLifecycle);
  if (game?.isDbGame === true && !rawLifecycle) return false;
  const type = rawLifecycle && Object.prototype.hasOwnProperty.call(rawLifecycle, 'type')
    ? rawLifecycle.type
    : rawLifecycle ? undefined : game?.type;
  if (type !== undefined && type !== 'game') return false;
  const status = rawLifecycle && Object.prototype.hasOwnProperty.call(rawLifecycle, 'status')
    ? rawLifecycle.status
    : rawLifecycle ? undefined : game?.status;
  const liveStatus = rawLifecycle && Object.prototype.hasOwnProperty.call(rawLifecycle, 'liveStatus')
    ? rawLifecycle.liveStatus
    : rawLifecycle ? undefined : game?.liveStatus;
  const isFinalStatus = status === 'completed' || status === 'final';
  const isFinalLiveStatus = liveStatus === 'completed' || liveStatus === 'final';
  const isEmptyStatus = status === null || status === undefined || status === '';
  const isEmptyLiveStatus = liveStatus === null || liveStatus === undefined || liveStatus === '';
  return (isFinalStatus && (isEmptyLiveStatus || isFinalLiveStatus || liveStatus === 'scheduled'))
    || (isEmptyStatus && isFinalLiveStatus);
}

export function isActiveGameForLive(game: {
  status?: unknown;
  liveStatus?: unknown;
  type?: unknown;
  isDbGame?: unknown;
  rawReplayLifecycle?: unknown;
  isCancelled?: unknown;
  deleted?: unknown;
  isDeleted?: unknown;
} | null | undefined) {
  if (game?.isCancelled === true || game?.deleted === true || game?.isDeleted === true) return false;
  const rawLifecycle = replayRecord(game?.rawReplayLifecycle);
  if (game?.isDbGame === true && !rawLifecycle) return false;
  const type = rawLifecycle && Object.prototype.hasOwnProperty.call(rawLifecycle, 'type')
    ? rawLifecycle.type
    : rawLifecycle ? undefined : game?.type;
  if (type !== undefined && type !== 'game') return false;
  const status = rawLifecycle && Object.prototype.hasOwnProperty.call(rawLifecycle, 'status')
    ? rawLifecycle.status
    : rawLifecycle ? undefined : game?.status;
  const liveStatus = rawLifecycle && Object.prototype.hasOwnProperty.call(rawLifecycle, 'liveStatus')
    ? rawLifecycle.liveStatus
    : rawLifecycle ? undefined : game?.liveStatus;
  const statuses = [status, liveStatus]
    .map((value) => {
      if (value === null || value === undefined || value === '') return '';
      return typeof value === 'string' ? value : '__invalid__';
    })
    .filter(Boolean);
  const activeStatuses = new Set(['live', 'in_progress', 'in-progress']);
  const compatibleStatuses = new Set(['scheduled', ...activeStatuses]);
  return statuses.some((status) => activeStatuses.has(status))
    && statuses.every((status) => compatibleStatuses.has(status));
}
