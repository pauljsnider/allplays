'use strict';

const crypto = require('node:crypto');

const REPLAY_PRIVATE_SCHEMA_VERSION = 1;
const REPLAY_PRIVATE_COLLECTION = 'privateReplay';
const REPLAY_PRIVATE_DOCUMENT = 'archive';
const REPLAY_COMPATIBILITY_DOCUMENT = 'compatibility';
const REPLAY_COMPATIBILITY_SCHEMA = 'replay-legacy-compatibility-mutation';
const REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH = 'systemControls/replayPrivateArchiveMigration';
const REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA = 'replay-private-archive-migration';
const REPLAY_PROTECTED_IDENTITY_COLLECTION = 'replayProtectedIdentities';
const REPLAY_PROTECTED_IDENTITY_SCHEMA = 'replay-protected-identity';
const REPLAY_CLIP_IDENTITY_COLLECTION = 'replayClipIdentities';
const REPLAY_CLIP_IDENTITY_SCHEMA = 'replay-clip-identity';
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const YOUTUBE_NOCOOKIE_HOSTS = new Set(['youtube-nocookie.com', 'www.youtube-nocookie.com']);
const MAX_PROTECTED_REPLAY_VIDEO_IDS = 256;
const MAX_HIGHLIGHT_PROTECTED_URL_LOOKUPS = 128;
const READY_REPLAY_STATUSES = new Set([
  'ready',
  'available',
  'complete',
  'completed',
  'archived',
  'published'
]);
const BLOCKED_REPLAY_STATUSES = new Set([
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

const REPLAY_CLIP_COLLECTION_FIELDS = Object.freeze([
  'clipRecords',
  'gameClips',
  'videoClips',
  'clips',
  'mediaClips',
  'highlightClips',
  'clipMetadata',
  'replayHighlights'
]);

const REPLAY_READABLE_FIELDS = Object.freeze([
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
]);

const SHARED_GAME_FIELDS = Object.freeze([
  'sharedGameId',
  'sharedGamePath',
  '_sharedGamePath',
  'sharedScheduleId',
  'sharedScheduleSourceTeamId',
  'sharedScheduleOpponentTeamId',
  'sharedScheduleOpponentGameId'
]);

const REPLAY_COMPATIBILITY_FINGERPRINT_FIELDS = Object.freeze([
  ...REPLAY_READABLE_FIELDS,
  'hasRecordedReplay',
  'replayArchiveRevision',
  'type',
  'status',
  'liveStatus',
  'isCancelled',
  'deleted',
  'isDeleted',
  'isSharedGame',
  'isPublicProjection',
  ...SHARED_GAME_FIELDS
]);

function compactText(value, maxLength = 256) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeReplayResourceId(value, fieldName = 'id') {
  if (typeof value !== 'string'
    || value !== value.trim()
    || !value
    || value.length > 128
    || value.includes('/')) {
    const error = new Error(`${fieldName} is invalid.`);
    error.code = 'invalid-argument';
    throw error;
  }
  return value;
}

function normalizeReplayRevision(value, { required = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (!required) return null;
    const error = new Error('expectedRevision is required.');
    error.code = 'invalid-argument';
    throw error;
  }
  if (typeof value !== 'string'
    || value !== value.trim()
    || value.length > 128
    || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    const error = new Error('expectedRevision is invalid.');
    error.code = 'invalid-argument';
    throw error;
  }
  return value;
}

function normalizeReplayArchiveMigrationControl(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schema !== REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA
    || value.version !== REPLAY_PRIVATE_SCHEMA_VERSION
    || !['migrating', 'ready'].includes(value.status)) return null;
  const attemptId = compactText(value.attemptId, 128);
  if (!attemptId || attemptId !== value.attemptId) return null;
  return {
    schema: REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
    status: value.status,
    version: REPLAY_PRIVATE_SCHEMA_VERSION,
    attemptId
  };
}

function isReplayArchiveMigrationReady(value) {
  return normalizeReplayArchiveMigrationControl(value)?.status === 'ready';
}

function getReplayIdentityHash(kind, value) {
  if (kind === 'youtube') {
    if (!isValidYouTubeVideoId(value)) {
      throw new TypeError('A valid YouTube identity is required.');
    }
  } else if (kind === 'url') {
    if (typeof value !== 'string' || !value || value !== value.trim()) {
      throw new TypeError('A valid exact replay URL is required.');
    }
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new TypeError('A valid exact replay URL is required.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new TypeError('A valid exact replay URL is required.');
    }
  } else {
    throw new TypeError('A valid replay identity kind is required.');
  }
  return crypto.createHash('sha256')
    .update(`allplays:replay-identity:v1:${kind}\0${value}`)
    .digest('hex');
}

function getReplayUrlIdentityCandidates(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const exactValue = value.trim();
  let parsed;
  try {
    parsed = new URL(exactValue);
  } catch {
    return [];
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return [];
  const canonicalValue = parsed.href;
  parsed.hash = '';
  // Fragments are never sent to the origin, so fragment aliases identify the
  // same bearer capability. Keep raw and canonical candidates as well for
  // historical byte-exact and URL-normalized records.
  return [...new Set([exactValue, canonicalValue, parsed.href])];
}

function buildReplayIdentityRecord(collection, schema, kind, value) {
  const identityHash = getReplayIdentityHash(kind, value);
  return {
    path: `${collection}/${kind}:${identityHash}`,
    data: {
      schema,
      version: REPLAY_PRIVATE_SCHEMA_VERSION,
      kind,
      identityHash
    }
  };
}

function getReplayProtectedYouTubeIdentityRecord(videoId) {
  return buildReplayIdentityRecord(
    REPLAY_PROTECTED_IDENTITY_COLLECTION,
    REPLAY_PROTECTED_IDENTITY_SCHEMA,
    'youtube',
    videoId
  );
}

function getReplayProtectedYouTubeIdentityRecordFromHash(identityHash) {
  if (typeof identityHash !== 'string' || !/^[a-f0-9]{64}$/.test(identityHash)) {
    throw new TypeError('A valid protected replay identity hash is required.');
  }
  return {
    path: `${REPLAY_PROTECTED_IDENTITY_COLLECTION}/youtube:${identityHash}`,
    data: {
      schema: REPLAY_PROTECTED_IDENTITY_SCHEMA,
      version: REPLAY_PRIVATE_SCHEMA_VERSION,
      kind: 'youtube',
      identityHash
    }
  };
}

function getReplayClipYouTubeIdentityRecord(videoId) {
  return buildReplayIdentityRecord(
    REPLAY_CLIP_IDENTITY_COLLECTION,
    REPLAY_CLIP_IDENTITY_SCHEMA,
    'youtube',
    videoId
  );
}

function normalizeReplayClipIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== REPLAY_CLIP_IDENTITY_SCHEMA
    || value.version !== REPLAY_PRIVATE_SCHEMA_VERSION
    || value.kind !== 'youtube'
    || !/^[a-f0-9]{64}$/.test(value.identityHash || '')
    || Object.prototype.hasOwnProperty.call(value, 'videoId')
    || Object.prototype.hasOwnProperty.call(value, 'exactUrl')) return null;
  return { kind: 'youtube', identityHash: value.identityHash };
}

