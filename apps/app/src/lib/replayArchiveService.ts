import { functions, httpsCallable } from './adapters/legacyParentTools';
import { getParentHomeSecondaryCacheKey, getParentScheduleSummaryCacheKey, invalidateCachedAppData } from './appDataCache';
import { callNativeFirebaseFunction } from './nativeCallable';
import { isNativeRuntime } from './nativeRuntime';
import { normalizeStoredYouTubeReplay, normalizeYouTubeReplayUrl, type YouTubeReplayVideo } from './youtubeReplay';

export type ReplayArchiveStateMarker = 'none' | 'ready' | 'removed';

export type SafeReplayArchiveState = {
  state: ReplayArchiveStateMarker;
  hasRecordedReplay: boolean;
  hasReplayVideo: boolean;
  replayArchiveRevision: string | null;
};

export type ManagedReplayArchiveState = SafeReplayArchiveState & {
  replayVideo: YouTubeReplayVideo | null;
  lastMutationId: string | null;
};

export type ReplayPlaybackResult = SafeReplayArchiveState & {
  available: boolean;
  replayVideo: YouTubeReplayVideo | null;
};

type ReplayMutationOptions = {
  expectedRevision?: string | null;
  mutationId?: string;
  title?: string;
  userId?: string;
};

type CallableResponse = Record<string, unknown>;

const definitiveCallableCodes = new Set([
  'aborted',
  'already-exists',
  'failed-precondition',
  'invalid-argument',
  'not-found',
  'out-of-range',
  'permission-denied',
  'resource-exhausted',
  'unauthenticated',
  'unimplemented'
]);

function compactString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function requireIdentifier(value: unknown, label: string) {
  const normalized = compactString(value);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizeRevision(value: unknown) {
  const revision = compactString(value);
  return revision || null;
}

function normalizeState(value: unknown, hasRecordedReplay: boolean): ReplayArchiveStateMarker {
  const state = compactString(value).toLowerCase();
  if (state === 'ready') return 'ready';
  if (state === 'removed' || state === 'deleted' || state === 'tombstoned') return 'removed';
  if (!state || state === 'none' || state === 'missing') return hasRecordedReplay ? 'ready' : 'none';
  throw new Error('Replay service response is invalid.');
}

function parseSafeState(value: unknown): SafeReplayArchiveState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Replay service response is invalid.');
  }
  const response = value as CallableResponse;
  const hasRecordedReplay = response.hasRecordedReplay === true || response.hasReplayVideo === true;
  const state = normalizeState(response.state, hasRecordedReplay);
  const replayArchiveRevision = normalizeRevision(response.replayArchiveRevision);
  if ((state === 'ready') !== hasRecordedReplay) {
    throw new Error('Replay service response is invalid.');
  }
  if ((state === 'none') !== (replayArchiveRevision === null)) {
    throw new Error('Replay service response is invalid.');
  }
  return {
    state,
    hasRecordedReplay,
    hasReplayVideo: hasRecordedReplay,
    replayArchiveRevision
  };
}

function parseReplayVideo(value: unknown) {
  if (value === null || value === undefined) return null;
  const replayVideo = normalizeStoredYouTubeReplay(value);
  if (!replayVideo) throw new Error('Replay service returned an invalid video.');
  // The server may retain principal and timestamp provenance privately. Never
  // carry those fields into app state even if an older callable returns them.
  const { provider, videoId, embedUrl, publicUrl, status, title } = replayVideo;
  return {
    provider,
    videoId,
    embedUrl,
    publicUrl,
    status,
    ...(title ? { title } : {})
  } satisfies YouTubeReplayVideo;
}

function parseManagementResponse(value: unknown): ManagedReplayArchiveState {
  const safe = parseSafeState(value);
  const response = value as CallableResponse;
  const replayVideo = parseReplayVideo(response.replayVideo);
  if ((safe.state === 'ready') !== Boolean(replayVideo)) {
    throw new Error('Replay service response is invalid.');
  }
  return {
    ...safe,
    replayVideo,
    lastMutationId: normalizeRevision(response.lastMutationId)
  };
}

async function callReplayFunction<T>(
  functionName: 'manageGameReplayArchive' | 'getGameReplayPlayback',
  input: Record<string, unknown>,
  errorLabel: string
): Promise<T> {
  if (isNativeRuntime()) {
    return callNativeFirebaseFunction<T>(functionName, input, { errorLabel });
  }
  const response = await httpsCallable(functions, functionName)(input);
  return response?.data as T;
}

function getCallableErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return '';
  const code = compactString((error as { code?: unknown }).code).toLowerCase();
  return code.startsWith('functions/') ? code.slice('functions/'.length) : code;
}

function isAmbiguousCallableError(error: unknown) {
  const code = getCallableErrorCode(error);
  return !code || !definitiveCallableCodes.has(code);
}

function unconfirmedMutationError(cause: unknown) {
  const error = new Error('The replay update could not be confirmed. Refresh this game before trying again.') as Error & {
    code: 'replay-mutation-unconfirmed';
    cause?: unknown;
  };
  error.code = 'replay-mutation-unconfirmed';
  error.cause = cause;
  return error;
}

export function isReplayMutationUnconfirmedError(error: unknown) {
  return Boolean(error && typeof error === 'object'
    && (error as { code?: unknown }).code === 'replay-mutation-unconfirmed');
}

function invalidateReplayScheduleCaches(userId: unknown, teamId: string, gameId: string) {
  const normalizedUserId = compactString(userId);
  if (normalizedUserId) {
    invalidateCachedAppData(getParentScheduleSummaryCacheKey(normalizedUserId));
    invalidateCachedAppData(getParentHomeSecondaryCacheKey(normalizedUserId));
  }
  invalidateCachedAppData(`event-details:${teamId}:${gameId}`);
}

