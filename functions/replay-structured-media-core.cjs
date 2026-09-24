'use strict';

const {
  getCompatibleReplayLifecycle,
  extractYouTubeVideoIdForProtection,
  getReplayIdentityHash,
  getReplayUrlIdentityCandidates,
  getReplayClipYouTubeIdentityRecord,
  normalizeYouTubeReplayUrl
} = require('./replay-private-archive-core.cjs');

const STRUCTURED_REPLAY_CLIP_SOURCE_ROLES = Object.freeze({
  INDEPENDENT: 'independent',
  AUTOMATED_COPY: 'automated-copy'
});

const STRUCTURED_REPLAY_CLIP_PATH_ROLES = Object.freeze({
  TEAM: 'team-document',
  TEAM_GAME: 'team-game-document',
  SHARED_GAME: 'shared-game-document',
  TEAM_MEDIA_ITEM: 'team-media-item-document',
  DRILL_LIBRARY: 'drill-library-document'
});

const TEAM_FIXED_VIDEO_ID_FIELDS = Object.freeze(['youtubeVideoId']);
const TEAM_FIXED_VIDEO_URL_FIELDS = Object.freeze([
  'streamEmbedUrl',
  'youtubeEmbedUrl',
  'streamUrl',
  'livestreamUrl'
]);
const GAME_FIXED_VIDEO_ID_FIELDS = Object.freeze(['youtubeVideoId']);
const GAME_FIXED_VIDEO_URL_FIELDS = Object.freeze(['streamEmbedUrl', 'youtubeEmbedUrl']);
const BROADCAST_PROVIDER_VIDEO_ID_FIELDS = Object.freeze(['videoId']);
const BROADCAST_PROVIDER_VIDEO_URL_FIELDS = Object.freeze(['embedUrl']);
const TEAM_MEDIA_VIDEO_LINK_TYPE_FIELDS = Object.freeze(['type', 'mediaType']);
const TEAM_MEDIA_VIDEO_LINK_TYPES = Object.freeze(['video-link', 'video_link']);
const TEAM_MEDIA_VIDEO_LINK_URL_FIELDS = Object.freeze(['url', 'src', 'downloadUrl']);
const DRILL_LIBRARY_VIDEO_URL_FIELDS = Object.freeze(['youtubeUrl', 'resourceUrl']);
const AUTOMATED_GAME_COPY_MARKER_FIELDS = Object.freeze([
  'sharedGameId',
  'sharedGamePath',
  '_sharedGamePath',
  'sharedScheduleId',
  'sharedScheduleSourceTeamId',
  'sharedScheduleOpponentTeamId',
  'sharedScheduleOpponentGameId'
]);

const STRUCTURED_REPLAY_CLIP_SCAN_TARGETS = Object.freeze([
  Object.freeze({ mode: 'collection', collectionId: 'teams' }),
  Object.freeze({ mode: 'collection-group', collectionId: 'games' }),
  Object.freeze({ mode: 'collection-group', collectionId: 'sharedGames' }),
  Object.freeze({ mode: 'collection-group', collectionId: 'mediaItems' }),
  Object.freeze({ mode: 'collection', collectionId: 'drillLibrary' })
]);

const ACTIVE_GAME_STATUSES = new Set(['live', 'in_progress', 'in-progress']);
const ACTIVE_GAME_COMPATIBLE_STATUSES = new Set([
  'scheduled',
  ...ACTIVE_GAME_STATUSES
]);
const IDENTITY_HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_EXACT_URL_IDENTITY_HASHES_PER_SOURCE = 3;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDocumentPath(value) {
  if (typeof value !== 'string' || value !== value.trim() || !value
    || value.startsWith('/') || value.endsWith('/')) return '';
  const segments = value.split('/');
  if (segments.length % 2 !== 0 || segments.some((segment) => !segment)) return '';
  return value;
}

function isSharedGameDocumentPath(path) {
  const segments = path.split('/');
  return segments.length >= 4 && segments.at(-2) === 'sharedGames';
}