function getReplayProtectedUrlIdentityRecord(exactUrl) {
  return buildReplayIdentityRecord(
    REPLAY_PROTECTED_IDENTITY_COLLECTION,
    REPLAY_PROTECTED_IDENTITY_SCHEMA,
    'url',
    exactUrl
  );
}

function normalizeReplayProtectedIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== REPLAY_PROTECTED_IDENTITY_SCHEMA
    || value.version !== REPLAY_PRIVATE_SCHEMA_VERSION
    || !['youtube', 'url'].includes(value.kind)
    || !/^[a-f0-9]{64}$/.test(value.identityHash || '')
    || Object.prototype.hasOwnProperty.call(value, 'videoId')
    || Object.prototype.hasOwnProperty.call(value, 'exactUrl')) return null;
  return { kind: value.kind, identityHash: value.identityHash };
}

function extractPathVideoId(pathname, allowedPrefixes) {
  const match = pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
  return match && allowedPrefixes.has(match[1]) ? match[2] : null;
}

function isValidYouTubeVideoId(value) {
  return YOUTUBE_VIDEO_ID_PATTERN.test(value) && value !== 'live_stream';
}

function hashReplayVideoId(value) {
  if (!isValidYouTubeVideoId(value)) return null;
  return crypto.createHash('sha256').update(`youtube:${value}`).digest('hex');
}

function normalizeProtectedReplayVideoIdHashes(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PROTECTED_REPLAY_VIDEO_IDS) return null;
  const normalized = value.map((entry) => compactText(entry, 64).toLowerCase());
  if (normalized.some((entry) => !/^[a-f0-9]{64}$/.test(entry))) return null;
  return [...new Set(normalized)];
}

function getProtectedReplayVideoIdHashes(archive = null) {
  const normalized = normalizeStoredReplayArchive(archive);
  if (!normalized) return new Set();
  const hashes = new Set(normalized.protectedVideoIdHashes || []);
  const currentHash = hashReplayVideoId(normalized.videoId);
  if (currentHash) hashes.add(currentHash);
  return hashes;
}

function mergeProtectedReplayVideoIdHashes(archive, nextVideoId = null) {
  const hashes = getProtectedReplayVideoIdHashes(archive);
  const nextHash = hashReplayVideoId(nextVideoId);
  if (nextHash) hashes.add(nextHash);
  if (hashes.size > MAX_PROTECTED_REPLAY_VIDEO_IDS) {
    const error = new Error('This replay archive has reached its protected video history limit.');
    error.code = 'resource-exhausted';
    throw error;
  }
  return [...hashes].sort();
}

function extractYouTubeVideoIdForProtection(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null;
  const raw = value.trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;

  const host = parsed.hostname.toLowerCase();
  let videoId = null;
  if (host === 'youtu.be') {
    videoId = parsed.pathname.match(/^\/([^/]+)\/?$/)?.[1] || null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (/^\/watch\/?$/.test(parsed.pathname)) {
      const values = parsed.searchParams.getAll('v');
      videoId = values.length === 1 ? values[0] : null;
    } else {
      videoId = extractPathVideoId(parsed.pathname, new Set(['embed', 'live', 'shorts']));
    }
  } else if (YOUTUBE_NOCOOKIE_HOSTS.has(host)) {
    videoId = extractPathVideoId(parsed.pathname, new Set(['embed']));
  }
  return isValidYouTubeVideoId(videoId || '') ? videoId : null;
}

function normalizeYouTubeReplayUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null;
  const raw = value.trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const rawAuthority = raw.match(/^https:\/\/([^/?#]+)/i)?.[1] || '';
  if (parsed.protocol !== 'https:'
    || rawAuthority.toLowerCase() !== parsed.hostname.toLowerCase()
    || parsed.username
    || parsed.password
    || parsed.port) return null;
  const videoId = extractYouTubeVideoIdForProtection(raw);
  if (!videoId) return null;
  return {
    provider: 'youtube',
    videoId,
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
    publicUrl: `https://www.youtube.com/watch?v=${videoId}`
  };
}

function hasReadableReplayValue(value) {
  if (value === null || value === undefined) return false;
  return typeof value !== 'string' || Boolean(value.trim());
}

function getReadableReplayArchiveState(game = {}) {
  if (!game || typeof game !== 'object' || Array.isArray(game)) return {};
  return Object.fromEntries(REPLAY_READABLE_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(game, field)
      && hasReadableReplayValue(game[field]))
    .map((field) => [field, game[field]]));
}

function normalizeLegacyReplayAvailabilityStatus(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return 'invalid';
  const normalized = value.trim().toLowerCase().replace(/[_\s-]+/g, '-');
  if (!normalized) return null;
  if (READY_REPLAY_STATUSES.has(normalized)) return 'ready';
  if (BLOCKED_REPLAY_STATUSES.has(normalized)) return 'blocked';
  return 'invalid';
}

function getLegacyReplayAvailabilityBoundary(game = {}) {
  const replayObjects = ['replayVideo', 'recordedVideo', 'videoReplay']
    .map((field) => game?.[field])
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value));
  const statuses = [
    game?.replayStatus,
    game?.recordedReplayStatus,
    game?.videoReplayStatus,
    ...replayObjects.flatMap((value) => [value.status, value.processingStatus])
  ]
    .map(normalizeLegacyReplayAvailabilityStatus)
    .filter(Boolean);
  if (statuses.includes('invalid')) return 'invalid';
  if (statuses.includes('blocked')) return 'blocked';
  return 'safe';
}