export function createReplayMutationId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new Error('Secure randomness is unavailable. Replay changes cannot be saved on this device.');
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function readGameReplayArchiveForApp(teamId: string, gameId: string) {
  const normalizedTeamId = requireIdentifier(teamId, 'Team');
  const normalizedGameId = requireIdentifier(gameId, 'Game');
  const response = await callReplayFunction<unknown>(
    'manageGameReplayArchive',
    {
      action: 'read',
      teamId: normalizedTeamId,
      gameId: normalizedGameId
    },
    'Game replay'
  );
  return parseManagementResponse(response);
}

async function mutateReplayArchive(request: Record<string, unknown>, mutationId: string, expectedVideoId: string | null) {
  const execute = async () =>
    parseManagementResponse(await callReplayFunction<unknown>('manageGameReplayArchive', request, 'Game replay update'));

  try {
    return await execute();
  } catch (firstError) {
    if (!isAmbiguousCallableError(firstError)) throw firstError;
    let reconciliationCause: unknown = firstError;
    try {
      // The request is replayed byte-for-byte with the same durable mutation ID.
      await execute();
    } catch (retryError) {
      reconciliationCause = retryError;
    }
    try {
      const current = await readGameReplayArchiveForApp(String(request.teamId || ''), String(request.gameId || ''));
      const desiredStateMatches = expectedVideoId
        ? current.hasRecordedReplay && current.replayVideo?.videoId === expectedVideoId
        : !current.hasRecordedReplay && current.state === 'removed';
      if (current.lastMutationId === mutationId && desiredStateMatches) return current;
    } catch {
      // Preserve the mutation uncertainty instead of treating a failed read as
      // evidence that the first request did not commit.
    }
    throw unconfirmedMutationError(reconciliationCause);
  }
}

export async function linkGameYouTubeReplayForApp(teamId: string, gameId: string, youtubeUrl: string, options: ReplayMutationOptions = {}) {
  const normalizedTeamId = requireIdentifier(teamId, 'Team');
  const normalizedGameId = requireIdentifier(gameId, 'Game');
  const replay = normalizeYouTubeReplayUrl(youtubeUrl);
  if (!replay) {
    throw new Error('Paste a complete YouTube video link. Channel and live-feed links cannot be used as a game replay.');
  }
  const mutationId = compactString(options.mutationId) || createReplayMutationId();
  const title = compactString(options.title).replace(/\s+/g, ' ').slice(0, 120);
  const request = {
    action: 'set',
    teamId: normalizedTeamId,
    gameId: normalizedGameId,
    expectedRevision: normalizeRevision(options.expectedRevision),
    mutationId,
    youtubeUrl: replay.publicUrl,
    ...(title ? { title } : {})
  };
  const result = await mutateReplayArchive(request, mutationId, replay.videoId);
  if (!result.replayVideo || result.replayVideo.videoId !== replay.videoId) {
    throw new Error('Replay service returned an invalid video.');
  }
  invalidateReplayScheduleCaches(options.userId, normalizedTeamId, normalizedGameId);
  return result;
}

export async function removeGameReplayForApp(teamId: string, gameId: string, options: ReplayMutationOptions = {}) {
  const normalizedTeamId = requireIdentifier(teamId, 'Team');
  const normalizedGameId = requireIdentifier(gameId, 'Game');
  const mutationId = compactString(options.mutationId) || createReplayMutationId();
  const request = {
    action: 'remove',
    teamId: normalizedTeamId,
    gameId: normalizedGameId,
    expectedRevision: normalizeRevision(options.expectedRevision),
    mutationId
  };
  const result = await mutateReplayArchive(request, mutationId, null);
  if (result.state !== 'removed' || result.hasRecordedReplay || result.replayVideo) {
    throw new Error('Replay service response is invalid.');
  }
  invalidateReplayScheduleCaches(options.userId, normalizedTeamId, normalizedGameId);
  return result;
}

export async function getGameReplayPlaybackForApp(teamId: string, gameId: string, seasonId?: string | null): Promise<ReplayPlaybackResult> {
  const normalizedTeamId = requireIdentifier(teamId, 'Team');
  const normalizedGameId = requireIdentifier(gameId, 'Game');
  const normalizedSeasonId = compactString(seasonId);
  const response = await callReplayFunction<unknown>(
    'getGameReplayPlayback',
    {
      teamId: normalizedTeamId,
      gameId: normalizedGameId,
      ...(normalizedSeasonId ? { seasonId: normalizedSeasonId } : {})
    },
    'Game replay playback'
  );
  const safe = parseSafeState(response);
  const payload = response as CallableResponse;
  const replayVideo = parseReplayVideo(payload.replayVideo);
  const available = payload.available === true;
  if ((available && (!safe.hasRecordedReplay || !replayVideo)) || (!available && replayVideo)) {
    throw new Error('Replay playback response is invalid.');
  }
  return { ...safe, available, replayVideo };
}

export function toSafeReplayArchiveState(
  value: Pick<ManagedReplayArchiveState, 'state' | 'hasRecordedReplay' | 'hasReplayVideo' | 'replayArchiveRevision'>
): SafeReplayArchiveState {
  return {
    state: value.state,
    hasRecordedReplay: value.hasRecordedReplay,
    hasReplayVideo: value.hasReplayVideo,
    replayArchiveRevision: value.replayArchiveRevision
  };
}