function isTeamGameDocumentPath(path) {
  return /^teams\/[^/]+\/games\/[^/]+$/.test(path);
}

function getStructuredReplayClipPathRole(documentPath) {
  const path = normalizeDocumentPath(documentPath);
  if (!path) return null;
  if (/^teams\/[^/]+$/.test(path)) return STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM;
  if (isTeamGameDocumentPath(path)) return STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_GAME;
  if (isSharedGameDocumentPath(path)) return STRUCTURED_REPLAY_CLIP_PATH_ROLES.SHARED_GAME;
  if (/^teams\/[^/]+\/mediaItems\/[^/]+$/.test(path)) {
    return STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_MEDIA_ITEM;
  }
  if (/^drillLibrary\/[^/]+$/.test(path)) return STRUCTURED_REPLAY_CLIP_PATH_ROLES.DRILL_LIBRARY;
  return null;
}

function normalizeExactYouTubeVideoId(value) {
  const videoId = cleanString(value);
  if (!videoId) return null;
  return normalizeYouTubeReplayUrl(`https://youtu.be/${videoId}`);
}

function getExactUrlIdentityHashes(value) {
  return getReplayUrlIdentityCandidates(value)
    .map((candidate) => getReplayIdentityHash('url', candidate))
    .sort();
}

function readExactLifecycleStatus(value) {
  if (value === null || value === undefined || value === '') return '';
  return typeof value === 'string' && value === value.trim() ? value : 'invalid';
}

function getExactActiveGameVideoLifecycle(game = {}) {
  if (!isPlainObject(game)) {
    return { type: 'invalid', status: 'invalid', liveStatus: 'invalid', isActive: false };
  }
  const type = Object.prototype.hasOwnProperty.call(game, 'type') ? game.type : undefined;
  const status = readExactLifecycleStatus(game.status);
  const liveStatus = readExactLifecycleStatus(game.liveStatus);
  const statuses = [status, liveStatus].filter(Boolean);
  const isGame = type === undefined || type === 'game';
  const hasTerminalFlag = game.isCancelled === true || game.deleted === true || game.isDeleted === true;
  const isActive = isGame
    && !hasTerminalFlag
    && status !== 'invalid'
    && liveStatus !== 'invalid'
    && statuses.some((value) => ACTIVE_GAME_STATUSES.has(value))
    && statuses.every((value) => ACTIVE_GAME_COMPATIBLE_STATUSES.has(value));
  return { type, status, liveStatus, isActive };
}

function hasAutomatedGameCopyMarker(game, pathRole) {
  if (game?.isSharedGame === true || game?.isPublicProjection === true) return true;
  return AUTOMATED_GAME_COPY_MARKER_FIELDS.some((field) => {
    const value = game?.[field];
    return value !== null && value !== undefined && value !== '';
  });
}

function makeCandidate(value, fieldPath, { rawVideoId = false } = {}) {
  if (rawVideoId) {
    const normalized = normalizeExactYouTubeVideoId(value);
    return normalized
      ? { videoId: normalized.videoId, urlIdentityHashes: [], fieldPath }
      : null;
  }
  const urlIdentityHashes = getExactUrlIdentityHashes(value);
  if (!urlIdentityHashes.length) return null;
  return {
    videoId: extractYouTubeVideoIdForProtection(value),
    urlIdentityHashes,
    fieldPath
  };
}

function extractTeamFixedVideoCandidates(data) {
  const candidates = [];
  TEAM_FIXED_VIDEO_ID_FIELDS.forEach((field) => {
    const candidate = makeCandidate(data?.[field], field, { rawVideoId: true });
    if (candidate) candidates.push(candidate);
  });
  TEAM_FIXED_VIDEO_URL_FIELDS.forEach((field) => {
    const candidate = makeCandidate(data?.[field], field);
    if (candidate) candidates.push(candidate);
  });
  return candidates;
}