function inspectLegacyReplayArchive(game = {}) {
  const rawState = getReadableReplayArchiveState(game);
  const evidenceFields = Object.keys(rawState);
  const fallbackDisabled = rawState.replayVideoFallbackDisabled === true;
  const candidates = [];
  let invalidReason = '';
  let title = compactText(rawState.replayVideoTitle, 120);
  let linkedBy = '';

  const addCandidate = (value, field) => {
    const candidate = normalizeYouTubeReplayUrl(value);
    if (!candidate) {
      invalidReason ||= `invalid-${field}`;
      return;
    }
    candidates.push({ ...candidate, field });
  };

  for (const field of ['replayVideo', 'recordedVideo', 'videoReplay']) {
    const value = rawState[field];
    if (value === undefined) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      invalidReason ||= `invalid-${field}`;
      continue;
    }
    const provider = compactText(value.provider, 32).toLowerCase();
    if (provider && provider !== 'youtube') invalidReason ||= `unsupported-${field}-provider`;
    const identityValues = [];
    if (hasReadableReplayValue(value.videoId)) {
      identityValues.push([`https://youtu.be/${compactText(value.videoId, 64)}`, `${field}.videoId`]);
    }
    for (const property of ['publicUrl', 'embedUrl', 'url', 'src']) {
      if (hasReadableReplayValue(value[property])) identityValues.push([value[property], `${field}.${property}`]);
    }
    if (!identityValues.length) {
      invalidReason ||= `missing-${field}-identity`;
    } else {
      identityValues.forEach(([identity, identityField]) => addCandidate(identity, identityField));
    }
    title ||= compactText(value.title, 120);
    linkedBy ||= compactText(value.linkedBy, 128);
  }

  for (const field of [
    'replayVideoUrl',
    'recordedVideoUrl',
    'videoReplayUrl',
    'archivedVideoUrl',
    'replayVideoPublicUrl'
  ]) {
    if (hasReadableReplayValue(rawState[field])) addCandidate(rawState[field], field);
  }
  if (hasReadableReplayValue(rawState.videoUrl) && getExactReplayLifecycle(game).isCompleted) {
    addCandidate(rawState.videoUrl, 'videoUrl');
  }

  const distinctVideoIds = new Set(candidates.map((candidate) => candidate.videoId));
  const availabilityBoundary = getLegacyReplayAvailabilityBoundary(game);
  const identityEvidence = candidates.length > 0 || evidenceFields.some((field) => ![
    'replayVideoFallbackDisabled',
    'replayVideoPosterUrl',
    'replayVideoTitle',
    'replayVideoDurationMs',
    'replayStatus',
    'recordedReplayStatus',
    'videoReplayStatus',
    ...(!getExactReplayLifecycle(game).isCompleted ? ['videoUrl'] : [])
  ].includes(field));
  if (fallbackDisabled && identityEvidence) invalidReason ||= 'removed-with-identity';
  if (distinctVideoIds.size > 1) invalidReason ||= 'conflicting-video-identities';
  if (availabilityBoundary !== 'safe') {
    invalidReason ||= `${availabilityBoundary}-replay-availability`;
  }
  if (invalidReason) {
    return { state: 'quarantine', reason: invalidReason, evidenceFields, rawState };
  }
  if (fallbackDisabled) return { state: 'removed', evidenceFields, rawState };
  if (candidates.length) {
    const replay = candidates[0];
    return {
      state: 'ready',
      evidenceFields,
      rawState,
      replay: {
        provider: 'youtube',
        videoId: replay.videoId,
        embedUrl: replay.embedUrl,
        publicUrl: replay.publicUrl,
        ...(title ? { title } : {}),
        ...(linkedBy ? { linkedBy } : {})
      }
    };
  }
  const replayEvidenceFields = evidenceFields.filter((field) => (
    field !== 'videoUrl' || getExactReplayLifecycle(game).isCompleted
  ));
  return replayEvidenceFields.length
    ? { state: 'quarantine', reason: 'unrecognized-replay-evidence', evidenceFields, rawState }
    : { state: 'none', evidenceFields: [], rawState: {} };
}

function getPrivateReplayArchivePath(teamId, gameId) {
  return `teams/${normalizeReplayResourceId(teamId, 'teamId')}/games/${normalizeReplayResourceId(gameId, 'gameId')}/${REPLAY_PRIVATE_COLLECTION}/${REPLAY_PRIVATE_DOCUMENT}`;
}

function getReplayArchiveChildPath(parentDocumentPath) {
  if (typeof parentDocumentPath !== 'string'
    || parentDocumentPath !== parentDocumentPath.trim()
    || !parentDocumentPath
    || parentDocumentPath.startsWith('/')
    || parentDocumentPath.endsWith('/')) {
    throw new TypeError('A valid parent document path is required.');
  }
  const segments = parentDocumentPath.split('/');
  if (segments.length % 2 !== 0 || segments.some((segment) => !segment)) {
    throw new TypeError('A valid parent document path is required.');
  }
  return `${parentDocumentPath}/${REPLAY_PRIVATE_COLLECTION}/${REPLAY_PRIVATE_DOCUMENT}`;
}

function getReplayCompatibilityReceiptPath(parentDocumentPath) {
  if (typeof parentDocumentPath !== 'string'
    || parentDocumentPath !== parentDocumentPath.trim()
    || !parentDocumentPath
    || parentDocumentPath.startsWith('/')
    || parentDocumentPath.endsWith('/')) {
    throw new TypeError('A valid parent document path is required.');
  }
  const segments = parentDocumentPath.split('/');
  if (segments.length % 2 !== 0 || segments.some((segment) => !segment)) {
    throw new TypeError('A valid parent document path is required.');
  }
  return `${parentDocumentPath}/${REPLAY_PRIVATE_COLLECTION}/${REPLAY_COMPATIBILITY_DOCUMENT}`;
}

