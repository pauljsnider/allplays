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
  'videoReplayStatus'
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
  'videoReplayStatus'
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
  return Object.keys(getReplayArchiveState(value)).length > 0;
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
    const videoId = url.searchParams.get('v') || '';
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

export function isCompletedGameForReplay(game: { status?: unknown; liveStatus?: unknown } | null | undefined) {
  const status = game?.status;
  const liveStatus = game?.liveStatus;
  const isFinalStatus = status === 'completed' || status === 'final';
  const isFinalLiveStatus = liveStatus === 'completed' || liveStatus === 'final';
  const isEmptyStatus = status === null || status === undefined || status === '';
  const isEmptyLiveStatus = liveStatus === null || liveStatus === undefined || liveStatus === '';
  return (isFinalStatus && (isEmptyLiveStatus || isFinalLiveStatus || liveStatus === 'scheduled'))
    || (isEmptyStatus && isFinalLiveStatus);
}