function extractBroadcastProviderCandidates(data) {
  const provider = data?.broadcastSession?.provider;
  if (!isPlainObject(data?.broadcastSession) || !isPlainObject(provider)) return [];
  const candidates = [];
  BROADCAST_PROVIDER_VIDEO_ID_FIELDS.forEach((field) => {
    const candidate = makeCandidate(provider[field], `broadcastSession.provider.${field}`, { rawVideoId: true });
    if (candidate) candidates.push(candidate);
  });
  BROADCAST_PROVIDER_VIDEO_URL_FIELDS.forEach((field) => {
    const candidate = makeCandidate(provider[field], `broadcastSession.provider.${field}`);
    if (candidate) candidates.push(candidate);
  });
  return candidates;
}

function extractActiveGameVideoCandidates(data) {
  if (getCompatibleReplayLifecycle(data).isCompleted) return [];
  const candidate = makeCandidate(data?.videoUrl, 'videoUrl');
  return candidate ? [candidate] : [];
}

function isTeamMediaVideoLink(data) {
  return TEAM_MEDIA_VIDEO_LINK_TYPE_FIELDS.some((field) => {
    const value = cleanString(data?.[field]).toLowerCase();
    return TEAM_MEDIA_VIDEO_LINK_TYPES.includes(value);
  });
}

function extractTeamMediaVideoLinkCandidates(data) {
  if (!isTeamMediaVideoLink(data)) return [];
  const candidates = [];
  TEAM_MEDIA_VIDEO_LINK_URL_FIELDS.forEach((field) => {
    const candidate = makeCandidate(data?.[field], field);
    if (candidate) candidates.push(candidate);
  });
  return candidates;
}

function extractDrillLibraryVideoCandidates(data) {
  const candidates = [];
  DRILL_LIBRARY_VIDEO_URL_FIELDS.forEach((field) => {
    const candidate = makeCandidate(data?.[field], field);
    if (candidate) candidates.push(candidate);
  });
  return candidates;
}

const STRUCTURED_REPLAY_CLIP_SOURCE_DESCRIPTORS = Object.freeze([
  Object.freeze({
    id: 'team-fixed-video',
    sourceKind: 'team-fixed-video',
    pathRoles: Object.freeze([STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM]),
    sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT,
    scanTargetIds: Object.freeze(['teams']),
    extractCandidates: extractTeamFixedVideoCandidates
  }),
  Object.freeze({
    id: 'game-fixed-video',
    sourceKind: 'game-fixed-video',
    pathRoles: Object.freeze([
      STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_GAME,
      STRUCTURED_REPLAY_CLIP_PATH_ROLES.SHARED_GAME
    ]),
    sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.AUTOMATED_COPY,
    scanTargetIds: Object.freeze(['games', 'sharedGames']),
    extractCandidates(data) {
      const candidates = [];
      GAME_FIXED_VIDEO_ID_FIELDS.forEach((field) => {
        const candidate = makeCandidate(data?.[field], field, { rawVideoId: true });
        if (candidate) candidates.push(candidate);
      });
      GAME_FIXED_VIDEO_URL_FIELDS.forEach((field) => {
        const candidate = makeCandidate(data?.[field], field);
        if (candidate) candidates.push(candidate);
      });
      return candidates;
    }
  }),
  Object.freeze({
    id: 'game-broadcast-provider',
    sourceKind: 'game-broadcast-provider',
    pathRoles: Object.freeze([
      STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_GAME,
      STRUCTURED_REPLAY_CLIP_PATH_ROLES.SHARED_GAME
    ]),
    sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.AUTOMATED_COPY,
    scanTargetIds: Object.freeze(['games', 'sharedGames']),
    extractCandidates: extractBroadcastProviderCandidates
  }),
  Object.freeze({
    id: 'game-active-video-url',
    sourceKind: 'game-active-video-url',
    pathRoles: Object.freeze([
      STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_GAME,
      STRUCTURED_REPLAY_CLIP_PATH_ROLES.SHARED_GAME
    ]),
    sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT,
    scanTargetIds: Object.freeze(['games', 'sharedGames']),
    extractCandidates: extractActiveGameVideoCandidates
  }),
  Object.freeze({
    id: 'team-media-video-link',
    sourceKind: 'team-media-video-link',
    pathRoles: Object.freeze([STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_MEDIA_ITEM]),
    sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT,
    scanTargetIds: Object.freeze(['mediaItems']),
    extractCandidates: extractTeamMediaVideoLinkCandidates
  }),
  Object.freeze({
    id: 'drill-library-video',
    sourceKind: 'drill-library-video',
    pathRoles: Object.freeze([STRUCTURED_REPLAY_CLIP_PATH_ROLES.DRILL_LIBRARY]),
    sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT,
    scanTargetIds: Object.freeze(['drillLibrary']),
    extractCandidates: extractDrillLibraryVideoCandidates
  })
]);