function stableReplayCompatibilityValue(value, state = { nodes: 0, stringBytes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > 2_000 || depth > 20) {
    const error = new Error('Legacy replay state is too complex.');
    error.code = 'failed-precondition';
    throw error;
  }
  if (value === null) return ['null'];
  if (typeof value === 'string') {
    state.stringBytes += Buffer.byteLength(value, 'utf8');
    if (state.stringBytes > 128 * 1_024) {
      const error = new Error('Legacy replay state is too large.');
      error.code = 'failed-precondition';
      throw error;
    }
    return ['string', value];
  }
  if (typeof value === 'boolean') return ['boolean', value];
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return ['number', 'NaN'];
    if (value === Infinity) return ['number', 'Infinity'];
    if (value === -Infinity) return ['number', '-Infinity'];
    if (Object.is(value, -0)) return ['number', '-0'];
    return ['number', value];
  }
  if (value instanceof Date) return ['date', value.toISOString()];
  const timestampPrototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
  if (value
    && timestampPrototype !== Object.prototype
    && timestampPrototype !== null
    && typeof value.toMillis === 'function'
    && Number.isInteger(value.seconds)
    && Number.isInteger(value.nanoseconds)
    && value.nanoseconds >= 0 && value.nanoseconds < 1_000_000_000) {
    return ['timestamp', value.seconds, value.nanoseconds];
  }
  if (value && typeof value.toMillis === 'function') {
    const milliseconds = value.toMillis();
    if (!Number.isFinite(milliseconds)) {
      const error = new Error('Legacy replay state contains an invalid timestamp.');
      error.code = 'failed-precondition';
      throw error;
    }
    return ['timestamp', milliseconds];
  }
  if (Array.isArray(value)) {
    return ['array', value.map((entry) => stableReplayCompatibilityValue(entry, state, depth + 1))];
  }
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
  if (value && typeof value === 'object' && (prototype === Object.prototype || prototype === null)) {
    return ['map', Object.keys(value).sort().map((key) => [
      key,
      stableReplayCompatibilityValue(value[key], state, depth + 1)
    ])];
  }
  const error = new Error('Legacy replay state contains an unsupported value.');
  error.code = 'failed-precondition';
  throw error;
}

function getReplayCompatibilityParentFingerprint(game = {}) {
  const selected = REPLAY_COMPATIBILITY_FINGERPRINT_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(game || {}, field))
    .map((field) => [field, stableReplayCompatibilityValue(game[field])]);
  return crypto.createHash('sha256')
    .update(JSON.stringify(selected))
    .digest('hex');
}

function getLegacyReplayCompatibilityRevision(game = {}) {
  return `legacy:${getReplayCompatibilityParentFingerprint(game)}`;
}

function normalizeReplayCompatibilityIdentityHashes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PROTECTED_REPLAY_VIDEO_IDS) return null;
  const hashes = value.map((entry) => compactText(entry, 65).toLowerCase());
  if (hashes.some((entry) => !/^[a-f0-9]{64}$/.test(entry))) return null;
  return [...new Set(hashes)].sort();
}

function normalizeReplayCompatibilityReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== REPLAY_COMPATIBILITY_SCHEMA
    || value.version !== REPLAY_PRIVATE_SCHEMA_VERSION
    || !['ready', 'removed'].includes(value.state)
    || !/^[a-f0-9]{64}$/.test(value.beforeStateHash || '')
    || !/^[a-f0-9]{64}$/.test(value.afterStateHash || '')
    || !/^[a-f0-9]{64}$/.test(value.lastMutationHash || '')) return null;
  let teamId;
  let gameId;
  let revision;
  try {
    teamId = normalizeReplayResourceId(value.teamId, 'teamId');
    gameId = normalizeReplayResourceId(value.gameId, 'gameId');
    revision = normalizeReplayRevision(value.revision, { required: true });
  } catch {
    return null;
  }
  const lastMutationId = compactText(value.lastMutationId, 129);
  const protectedIdentityHashes = normalizeReplayCompatibilityIdentityHashes(value.protectedIdentityHashes);
  if (!revision || !protectedIdentityHashes || !lastMutationId || lastMutationId !== value.lastMutationId
    || lastMutationId.length > 128 || lastMutationId.includes('/')) return null;
  const allowed = new Set([
    'schema', 'version', 'teamId', 'gameId', 'state', 'revision',
    'lastMutationId', 'lastMutationHash', 'beforeStateHash', 'afterStateHash',
    'protectedIdentityHashes', 'committedAt'
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  return {
    schema: REPLAY_COMPATIBILITY_SCHEMA,
    version: REPLAY_PRIVATE_SCHEMA_VERSION,
    teamId,
    gameId,
    state: value.state,
    revision,
    lastMutationId,
    lastMutationHash: value.lastMutationHash,
    beforeStateHash: value.beforeStateHash,
    afterStateHash: value.afterStateHash,
    protectedIdentityHashes
  };
}

function getReplayCompatibilityInspectionGame(game = {}) {
  const lifecycle = getCompatibleReplayLifecycle(game);
  if (!lifecycle.isCompleted || getExactReplayLifecycle(game).isCompleted) return game;
  return {
    ...game,
    ...(lifecycle.status ? { status: lifecycle.status } : { status: null }),
    ...(lifecycle.liveStatus ? { liveStatus: lifecycle.liveStatus } : { liveStatus: null })
  };
}

function getReplayCompatibilityState(game = {}, receipt = null, { teamId = '', gameId = '' } = {}) {
  const inspection = inspectLegacyReplayArchive(getReplayCompatibilityInspectionGame(game));
  const parentFingerprint = getReplayCompatibilityParentFingerprint(game);
  const normalizedReceipt = receipt ? normalizeReplayCompatibilityReceipt(receipt) : null;
  const receiptValid = !receipt || Boolean(normalizedReceipt
    && normalizedReceipt.teamId === teamId
    && normalizedReceipt.gameId === gameId);
  const receiptMatches = Boolean(receiptValid
    && normalizedReceipt
    && normalizedReceipt.afterStateHash === parentFingerprint
    && normalizedReceipt.state === inspection.state);
  if (inspection.state === 'none') {
    return {
      state: 'none',
      hasRecordedReplay: false,
      replayArchiveRevision: null,
      lastMutationId: null,
      parentFingerprint,
      receiptMatches: false,
      receiptValid,
      receipt: normalizedReceipt,
      inspection
    };
  }
  if (!['ready', 'removed'].includes(inspection.state)) {
    return {
      state: 'unavailable',
      hasRecordedReplay: false,
      replayArchiveRevision: null,
      lastMutationId: null,
      parentFingerprint,
      receiptMatches: false,
      receiptValid,
      receipt: normalizedReceipt,
      inspection
    };
  }
  const replayArchiveRevision = receiptMatches
    ? normalizedReceipt.revision
    : getLegacyReplayCompatibilityRevision(game);
  return {
    state: inspection.state,
    hasRecordedReplay: inspection.state === 'ready',
    replayArchiveRevision,
    lastMutationId: receiptMatches ? normalizedReceipt.lastMutationId : null,
    parentFingerprint,
    receiptMatches,
    receiptValid,
    receipt: normalizedReceipt,
    inspection,
    ...(inspection.state === 'ready'
      ? {
          replayVideo: {
            provider: 'youtube',
            videoId: inspection.replay.videoId,
            embedUrl: inspection.replay.embedUrl,
            publicUrl: inspection.replay.publicUrl,
            ...(inspection.replay.title ? { title: inspection.replay.title } : {}),
            status: 'ready'
          }
        }
      : {})
  };
}

function buildReplayCompatibilityParentUpdate({
  input,
  revision,
  deleteValue,
  timestamp,
  isCompleted = true
}) {
  if (!input || !['set', 'remove'].includes(input.action)) {
    throw new TypeError('A replay compatibility mutation is required.');
  }
  const update = {
    hasRecordedReplay: input.action === 'set',
    replayArchiveRevision: revision,
    updatedAt: timestamp
  };
  REPLAY_READABLE_FIELDS.forEach((field) => {
    if (field === 'videoUrl' && input.action === 'remove' && !isCompleted) return;
    update[field] = deleteValue;
  });
  if (input.action === 'set') {
    update.replayVideo = {
      provider: 'youtube',
      videoId: input.replay.videoId,
      embedUrl: input.replay.embedUrl,
      publicUrl: input.replay.publicUrl,
      status: 'ready',
      ...(input.title ? { title: input.title } : {})
    };
  } else {
    update.replayVideoFallbackDisabled = true;
  }
  return update;
}

function getReplayCompatibilityNextGame(game = {}, input = {}, revision = null) {
  const next = { ...(game || {}) };
  const isCompleted = getCompatibleReplayLifecycle(game).isCompleted;
  REPLAY_READABLE_FIELDS.forEach((field) => {
    if (field === 'videoUrl' && input.action === 'remove' && !isCompleted) return;
    delete next[field];
  });
  if (input.action === 'set') {
    next.replayVideo = {
      provider: 'youtube',
      videoId: input.replay.videoId,
      embedUrl: input.replay.embedUrl,
      publicUrl: input.replay.publicUrl,
      status: 'ready',
      ...(input.title ? { title: input.title } : {})
    };
  } else if (input.action === 'remove') {
    next.replayVideoFallbackDisabled = true;
  }
  next.hasRecordedReplay = input.action === 'set';
  next.replayArchiveRevision = revision;
  return next;
}

function buildReplayCompatibilityReceipt({
  input,
  revision,
  beforeStateHash,
  afterStateHash,
  protectedIdentityHashes,
  timestamp
}) {
  const hashes = normalizeReplayCompatibilityIdentityHashes(protectedIdentityHashes);
  if (!hashes
    || !/^[a-f0-9]{64}$/.test(beforeStateHash || '')
    || !/^[a-f0-9]{64}$/.test(afterStateHash || '')) {
    throw new TypeError('Replay compatibility receipt state is invalid.');
  }
  return {
    schema: REPLAY_COMPATIBILITY_SCHEMA,
    version: REPLAY_PRIVATE_SCHEMA_VERSION,
    teamId: input.teamId,
    gameId: input.gameId,
    state: input.action === 'set' ? 'ready' : 'removed',
    revision,
    lastMutationId: input.mutationId,
    lastMutationHash: getReplayMutationHash(input),
    beforeStateHash,
    afterStateHash,
    protectedIdentityHashes: hashes,
    committedAt: timestamp
  };
}

function normalizeStoredReplayArchive(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schemaVersion !== REPLAY_PRIVATE_SCHEMA_VERSION) return null;
  const state = compactText(value.state, 16).toLowerCase();
  const revision = normalizeReplayRevision(value.revision);
  const protectedVideoIdHashes = normalizeProtectedReplayVideoIdHashes(value.protectedVideoIdHashes);
  if (!protectedVideoIdHashes) return null;
  if (!revision || !['ready', 'removed'].includes(state)) return null;
  if (state === 'removed') {
    if (value.videoId || value.publicUrl || value.embedUrl || value.provider) return null;
    return {
      schemaVersion: REPLAY_PRIVATE_SCHEMA_VERSION,
      state,
      revision,
      protectedVideoIdHashes,
      lastMutationId: compactText(value.lastMutationId, 128) || null,
      lastMutationHash: compactText(value.lastMutationHash, 128) || null
    };
  }
  const provider = compactText(value.provider, 32).toLowerCase();
  const videoId = compactText(value.videoId, 32);
  if (provider !== 'youtube' || !isValidYouTubeVideoId(videoId)) return null;
  return {
    schemaVersion: REPLAY_PRIVATE_SCHEMA_VERSION,
    state,
    provider: 'youtube',
    videoId,
    protectedVideoIdHashes,
    ...(compactText(value.title, 120) ? { title: compactText(value.title, 120) } : {}),
    linkedBy: compactText(value.linkedBy, 128) || null,
    revision,
    lastMutationId: compactText(value.lastMutationId, 128) || null,
    lastMutationHash: compactText(value.lastMutationHash, 128) || null
  };
}

function hasSharedGameMarker(value) {
  return value !== null && value !== undefined && value !== '';
}

function isCanonicalReplayGame(gameId, game = {}) {
  if (typeof gameId !== 'string'
    || gameId.startsWith('shared_')
    || gameId.startsWith('sharedh_')
    || gameId.startsWith('shared::')
    || game?.isSharedGame === true
    || game?.isPublicProjection === true) return false;
  return !SHARED_GAME_FIELDS.some((field) => hasSharedGameMarker(game?.[field]));
}

function getExactReplayLifecycle(game = {}) {
  const readStatus = (value) => {
    if (value === null || value === undefined || value === '') return '';
    return typeof value === 'string' ? value : 'invalid';
  };
  const type = Object.prototype.hasOwnProperty.call(game || {}, 'type') ? game.type : undefined;
  const status = readStatus(game?.status);
  const liveStatus = readStatus(game?.liveStatus);
  const completed = new Set(['completed', 'final']);
  const hasTerminalFlag = game?.isCancelled === true || game?.deleted === true || game?.isDeleted === true;
  const isGame = type === undefined || type === 'game';
  const isCompleted = isGame && !hasTerminalFlag && status !== 'invalid' && liveStatus !== 'invalid'
    && ((completed.has(status) && (!liveStatus || completed.has(liveStatus) || liveStatus === 'scheduled'))
      || (!status && completed.has(liveStatus)));
  return { type, status, liveStatus, isCompleted };
}