function hasDynamicGameSourceRole(descriptor) {
  return ['game-active-video-url', 'game-fixed-video', 'game-broadcast-provider'].includes(descriptor.id);
}

function sourceRoleForDescriptor(descriptor, data, pathRole) {
  if (!hasDynamicGameSourceRole(descriptor)) {
    return descriptor.sourceRole;
  }
  // Canonical organization/tournament shared games own their stream metadata.
  // Markers such as isSharedGame or sharedGamePath describe that canonical
  // document; they do not make it a disposable team projection.
  if (pathRole === STRUCTURED_REPLAY_CLIP_PATH_ROLES.SHARED_GAME) {
    return STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT;
  }
  const isCanonicalTeamBroadcastCopy = pathRole === STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_GAME
    && descriptor.id !== 'game-active-video-url';
  return isCanonicalTeamBroadcastCopy || hasAutomatedGameCopyMarker(data, pathRole)
    ? STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.AUTOMATED_COPY
    : STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT;
}

function compareSourceEntries(left, right) {
  return (left.videoId || '').localeCompare(right.videoId || '')
    || (left.urlIdentityHashes?.join(',') || '').localeCompare(right.urlIdentityHashes?.join(',') || '')
    || left.sourceKind.localeCompare(right.sourceKind)
    || left.documentPath.localeCompare(right.documentPath)
    || left.fieldPath.localeCompare(right.fieldPath)
    || left.sourceRole.localeCompare(right.sourceRole);
}

function extractStructuredReplayIdentitySources(documentPath, data = {}) {
  const path = normalizeDocumentPath(documentPath);
  const pathRole = getStructuredReplayClipPathRole(path);
  if (!path || !pathRole || !isPlainObject(data)) return [];

  const sources = [];
  STRUCTURED_REPLAY_CLIP_SOURCE_DESCRIPTORS.forEach((descriptor) => {
    if (!descriptor.pathRoles.includes(pathRole)) return;
    const sourceRole = sourceRoleForDescriptor(descriptor, data, pathRole);
    descriptor.extractCandidates(data).forEach((candidate) => {
      sources.push({
        videoId: candidate.videoId,
        urlIdentityHashes: candidate.urlIdentityHashes,
        sourceKind: descriptor.sourceKind,
        sourceRole,
        documentPath: path,
        pathRole,
        fieldPath: candidate.fieldPath,
        sourcePath: `${path}#${candidate.fieldPath}`
      });
    });
  });

  return sources.sort(compareSourceEntries);
}

function extractStructuredReplayClipSources(documentPath, data = {}) {
  return extractStructuredReplayIdentitySources(documentPath, data)
    .filter((source) => Boolean(source.videoId));
}

function normalizeUrlIdentityHashes(value) {
  if (!Array.isArray(value) || value.length > MAX_EXACT_URL_IDENTITY_HASHES_PER_SOURCE) {
    throw new TypeError('Structured replay URL identity hashes are invalid.');
  }
  const normalized = [...new Set(value)].sort();
  if (normalized.length !== value.length
    || normalized.some((entry) => typeof entry !== 'string' || !IDENTITY_HASH_PATTERN.test(entry))) {
    throw new TypeError('Structured replay URL identity hashes are invalid.');
  }
  return normalized;
}

function normalizeSourceEntry(value) {
  if (!isPlainObject(value)) throw new TypeError('Structured replay clip sources must be objects.');
  const normalizedVideo = value.videoId === null
    ? null
    : normalizeExactYouTubeVideoId(value.videoId);
  const urlIdentityHashes = normalizeUrlIdentityHashes(value.urlIdentityHashes || []);
  const sourceKind = cleanString(value.sourceKind);
  const sourceRole = cleanString(value.sourceRole);
  const documentPath = normalizeDocumentPath(value.documentPath);
  const pathRole = cleanString(value.pathRole);
  const fieldPath = cleanString(value.fieldPath);
  const descriptor = STRUCTURED_REPLAY_CLIP_SOURCE_DESCRIPTORS.find((candidate) => (
    candidate.sourceKind === sourceKind
  ));
  if ((!normalizedVideo && !urlIdentityHashes.length) || !sourceKind || !documentPath || !fieldPath
    || !Object.values(STRUCTURED_REPLAY_CLIP_SOURCE_ROLES).includes(sourceRole)
    || !Object.values(STRUCTURED_REPLAY_CLIP_PATH_ROLES).includes(pathRole)
    || getStructuredReplayClipPathRole(documentPath) !== pathRole
    || !descriptor
    || !descriptor.pathRoles.includes(pathRole)
    || (!hasDynamicGameSourceRole(descriptor) && sourceRole !== descriptor.sourceRole)) {
    throw new TypeError('Structured replay clip source metadata is invalid.');
  }
  return {
    videoId: normalizedVideo?.videoId || null,
    urlIdentityHashes,
    sourceKind,
    sourceRole,
    documentPath,
    pathRole,
    fieldPath,
    sourcePath: `${documentPath}#${fieldPath}`
  };
}

function normalizeProtectedVideoIds(value) {
  if (value === null || value === undefined) return new Set();
  let entries;
  if (value instanceof Set || Array.isArray(value)) {
    entries = [...value];
  } else if (isPlainObject(value)
    && (value.youtubeVideoIds instanceof Set || Array.isArray(value.youtubeVideoIds))) {
    entries = [...value.youtubeVideoIds];
  } else {
    throw new TypeError('Protected replay identities must provide a YouTube video ID set or array.');
  }
  const normalized = new Set();
  entries.forEach((entry) => {
    const candidate = normalizeExactYouTubeVideoId(entry);
    if (!candidate) throw new TypeError('Protected replay identity contains an invalid YouTube video ID.');
    normalized.add(candidate.videoId);
  });
  return normalized;
}

function normalizeProtectedIdentityHashes(value) {
  if (value === null || value === undefined) return new Set();
  if (!(value instanceof Set) && !Array.isArray(value)) {
    throw new TypeError('Protected replay identity hashes must be an array or set.');
  }
  const hashes = new Set(value);
  if ([...hashes].some((entry) => typeof entry !== 'string' || !/^[a-f0-9]{64}$/.test(entry))) {
    throw new TypeError('Protected replay identity hash is invalid.');
  }
  return hashes;
}

function summarizeIdentitySources(identityKey, identitySources, keyField) {
  return {
    [keyField]: identityKey,
    sourceCount: identitySources.length,
    independentSourceCount: identitySources.filter((source) => (
      source.sourceRole === STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT
    )).length,
    automatedCopyCount: identitySources.filter((source) => (
      source.sourceRole === STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.AUTOMATED_COPY
    )).length,
    sources: identitySources
  };
}

function uniqueSources(sources) {
  const byPath = new Map();
  sources.forEach((source) => {
    const key = [source.sourcePath, source.sourceKind, source.sourceRole].join('\u0000');
    if (!byPath.has(key)) byPath.set(key, source);
  });
  return [...byPath.values()].sort(compareSourceEntries);
}