// Historical public readers accepted these exact stored aliases before replay
// identity moved server-side. Keep that compatibility at the private playback
// boundary without broadening new client mutations, which still use the exact
// completed/final contract above.
function getCompatibleReplayLifecycle(game = {}) {
  const canonicalize = (value) => (
    value === 'complete' || value === 'finished' ? 'completed' : value
  );
  return getExactReplayLifecycle({
    ...game,
    ...(Object.prototype.hasOwnProperty.call(game || {}, 'status')
      ? { status: canonicalize(game.status) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(game || {}, 'liveStatus')
      ? { liveStatus: canonicalize(game.liveStatus) }
      : {})
  });
}

function canManageReplayArchive(access = {}) {
  return access.full === true
    || (access.videography === true && access?.modes?.videography === 'selected');
}

function normalizeReplayManagementInput(data = {}) {
  const action = compactText(data.action, 16).toLowerCase();
  if (!['read', 'set', 'remove'].includes(action)) {
    const error = new Error('action must be read, set, or remove.');
    error.code = 'invalid-argument';
    throw error;
  }
  const input = {
    action,
    teamId: normalizeReplayResourceId(data.teamId, 'teamId'),
    gameId: normalizeReplayResourceId(data.gameId, 'gameId')
  };
  if (action === 'read') return input;
  input.mutationId = normalizeReplayResourceId(data.mutationId, 'mutationId');
  input.expectedRevision = normalizeReplayRevision(data.expectedRevision);
  if (!Object.prototype.hasOwnProperty.call(data, 'expectedRevision')) {
    const error = new Error('expectedRevision must be supplied (use null when no archive exists).');
    error.code = 'invalid-argument';
    throw error;
  }
  if (action === 'set') {
    const normalized = normalizeYouTubeReplayUrl(data.youtubeUrl || data.replayUrl || data.url);
    if (!normalized) {
      const error = new Error('Paste a complete URL for one exact YouTube video.');
      error.code = 'invalid-argument';
      throw error;
    }
    input.replay = normalized;
    const title = compactText(data.title, 121);
    if (title.length > 120) {
      const error = new Error('Replay title must be 120 characters or fewer.');
      error.code = 'invalid-argument';
      throw error;
    }
    if (title) input.title = title;
  }
  return input;
}

function getReplayMutationHash(input = {}) {
  const payload = input.action === 'set'
    ? [input.action, input.teamId, input.gameId, input.replay?.videoId || '', input.title || '']
    : [input.action, input.teamId, input.gameId];
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function createReplayRevision(randomUUID = crypto.randomUUID) {
  const revision = randomUUID();
  if (typeof revision !== 'string' || !/^[A-Fa-f0-9-]{36}$/.test(revision)) {
    throw new Error('Secure replay revision generation failed.');
  }
  return `r:${revision}`;
}

function buildReplayArchiveWrite({ input, uid, revision, timestamp, existingArchive = null }) {
  const mutationHash = getReplayMutationHash(input);
  const protectedVideoIdHashes = mergeProtectedReplayVideoIdHashes(
    existingArchive,
    input.action === 'set' ? input.replay.videoId : null
  );
  const common = {
    schemaVersion: REPLAY_PRIVATE_SCHEMA_VERSION,
    state: input.action === 'set' ? 'ready' : 'removed',
    revision,
    lastMutationId: input.mutationId,
    lastMutationHash: mutationHash,
    protectedVideoIdHashes,
    updatedAt: timestamp
  };
  if (input.action === 'remove') return common;
  return {
    ...common,
    provider: 'youtube',
    videoId: input.replay.videoId,
    ...(input.title ? { title: input.title } : {}),
    linkedAt: timestamp
  };
}

function collectPotentialYouTubeVideoIds(value, output = new Set(), state = { nodes: 0 }) {
  state.nodes += 1;
  if (state.nodes > 2_000) {
    const error = new Error('Clip data is too complex.');
    error.code = 'invalid-argument';
    throw error;
  }
  if (typeof value === 'string') {
    const direct = extractYouTubeVideoIdForProtection(value);
    if (direct) output.add(direct);
    for (const match of value.matchAll(/(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{11})(?=$|[^A-Za-z0-9_-])/g)) {
      if (isValidYouTubeVideoId(match[2])) output.add(match[2]);
    }
    for (const match of value.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      const candidate = extractYouTubeVideoIdForProtection(match[0].replace(/[),.;!?]+$/, ''));
      if (candidate) output.add(candidate);
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectPotentialYouTubeVideoIds(entry, output, state));
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  Object.values(value).forEach((entry) => collectPotentialYouTubeVideoIds(entry, output, state));
  return output;
}

function containsProtectedReplayIdentity(value, protectedHashes) {
  if (!(protectedHashes instanceof Set) || protectedHashes.size === 0) return false;
  return [...collectPotentialYouTubeVideoIds(value)]
    .some((videoId) => protectedHashes.has(hashReplayVideoId(videoId)));
}

function collectExplicitYouTubeVideoIds(value, output = new Set(), state = { nodes: 0 }, key = '') {
  state.nodes += 1;
  if (state.nodes > 20_000) {
    const error = new Error('Readable media data is too complex.');
    error.code = 'invalid-argument';
    throw error;
  }
  if (typeof value === 'string') {
    const direct = extractYouTubeVideoIdForProtection(value);
    if (direct) output.add(direct);
    for (const match of value.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      const candidate = extractYouTubeVideoIdForProtection(match[0].replace(/[),.;!?]+$/, ''));
      if (candidate) output.add(candidate);
    }
    if (/youtube.*video.*id|video.*id.*youtube|^videoid$/i.test(key)) {
      const videoId = value.trim();
      if (isValidYouTubeVideoId(videoId)) output.add(videoId);
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectExplicitYouTubeVideoIds(entry, output, state, key));
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  Object.entries(value).forEach(([entryKey, entry]) => {
    collectExplicitYouTubeVideoIds(entry, output, state, entryKey);
  });
  return output;
}

function containsExplicitYouTubeIdentity(value) {
  return collectExplicitYouTubeVideoIds(value).size > 0;
}

function scrubProtectedReplayIdentityFromValue(value, protectedHashes) {
  if (typeof value === 'string') {
    return containsProtectedReplayIdentity(value, protectedHashes)
      ? { changed: true, keep: false, value: null }
      : { changed: false, keep: true, value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = [];
    value.forEach((entry) => {
      const scrubbed = scrubProtectedReplayIdentityFromValue(entry, protectedHashes);
      changed ||= scrubbed.changed;
      if (scrubbed.keep) next.push(scrubbed.value);
    });
    return { changed, keep: true, value: changed ? next : value };
  }
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
  if (!value || typeof value !== 'object' || (prototype !== Object.prototype && prototype !== null)) {
    return { changed: false, keep: true, value };
  }
  let changed = false;
  const next = {};
  Object.entries(value).forEach(([key, entry]) => {
    const scrubbed = scrubProtectedReplayIdentityFromValue(entry, protectedHashes);
    changed ||= scrubbed.changed;
    if (scrubbed.keep) next[key] = scrubbed.value;
  });
  return { changed, keep: true, value: changed ? next : value };
}

function buildReplayClipScrubUpdate(game = {}, archive = null) {
  const protectedHashes = getProtectedReplayVideoIdHashes(archive);
  const update = {};
  REPLAY_CLIP_COLLECTION_FIELDS.forEach((field) => {
    if (!Array.isArray(game?.[field])) return;
    const scrubbed = scrubProtectedReplayIdentityFromValue(game[field], protectedHashes);
    if (scrubbed.changed) update[field] = scrubbed.value;
  });
  return update;
}

function cloneHighlightClipValue(value, state = { nodes: 0, stringBytes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > 2_000 || depth > 8) {
    const error = new Error('Highlight clip data is too complex.');
    error.code = 'invalid-argument';
    throw error;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
  } else if (typeof value === 'string') {
    state.stringBytes += Buffer.byteLength(value, 'utf8');
    if (value.length <= 2_048 && state.stringBytes <= 64 * 1_024) return value;
  } else if (Array.isArray(value)) {
    if (value.length <= 100) return value.map((entry) => cloneHighlightClipValue(entry, state, depth + 1));
  } else if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value);
    if (entries.length <= 64 && entries.every(([key]) => key.length <= 80 && !['__proto__', 'prototype', 'constructor'].includes(key))) {
      return Object.fromEntries(entries.map(([key, entry]) => [key, cloneHighlightClipValue(entry, state, depth + 1)]));
    }
  }
  const error = new Error('Highlight clip data contains an unsupported value.');
  error.code = 'invalid-argument';
  throw error;
}

function normalizeHighlightClipPayload(value) {
  if (!Array.isArray(value) || value.length > 24) {
    const error = new Error('A game can store at most 24 highlight clips.');
    error.code = 'invalid-argument';
    throw error;
  }
  return cloneHighlightClipValue(value);
}

function collectHighlightProtectedUrlIdentityRecords(value) {
  const records = new Map();
  const visit = (entry, state = { nodes: 0 }, depth = 0) => {
    state.nodes += 1;
    if (state.nodes > 2_000 || depth > 8) {
      const error = new Error('Highlight clip data is too complex.');
      error.code = 'invalid-argument';
      throw error;
    }
    if (typeof entry === 'string') {
      for (const candidate of getReplayUrlIdentityCandidates(entry)) {
        const record = getReplayProtectedUrlIdentityRecord(candidate);
        records.set(record.path, record);
        if (records.size > MAX_HIGHLIGHT_PROTECTED_URL_LOOKUPS) {
          const error = new Error('Highlight clip data contains too many external URLs.');
          error.code = 'invalid-argument';
          throw error;
        }
      }
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((child) => visit(child, state, depth + 1));
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    Object.values(entry).forEach((child) => visit(child, state, depth + 1));
  };
  visit(value);
  return [...records.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeHighlightClipWrite(value, { existingClips = [] } = {}) {
  const clips = normalizeHighlightClipPayload(value);
  const existing = Array.isArray(existingClips) ? existingClips : [];
  const existingYouTubeClips = existing.filter(containsExplicitYouTubeIdentity);
  const nextYouTubeClips = clips.filter(containsExplicitYouTubeIdentity);
  const availableYouTubeClips = new Map();
  existingYouTubeClips.forEach((clip) => {
    const key = JSON.stringify(stableReplayClipValue(clip));
    availableYouTubeClips.set(key, (availableYouTubeClips.get(key) || 0) + 1);
  });
  const hasIntroducedYouTubeClip = nextYouTubeClips.some((clip) => {
    const key = JSON.stringify(stableReplayClipValue(clip));
    const availableCount = availableYouTubeClips.get(key) || 0;
    if (availableCount <= 0) return true;
    availableYouTubeClips.set(key, availableCount - 1);
    return false;
  });
  if (hasIntroducedYouTubeClip) {
    const error = new Error('YouTube clips may only be removed or retained byte-for-byte; add a non-YouTube clip instead.');
    error.code = 'failed-precondition';
    throw error;
  }
  return clips;
}

function stableReplayClipValue(value) {
  if (Array.isArray(value)) return value.map(stableReplayClipValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableReplayClipValue(value[key])]));
}

function replayClipValuesEqual(left, right) {
  return JSON.stringify(stableReplayClipValue(left)) === JSON.stringify(stableReplayClipValue(right));
}

function buildReplayParentUpdate({ state, revision, deleteValue, timestamp, isCompleted = true }) {
  const update = {
    hasRecordedReplay: state === 'ready',
    replayArchiveRevision: revision,
    updatedAt: timestamp
  };
  REPLAY_READABLE_FIELDS.forEach((field) => {
    if (field === 'videoUrl' && !isCompleted) return;
    update[field] = deleteValue;
  });
  return update;
}

function isReplayArchiveConsistent(game = {}, archive = null) {
  const normalized = normalizeStoredReplayArchive(archive);
  if (!normalized) return false;
  return game?.hasRecordedReplay === (normalized.state === 'ready')
    && normalizeReplayRevision(game?.replayArchiveRevision) === normalized.revision;
}

function getReplayProjectionVideo(game = {}, archive = null) {
  const normalized = normalizeStoredReplayArchive(archive);
  if (!normalized
    || normalized.state !== 'ready'
    || !isReplayArchiveConsistent(game, normalized)
    || !getCompatibleReplayLifecycle(game).isCompleted) return null;
  return {
    provider: 'youtube',
    videoId: normalized.videoId,
    embedUrl: `https://www.youtube.com/embed/${normalized.videoId}`,
    publicUrl: `https://www.youtube.com/watch?v=${normalized.videoId}`,
    ...(normalized.title ? { title: normalized.title } : {}),
    status: 'ready'
  };
}

function buildReplayServerProjectionGame(game = {}, archive = null, {
  stripNonCompletedVideoUrl = false
} = {}) {
  const projected = { ...(game || {}) };
  // Historical stored lifecycle aliases remain server-read compatible, but
  // callers receive the canonical completed spelling. Mutation validation
  // still evaluates the untouched source document with the exact predicate.
  if (getCompatibleReplayLifecycle(game).isCompleted && !getExactReplayLifecycle(game).isCompleted) {
    if (['complete', 'finished'].includes(projected.status)) projected.status = 'completed';
    if (['complete', 'finished'].includes(projected.liveStatus)) projected.liveStatus = 'completed';
  }
  REPLAY_READABLE_FIELDS.forEach((field) => {
    if (field === 'videoUrl'
      && !getCompatibleReplayLifecycle(game).isCompleted
      && !stripNonCompletedVideoUrl) return;
    delete projected[field];
  });
  const replayVideo = getReplayProjectionVideo(game, archive);
  projected.hasRecordedReplay = Boolean(replayVideo);
  if (replayVideo) projected.replayVideo = replayVideo;
  return projected;
}

function serializeReplayManagementState(game = {}, archive = null) {
  const normalized = normalizeStoredReplayArchive(archive);
  const consistent = normalized && isReplayArchiveConsistent(game, normalized);
  const state = consistent ? normalized.state : 'unavailable';
  const replayVideo = state === 'ready' ? getReplayProjectionVideo(game, normalized) : null;
  return {
    state,
    hasRecordedReplay: state === 'ready',
    replayArchiveRevision: consistent ? normalized.revision : null,
    lastMutationId: consistent ? normalized.lastMutationId : null,
    ...(replayVideo ? { replayVideo } : {})
  };
}

function resolveReplaySeasonId(game = {}, team = {}, now = new Date()) {
  const explicitCandidate = [
    game?.seasonId,
    game?.season,
    team?.currentSeasonId,
    team?.seasonId,
    team?.season
  ].map((value) => compactText(value, 41)).find(Boolean);
  let candidate = explicitCandidate;
  if (!candidate) {
    const dateValue = game?.date || game?.startTime || game?.scheduledAt || now;
    let parsedDate;
    try {
      parsedDate = typeof dateValue?.toDate === 'function'
        ? dateValue.toDate()
        : new Date(dateValue);
    } catch {
      parsedDate = null;
    }
    const fallbackDate = parsedDate instanceof Date && Number.isFinite(parsedDate.getTime())
      ? parsedDate
      : new Date(now);
    candidate = Number.isFinite(fallbackDate.getTime())
      ? String(fallbackDate.getUTCFullYear())
      : '';
  }
  return /^[A-Za-z0-9_-]{1,40}$/.test(candidate) ? candidate : '';
}

function normalizeReplayPremiumConfig(data, { exists = true } = {}) {
  if (!exists) return { state: 'unavailable', openToAll: false, reason: 'missing-global-config' };
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.openToAll !== 'boolean') {
    return { state: 'unavailable', openToAll: false, reason: 'invalid-global-config' };
  }
  return {
    state: 'ready',
    openToAll: data.openToAll,
    reason: data.openToAll ? 'global-open' : 'entitlement-required'
  };
}

module.exports = {
  REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH,
  REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
  REPLAY_CLIP_IDENTITY_COLLECTION,
  REPLAY_CLIP_IDENTITY_SCHEMA,
  REPLAY_PROTECTED_IDENTITY_COLLECTION,
  REPLAY_PROTECTED_IDENTITY_SCHEMA,
  REPLAY_PRIVATE_COLLECTION,
  REPLAY_PRIVATE_DOCUMENT,
  REPLAY_PRIVATE_SCHEMA_VERSION,
  REPLAY_COMPATIBILITY_DOCUMENT,
  REPLAY_COMPATIBILITY_SCHEMA,
  REPLAY_CLIP_COLLECTION_FIELDS,
  REPLAY_READABLE_FIELDS,
  buildReplayClipScrubUpdate,
  buildReplayArchiveWrite,
  buildReplayCompatibilityParentUpdate,
  buildReplayCompatibilityReceipt,
  buildReplayParentUpdate,
  buildReplayServerProjectionGame,
  canManageReplayArchive,
  collectHighlightProtectedUrlIdentityRecords,
  containsExplicitYouTubeIdentity,
  createReplayRevision,
  extractYouTubeVideoIdForProtection,
  getExactReplayLifecycle,
  getCompatibleReplayLifecycle,
  getPrivateReplayArchivePath,
  getReplayClipYouTubeIdentityRecord,
  getReplayIdentityHash,
  getReplayUrlIdentityCandidates,
  getReplayProtectedUrlIdentityRecord,
  getReplayProtectedYouTubeIdentityRecord,
  getReplayProtectedYouTubeIdentityRecordFromHash,
  getReplayArchiveChildPath,
  getReplayCompatibilityNextGame,
  getReplayCompatibilityParentFingerprint,
  getReplayCompatibilityReceiptPath,
  getReplayCompatibilityState,
  getReadableReplayArchiveState,
  getReplayMutationHash,
  getReplayProjectionVideo,
  getProtectedReplayVideoIdHashes,
  hashReplayVideoId,
  isCanonicalReplayGame,
  isReplayArchiveMigrationReady,
  isReplayArchiveConsistent,
  inspectLegacyReplayArchive,
  normalizeReplayManagementInput,
  normalizeHighlightClipPayload,
  normalizeHighlightClipWrite,
  normalizeReplayClipIdentity,
  normalizeReplayCompatibilityReceipt,
  normalizeReplayArchiveMigrationControl,
  normalizeReplayProtectedIdentity,
  normalizeReplayPremiumConfig,
  normalizeReplayResourceId,
  normalizeReplayRevision,
  normalizeStoredReplayArchive,
  normalizeYouTubeReplayUrl,
  resolveReplaySeasonId,
  replayClipValuesEqual,
  serializeReplayManagementState
};