function buildStructuredReplayClipIdentityReport(sourceEntries = [], {
  protectedVideoIds = null,
  protectedIdentityHashes = null
} = {}) {
  if (!Array.isArray(sourceEntries)) throw new TypeError('Structured replay clip source entries must be an array.');
  const protectedIds = normalizeProtectedVideoIds(protectedVideoIds);
  const protectedHashes = normalizeProtectedIdentityHashes(protectedIdentityHashes);
  const sourceByKey = new Map();
  sourceEntries.map(normalizeSourceEntry).forEach((source) => {
    const key = [
      source.videoId,
      source.urlIdentityHashes.join(','),
      source.sourceKind,
      source.sourceRole,
      source.documentPath,
      source.pathRole,
      source.fieldPath
    ].join('\u0000');
    if (!sourceByKey.has(key)) sourceByKey.set(key, source);
  });
  const sources = [...sourceByKey.values()].sort(compareSourceEntries);
  const sourcesByVideoId = new Map();
  const sourcesByUrlIdentityHash = new Map();
  sources.forEach((source) => {
    if (source.videoId) {
      const entries = sourcesByVideoId.get(source.videoId) || [];
      entries.push(source);
      sourcesByVideoId.set(source.videoId, entries);
    }
    source.urlIdentityHashes.forEach((identityHash) => {
      const entries = sourcesByUrlIdentityHash.get(identityHash) || [];
      entries.push(source);
      sourcesByUrlIdentityHash.set(identityHash, entries);
    });
  });
  const identities = [...sourcesByVideoId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([videoId, identitySources]) => summarizeIdentitySources(
      videoId,
      identitySources,
      'videoId'
    ));
  const urlIdentities = [...sourcesByUrlIdentityHash.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([identityHash, identitySources]) => summarizeIdentitySources(
      identityHash,
      identitySources,
      'identityHash'
    ));
  const independentSources = sources.filter((source) => (
    source.sourceRole === STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT
  ));
  const automatedCopies = sources.filter((source) => (
    source.sourceRole === STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.AUTOMATED_COPY
  ));
  const protectedOverlaps = identities.filter((identity) => (
    protectedIds.has(identity.videoId)
    || protectedHashes.has(getReplayIdentityHash('youtube', identity.videoId))
  ));
  const independentProtectedOverlaps = protectedOverlaps.filter((identity) => (
    identity.independentSourceCount > 0
  ));
  const automatedProtectedCopies = protectedOverlaps.filter((identity) => (
    identity.independentSourceCount === 0 && identity.automatedCopyCount > 0
  ));
  const protectedUrlOverlaps = urlIdentities.filter((identity) => (
    protectedHashes.has(identity.identityHash)
  ));
  const independentProtectedUrlOverlaps = protectedUrlOverlaps.filter((identity) => (
    identity.independentSourceCount > 0
  ));
  const automatedProtectedUrlCopies = protectedUrlOverlaps.filter((identity) => (
    identity.independentSourceCount === 0 && identity.automatedCopyCount > 0
  ));
  const protectedSources = uniqueSources([
    ...protectedOverlaps.flatMap((identity) => identity.sources),
    ...protectedUrlOverlaps.flatMap((identity) => identity.sources)
  ]);
  const independentProtectedSources = protectedSources.filter((source) => (
    source.sourceRole === STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT
  ));
  const automatedProtectedSources = protectedSources.filter((source) => (
    source.sourceRole === STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.AUTOMATED_COPY
  ));

  return {
    sources,
    independentSources,
    automatedCopies,
    identities,
    urlIdentities,
    videoIds: identities.map((identity) => identity.videoId),
    urlIdentityHashes: urlIdentities.map((identity) => identity.identityHash),
    independentVideoIds: [...new Set(independentSources.map((source) => source.videoId).filter(Boolean))].sort(),
    automatedCopyVideoIds: [...new Set(automatedCopies.map((source) => source.videoId).filter(Boolean))].sort(),
    independentUrlIdentityHashes: [...new Set(independentSources.flatMap((source) => (
      source.urlIdentityHashes
    )))].sort(),
    automatedCopyUrlIdentityHashes: [...new Set(automatedCopies.flatMap((source) => (
      source.urlIdentityHashes
    )))].sort(),
    protectedOverlaps,
    independentProtectedOverlaps,
    automatedProtectedCopies,
    protectedUrlOverlaps,
    independentProtectedUrlOverlaps,
    automatedProtectedUrlCopies,
    protectedSources,
    independentProtectedSources,
    automatedProtectedSources,
    summary: {
      sourceCount: sources.length,
      independentSourceCount: independentSources.length,
      automatedCopyCount: automatedCopies.length,
      identityCount: identities.length,
      urlIdentityCount: urlIdentities.length,
      protectedOverlapCount: protectedOverlaps.length,
      independentProtectedOverlapCount: independentProtectedOverlaps.length,
      automatedProtectedCopyCount: automatedProtectedCopies.length,
      protectedUrlOverlapCount: protectedUrlOverlaps.length,
      independentProtectedUrlOverlapCount: independentProtectedUrlOverlaps.length,
      automatedProtectedUrlCopyCount: automatedProtectedUrlCopies.length
    }
  };
}

function assertNoStructuredReplayProtectedOverlap(report) {
  if (!isPlainObject(report)
    || !Array.isArray(report.protectedOverlaps)
    || !Array.isArray(report.protectedUrlOverlaps)) {
    throw new TypeError('A structured replay clip identity report is required.');
  }
  if (!report.protectedOverlaps.length && !report.protectedUrlOverlaps.length) return report;
  const error = new Error('Structured public media overlaps a protected replay identity.');
  error.code = 'failed-precondition';
  error.report = report;
  throw error;
}

function buildPermanentReplayClipIdentityInputs(sourceEntries = [], options = {}) {
  const report = buildStructuredReplayClipIdentityReport(sourceEntries, options);
  assertNoStructuredReplayProtectedOverlap(report);
  return {
    report,
    upserts: report.identities.map((identity) => {
      const record = getReplayClipYouTubeIdentityRecord(identity.videoId);
      return {
        videoId: identity.videoId,
        path: record.path,
        data: record.data,
        sourceKinds: [...new Set(identity.sources.map((source) => source.sourceKind))].sort(),
        sourceRoles: [...new Set(identity.sources.map((source) => source.sourceRole))].sort()
      };
    }),
    urlIdentityInputs: report.urlIdentities.map((identity) => ({
      kind: 'url',
      identityHash: identity.identityHash,
      sourceKinds: [...new Set(identity.sources.map((source) => source.sourceKind))].sort(),
      sourceRoles: [...new Set(identity.sources.map((source) => source.sourceRole))].sort()
    })),
    deletes: []
  };
}

module.exports = {
  AUTOMATED_GAME_COPY_MARKER_FIELDS,
  BROADCAST_PROVIDER_VIDEO_ID_FIELDS,
  BROADCAST_PROVIDER_VIDEO_URL_FIELDS,
  DRILL_LIBRARY_VIDEO_URL_FIELDS,
  GAME_FIXED_VIDEO_ID_FIELDS,
  GAME_FIXED_VIDEO_URL_FIELDS,
  STRUCTURED_REPLAY_CLIP_PATH_ROLES,
  STRUCTURED_REPLAY_CLIP_SCAN_TARGETS,
  STRUCTURED_REPLAY_CLIP_SOURCE_DESCRIPTORS,
  STRUCTURED_REPLAY_CLIP_SOURCE_ROLES,
  TEAM_FIXED_VIDEO_ID_FIELDS,
  TEAM_FIXED_VIDEO_URL_FIELDS,
  TEAM_MEDIA_VIDEO_LINK_TYPE_FIELDS,
  TEAM_MEDIA_VIDEO_LINK_TYPES,
  TEAM_MEDIA_VIDEO_LINK_URL_FIELDS,
  assertNoStructuredReplayProtectedOverlap,
  buildPermanentReplayClipIdentityInputs,
  buildStructuredReplayClipIdentityReport,
  extractStructuredReplayClipSources,
  extractStructuredReplayIdentitySources,
  getExactActiveGameVideoLifecycle,
  getExactUrlIdentityHashes,
  getStructuredReplayClipPathRole
};
