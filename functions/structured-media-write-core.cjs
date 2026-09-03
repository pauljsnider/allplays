'use strict';

const crypto = require('node:crypto');
const {
  REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH,
  collectHighlightProtectedUrlIdentityRecords,
  getReplayClipYouTubeIdentityRecord,
  getReplayProtectedYouTubeIdentityRecord,
  extractYouTubeVideoIdForProtection,
  isReplayArchiveMigrationReady,
  normalizeReplayClipIdentity,
  normalizeReplayProtectedIdentity
} = require('./replay-private-archive-core.cjs');
const {
  TEAM_FIXED_VIDEO_ID_FIELDS,
  TEAM_FIXED_VIDEO_URL_FIELDS,
  TEAM_MEDIA_VIDEO_LINK_TYPES,
  TEAM_MEDIA_VIDEO_LINK_TYPE_FIELDS,
  TEAM_MEDIA_VIDEO_LINK_URL_FIELDS,
  DRILL_LIBRARY_VIDEO_URL_FIELDS
} = require('./replay-structured-media-core.cjs');
const {
  ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH,
  isAthleteProfileProjectionBoundaryReady
} = require('./athlete-profile-projection-core.cjs');

const STRUCTURED_MEDIA_WRITE_SCHEMA_VERSION = 1;
const STRUCTURED_MEDIA_WRITE_MUTATION_SCHEMA = 'structured-media-write-mutation';
const STRUCTURED_MEDIA_WRITE_MUTATION_COLLECTION = 'structuredMediaWriteMutations';
const STRUCTURED_MEDIA_WRITE_HASH_PREFIX = 'structured-media-write-v1:';

const STRUCTURED_MEDIA_RESOURCE_KINDS = Object.freeze({
  TEAM_FIXED_VIDEO: 'team-fixed-video',
  TEAM_MEDIA_VIDEO_LINK: 'team-media-video-link',
  DRILL_LIBRARY_VIDEO: 'drill-library-video'
});

const STRUCTURED_MEDIA_ACTIONS = Object.freeze({
  SET: 'set',
  CREATE: 'create',
  REMOVE: 'remove',
  DELETE: 'delete'
});

const TEAM_FIXED_VIDEO_FIELDS = Object.freeze([
  ...TEAM_FIXED_VIDEO_URL_FIELDS,
  ...TEAM_FIXED_VIDEO_ID_FIELDS
]);
const TEAM_MEDIA_CREATE_FIELDS = Object.freeze([
  'folderId',
  'title',
  'type',
  ...TEAM_MEDIA_VIDEO_LINK_URL_FIELDS
]);
const DRILL_LIBRARY_VIDEO_FIELDS = Object.freeze([...DRILL_LIBRARY_VIDEO_URL_FIELDS]);
const MAX_URL_LENGTH = 2_048;
const MAX_TITLE_LENGTH = 240;

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function normalizeIdentifier(value, fieldName) {
  if (typeof value !== 'string'
    || value !== value.trim()
    || !value
    || value.length > 128
    || value.includes('/')) {
    fail('invalid-argument', `${fieldName} is invalid.`);
  }
  return value;
}

function normalizeRequestHash(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    fail('invalid-argument', 'requestHash is invalid.');
  }
  return value;
}

function normalizeNullableUrl(value, fieldName) {
  if (value === null) return null;
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > MAX_URL_LENGTH) {
    fail('invalid-argument', `${fieldName} must be a valid http:// or https:// URL.`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('invalid-argument', `${fieldName} must be a valid http:// or https:// URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    fail('invalid-argument', `${fieldName} must be a valid http:// or https:// URL.`);
  }
  return value;
}

function normalizeNullableYouTubeVideoId(value) {
  if (value === null) return null;
  if (typeof value !== 'string'
    || value !== value.trim()
    || !/^[A-Za-z0-9_-]{11}$/.test(value)
    || value === 'live_stream') {
    fail('invalid-argument', 'youtubeVideoId is invalid.');
  }
  return value;
}

function requireExactFields(value, expectedFields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('invalid-argument', `${label} is invalid.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('invalid-argument', `${label} contains unsupported or missing fields.`);
  }
}

function requireAllowedFields(value, allowedFields, requiredFields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('invalid-argument', `${label} is invalid.`);
  }
  if (Object.keys(value).some((field) => !allowedFields.includes(field))
    || requiredFields.some((field) => !hasOwn(value, field))) {
    fail('invalid-argument', `${label} contains unsupported or missing fields.`);
  }
}

function normalizeEmptyPayload(value) {
  requireExactFields(value, [], 'payload');
  return {};
}

function normalizeTeamFixedVideoPayload(value) {
  requireExactFields(value, TEAM_FIXED_VIDEO_FIELDS, 'Team video payload');
  const payload = {};
  TEAM_FIXED_VIDEO_URL_FIELDS.forEach((field) => {
    payload[field] = normalizeNullableUrl(value[field], field);
  });
  TEAM_FIXED_VIDEO_ID_FIELDS.forEach((field) => {
    payload[field] = normalizeNullableYouTubeVideoId(value[field]);
  });
  if (!Object.values(payload).some(Boolean)) {
    fail('invalid-argument', 'Use the remove action to clear team video fields.');
  }
  return payload;
}

function normalizeTeamMediaCreatePayload(value) {
  requireExactFields(value, TEAM_MEDIA_CREATE_FIELDS, 'Team media payload');
  const folderId = normalizeIdentifier(value.folderId, 'folderId');
  if (typeof value.title !== 'string'
    || value.title !== value.title.trim()
    || !value.title
    || value.title.length > MAX_TITLE_LENGTH) {
    fail('invalid-argument', 'title is invalid.');
  }
  if (!TEAM_MEDIA_VIDEO_LINK_TYPES.includes(value.type)) {
    fail('invalid-argument', 'type must identify a video link.');
  }
  const payload = {
    folderId,
    title: value.title,
    type: value.type
  };
  TEAM_MEDIA_VIDEO_LINK_URL_FIELDS.forEach((field) => {
    payload[field] = normalizeNullableUrl(value[field], field);
  });
  if (!TEAM_MEDIA_VIDEO_LINK_URL_FIELDS.some((field) => Boolean(payload[field]))) {
    fail('invalid-argument', 'A team media video URL is required.');
  }
  return payload;
}

function normalizeDrillVideoPayload(value) {
  requireExactFields(value, DRILL_LIBRARY_VIDEO_FIELDS, 'Drill video payload');
  const payload = {};
  DRILL_LIBRARY_VIDEO_URL_FIELDS.forEach((field) => {
    payload[field] = normalizeNullableUrl(value[field], field);
  });
  if (!Object.values(payload).some(Boolean)) {
    fail('invalid-argument', 'Use the remove action to clear drill video fields.');
  }
  return payload;
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value)
    .sort()
    .map((key) => [key, stableJsonValue(value[key])]));
}

function getStructuredMediaWriteRequestHash(value) {
  const canonical = JSON.stringify(stableJsonValue(value));
  return crypto.createHash('sha256')
    .update(`${STRUCTURED_MEDIA_WRITE_HASH_PREFIX}${canonical}`)
    .digest('hex');
}

function normalizeStructuredMediaWriteInput(data = {}) {
  requireAllowedFields(
    data,
    ['version', 'mutationId', 'requestHash', 'resourceKind', 'action', 'teamId', 'targetId', 'payload'],
    ['version', 'mutationId', 'requestHash', 'resourceKind', 'action', 'teamId', 'payload'],
    'Structured media request'
  );
  const version = data.version;
  if (version !== STRUCTURED_MEDIA_WRITE_SCHEMA_VERSION) {
    fail('invalid-argument', 'Structured media request version is invalid.');
  }
  const mutationId = normalizeIdentifier(data.mutationId, 'mutationId');
  const requestHash = normalizeRequestHash(data.requestHash);
  const resourceKind = data.resourceKind;
  const action = data.action;
  const teamId = normalizeIdentifier(data.teamId, 'teamId');
  let targetId = null;
  let payload;

  if (resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO) {
    if (![STRUCTURED_MEDIA_ACTIONS.SET, STRUCTURED_MEDIA_ACTIONS.REMOVE].includes(action)) {
      fail('invalid-argument', 'Team video action is invalid.');
    }
    if (hasOwn(data, 'targetId') && data.targetId !== null && data.targetId !== undefined) {
      fail('invalid-argument', 'targetId is not supported for team video updates.');
    }
    payload = action === STRUCTURED_MEDIA_ACTIONS.SET
      ? normalizeTeamFixedVideoPayload(data.payload)
      : normalizeEmptyPayload(data.payload);
  } else if (resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_MEDIA_VIDEO_LINK) {
    if (![STRUCTURED_MEDIA_ACTIONS.CREATE, STRUCTURED_MEDIA_ACTIONS.REMOVE].includes(action)) {
      fail('invalid-argument', 'Team media action is invalid.');
    }
    if (action === STRUCTURED_MEDIA_ACTIONS.CREATE) {
      if (hasOwn(data, 'targetId') && data.targetId !== null && data.targetId !== undefined) {
        fail('invalid-argument', 'targetId is server-assigned for team media creation.');
      }
      payload = normalizeTeamMediaCreatePayload(data.payload);
    } else {
      targetId = normalizeIdentifier(data.targetId, 'targetId');
      payload = normalizeEmptyPayload(data.payload);
    }
  } else if (resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.DRILL_LIBRARY_VIDEO) {
    if (![STRUCTURED_MEDIA_ACTIONS.SET, STRUCTURED_MEDIA_ACTIONS.REMOVE, STRUCTURED_MEDIA_ACTIONS.DELETE].includes(action)) {
      fail('invalid-argument', 'Drill video action is invalid.');
    }
    targetId = normalizeIdentifier(data.targetId, 'targetId');
    payload = action === STRUCTURED_MEDIA_ACTIONS.SET
      ? normalizeDrillVideoPayload(data.payload)
      : normalizeEmptyPayload(data.payload);
  } else {
    fail('invalid-argument', 'resourceKind is invalid.');
  }

  const semanticRequest = {
    version,
    resourceKind,
    action,
    teamId,
    ...(targetId ? { targetId } : {}),
    payload
  };
  if (getStructuredMediaWriteRequestHash(semanticRequest) !== requestHash) {
    fail('invalid-argument', 'requestHash does not match the structured media request.');
  }
  return {
    ...semanticRequest,
    targetId,
    mutationId,
    requestHash
  };
}

function getStructuredMediaItemId(teamId, mutationId) {
  const normalizedTeamId = normalizeIdentifier(teamId, 'teamId');
  const normalizedMutationId = normalizeIdentifier(mutationId, 'mutationId');
  return crypto.createHash('sha256')
    .update(`allplays:structured-media-item:v1:${normalizedTeamId}\0${normalizedMutationId}`)
    .digest('hex');
}

function getStructuredMediaWriteMutationRecord(input, resultTargetId = null) {
  const digest = crypto.createHash('sha256')
    .update(`allplays:structured-media-write-mutation:v1:${input.teamId}\0${input.mutationId}`)
    .digest('hex');
  return {
    path: `${STRUCTURED_MEDIA_WRITE_MUTATION_COLLECTION}/${digest}`,
    data: {
      schema: STRUCTURED_MEDIA_WRITE_MUTATION_SCHEMA,
      version: STRUCTURED_MEDIA_WRITE_SCHEMA_VERSION,
      mutationId: input.mutationId,
      requestHash: input.requestHash,
      resourceKind: input.resourceKind,
      action: input.action,
      teamId: input.teamId,
      targetId: input.targetId,
      resultTargetId
    }
  };
}

function normalizeStructuredMediaWriteMutationRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== STRUCTURED_MEDIA_WRITE_MUTATION_SCHEMA
    || value.version !== STRUCTURED_MEDIA_WRITE_SCHEMA_VERSION) return null;
  try {
    return {
      mutationId: normalizeIdentifier(value.mutationId, 'mutationId'),
      requestHash: normalizeRequestHash(value.requestHash),
      resourceKind: value.resourceKind,
      action: value.action,
      teamId: normalizeIdentifier(value.teamId, 'teamId'),
      targetId: value.targetId === null ? null : normalizeIdentifier(value.targetId, 'targetId'),
      resultTargetId: value.resultTargetId === null
        ? null
        : normalizeIdentifier(value.resultTargetId, 'resultTargetId')
    };
  } catch {
    return null;
  }
}

function collectStructuredMediaIdentities(input) {
  const youtubeVideoIds = new Set();
  const exactUrls = new Set();
  const addUrl = (value) => {
    if (!value) return;
    const youtubeVideoId = extractYouTubeVideoIdForProtection(value);
    if (youtubeVideoId) youtubeVideoIds.add(youtubeVideoId);
    exactUrls.add(value);
  };
  if (input.action === STRUCTURED_MEDIA_ACTIONS.SET
    && input.resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO) {
    TEAM_FIXED_VIDEO_URL_FIELDS.forEach((field) => addUrl(input.payload[field]));
    TEAM_FIXED_VIDEO_ID_FIELDS.forEach((field) => {
      if (input.payload[field]) youtubeVideoIds.add(input.payload[field]);
    });
  } else if (input.action === STRUCTURED_MEDIA_ACTIONS.CREATE
    && input.resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_MEDIA_VIDEO_LINK) {
    TEAM_MEDIA_VIDEO_LINK_URL_FIELDS.forEach((field) => addUrl(input.payload[field]));
  } else if (input.action === STRUCTURED_MEDIA_ACTIONS.SET
    && input.resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.DRILL_LIBRARY_VIDEO) {
    DRILL_LIBRARY_VIDEO_URL_FIELDS.forEach((field) => addUrl(input.payload[field]));
  }
  return { youtubeVideoIds, exactUrls };
}

function isDelegatedTeamMediaManager(team, uid) {
  const permission = team?.teamPermissions?.teamMediaManagement;
  return permission?.mode === 'selected'
    && Array.isArray(permission.memberIds)
    && permission.memberIds.includes(uid);
}

function validateProtectedIdentitySnapshot(snapshot, expectedRecord) {
  if (!snapshot.exists) return false;
  const identity = normalizeReplayProtectedIdentity(snapshot.data() || {});
  if (!identity
    || identity.kind !== expectedRecord.data.kind
    || identity.identityHash !== expectedRecord.data.identityHash
    || snapshot.ref?.path !== expectedRecord.path) {
    fail('failed-precondition', 'The protected replay identity index is unavailable for safe media updates.');
  }
  return true;
}

function validateClipIdentitySnapshot(snapshot, expectedRecord, { requireExists = false } = {}) {
  if (!snapshot.exists) {
    if (requireExists) {
      fail('failed-precondition', 'The replay clip identity index is unavailable for safe media updates.');
    }
    return;
  }
  const identity = normalizeReplayClipIdentity(snapshot.data() || {});
  if (!identity
    || identity.kind !== expectedRecord.data.kind
    || identity.identityHash !== expectedRecord.data.identityHash
    || snapshot.ref?.path !== expectedRecord.path) {
    fail('failed-precondition', 'The replay clip identity index is unavailable for safe media updates.');
  }
}

function validateMutationSnapshot(snapshot, expectedRecord) {
  if (!snapshot.exists) return null;
  const stored = normalizeStructuredMediaWriteMutationRecord(snapshot.data() || {});
  if (!stored || snapshot.ref?.path !== expectedRecord.path) {
    fail('failed-precondition', 'The structured media mutation receipt is unavailable for safe reconciliation.');
  }
  const expected = expectedRecord.data;
  if (stored.mutationId !== expected.mutationId
    || stored.resourceKind !== expected.resourceKind
    || stored.action !== expected.action
    || stored.teamId !== expected.teamId
    || stored.targetId !== expected.targetId) {
    fail('already-exists', 'This structured media mutation ID was already used for a different request.');
  }
  if (stored.requestHash !== expected.requestHash) {
    fail('already-exists', 'This structured media mutation ID was already used for a different request.');
  }
  return stored;
}

function buildStructuredMediaWriteResponse(input, targetId, resource) {
  return {
    version: STRUCTURED_MEDIA_WRITE_SCHEMA_VERSION,
    mutationId: input.mutationId,
    requestHash: input.requestHash,
    resourceKind: input.resourceKind,
    action: input.action,
    committed: true,
    targetId,
    resource
  };
}

function toHttpsError(error, HttpsError) {
  if (error instanceof HttpsError) return error;
  const supportedCodes = new Set([
    'aborted',
    'already-exists',
    'failed-precondition',
    'invalid-argument',
    'not-found',
    'permission-denied',
    'resource-exhausted',
    'unauthenticated',
    'unavailable'
  ]);
  const code = supportedCodes.has(error?.code) ? error.code : 'internal';
  return new HttpsError(code, error?.message || 'Structured media update failed.');
}

function createStructuredMediaWriteHandler({
  firestore,
  auth,
  FieldValue,
  HttpsError,
  hasTeamAdminAccess,
  assertSensitiveWrite
}) {
  if (!firestore || !auth || !FieldValue || !HttpsError
    || typeof hasTeamAdminAccess !== 'function'
    || typeof assertSensitiveWrite !== 'function') {
    throw new TypeError('Structured media write handler dependencies are required.');
  }
  return async function mutateStructuredMediaIdentity(data, context = {}) {
    const response = context?.rawRequest?.res;
    if (typeof response?.set === 'function') response.set('Cache-Control', 'private, no-store, max-age=0');
    if (typeof response?.setHeader === 'function') response.setHeader('Cache-Control', 'private, no-store, max-age=0');

    let uid;
    try {
      uid = normalizeIdentifier(context?.auth?.uid, 'uid');
    } catch {
      throw new HttpsError('unauthenticated', 'Sign in to update team media.');
    }
    let authUser;
    try {
      authUser = await auth.getUser(uid);
    } catch (error) {
      if (error?.code === 'auth/user-not-found') {
        throw new HttpsError('unauthenticated', 'The signed-in account no longer exists.');
      }
      throw new HttpsError('unavailable', 'The signed-in account could not be verified.');
    }
    if (!authUser || authUser.uid !== uid) {
      throw new HttpsError('unauthenticated', 'The signed-in account could not be verified.');
    }
    if (authUser.disabled === true) {
      throw new HttpsError('permission-denied', 'This account is disabled.');
    }

    await assertSensitiveWrite(context, 'mutate-structured-media-identity');

    let input;
    try {
      input = normalizeStructuredMediaWriteInput(data || {});
    } catch (error) {
      throw toHttpsError(error, HttpsError);
    }

    const resultTargetId = input.resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_MEDIA_VIDEO_LINK
      && input.action === STRUCTURED_MEDIA_ACTIONS.CREATE
      ? getStructuredMediaItemId(input.teamId, input.mutationId)
      : input.targetId;
    const teamRef = firestore.doc(`teams/${input.teamId}`);
    const userRef = firestore.doc(`users/${uid}`);
    const migrationControlRef = firestore.doc(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH);
    const boundaryControlRef = firestore.doc(ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH);
    const targetRef = input.resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO
      ? teamRef
      : input.resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_MEDIA_VIDEO_LINK
        ? firestore.doc(`teams/${input.teamId}/mediaItems/${resultTargetId}`)
        : firestore.doc(`drillLibrary/${resultTargetId}`);
    const folderRef = input.resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_MEDIA_VIDEO_LINK
      && input.action === STRUCTURED_MEDIA_ACTIONS.CREATE
      ? firestore.doc(`teams/${input.teamId}/mediaFolders/${input.payload.folderId}`)
      : null;
    const mutationRecord = getStructuredMediaWriteMutationRecord(input, resultTargetId);
    const mutationRef = firestore.doc(mutationRecord.path);
    const identities = collectStructuredMediaIdentities(input);
    const protectedRecords = [
      ...[...identities.youtubeVideoIds].sort()
        .map((videoId) => getReplayProtectedYouTubeIdentityRecord(videoId)),
      ...collectHighlightProtectedUrlIdentityRecords([...identities.exactUrls].sort())
    ];
    const protectedByPath = new Map(protectedRecords.map((record) => [record.path, record]));
    const clipRecords = [...identities.youtubeVideoIds].sort()
      .map((videoId) => getReplayClipYouTubeIdentityRecord(videoId));

    try {
      return await firestore.runTransaction(async (transaction) => {
        const refs = [teamRef, userRef, migrationControlRef, boundaryControlRef, mutationRef];
        if (targetRef.path !== teamRef.path) refs.push(targetRef);
        if (folderRef) refs.push(folderRef);
        const baseSnapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
        const snapshotsByPath = new Map(refs.map((ref, index) => [ref.path, baseSnapshots[index]]));
        const identitySnapshots = await Promise.all([
          ...[...protectedByPath.keys()].map((path) => transaction.get(firestore.doc(path))),
          ...clipRecords.map((record) => transaction.get(firestore.doc(record.path)))
        ]);
        const teamSnap = snapshotsByPath.get(teamRef.path);
        const userSnap = snapshotsByPath.get(userRef.path);
        const migrationControlSnap = snapshotsByPath.get(migrationControlRef.path);
        const boundaryControlSnap = snapshotsByPath.get(boundaryControlRef.path);
        const mutationSnap = snapshotsByPath.get(mutationRef.path);
        const targetSnap = snapshotsByPath.get(targetRef.path) || teamSnap;
        const folderSnap = folderRef ? snapshotsByPath.get(folderRef.path) : null;

        if (!teamSnap?.exists) throw new HttpsError('not-found', 'Team not found.');
        const finalizedBoundary = migrationControlSnap?.exists
          && isReplayArchiveMigrationReady(migrationControlSnap.data() || {})
          && boundaryControlSnap?.exists
          && isAthleteProfileProjectionBoundaryReady(boundaryControlSnap.data() || {});
        const compatibilityBoundary = !migrationControlSnap?.exists && !boundaryControlSnap?.exists;
        if (!finalizedBoundary && !compatibilityBoundary) {
          throw new HttpsError(
            'failed-precondition',
            'Structured media updates are temporarily unavailable while replay privacy is verified.'
          );
        }
        const team = teamSnap.data() || {};
        const user = userSnap?.exists ? userSnap.data() || {} : {};
        const canAdminTeam = hasTeamAdminAccess({
          team,
          user,
          uid,
          email: authUser.email
        });
        const canWrite = input.resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_MEDIA_VIDEO_LINK
          ? canAdminTeam || isDelegatedTeamMediaManager(team, uid)
          : canAdminTeam;
        if (!canWrite) {
          throw new HttpsError('permission-denied', 'You do not have permission to update this media.');
        }

        const protectedSnapshots = identitySnapshots.slice(0, protectedByPath.size);
        const clipSnapshots = identitySnapshots.slice(protectedByPath.size);
        const clipSnapshotsByPath = new Map(clipRecords.map((record, index) => [
          record.path,
          clipSnapshots[index]
        ]));
        const reservableClipRecords = finalizedBoundary ? clipRecords : [];
        const protectedPaths = [...protectedByPath.keys()];
        const containsProtectedReplay = protectedSnapshots.some((snapshot, index) => (
          validateProtectedIdentitySnapshot(snapshot, protectedByPath.get(protectedPaths[index]))
        ));
        if (containsProtectedReplay) {
          throw new HttpsError(
            'failed-precondition',
            'This YouTube video is already reserved as a protected game replay.'
          );
        }

        const storedMutation = validateMutationSnapshot(mutationSnap, mutationRecord);
        if (storedMutation) {
          reservableClipRecords.forEach((record) => {
            validateClipIdentitySnapshot(clipSnapshotsByPath.get(record.path), record, { requireExists: true });
          });
          const replayTargetId = storedMutation.resultTargetId;
          return buildStructuredMediaWriteResponse(
            input,
            replayTargetId,
            [STRUCTURED_MEDIA_ACTIONS.REMOVE, STRUCTURED_MEDIA_ACTIONS.DELETE].includes(input.action)
              ? null
              : { id: replayTargetId || input.teamId }
          );
        }
        reservableClipRecords.forEach((record) => {
          validateClipIdentitySnapshot(clipSnapshotsByPath.get(record.path), record);
        });

        const timestamp = FieldValue.serverTimestamp();
        if (input.resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO) {
          const patch = { updatedAt: timestamp };
          TEAM_FIXED_VIDEO_FIELDS.forEach((field) => {
            patch[field] = input.action === STRUCTURED_MEDIA_ACTIONS.REMOVE
              ? FieldValue.delete()
              : input.payload[field];
          });
          transaction.set(teamRef, patch, { merge: true });
        } else if (input.resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_MEDIA_VIDEO_LINK) {
          if (input.action === STRUCTURED_MEDIA_ACTIONS.CREATE) {
            if (targetSnap?.exists) {
              throw new HttpsError(
                'failed-precondition',
                'The team media item already exists without its mutation receipt.'
              );
            }
            if (!folderSnap?.exists) throw new HttpsError('not-found', 'Choose an existing album for this media link.');
            const folder = folderSnap.data() || {};
            const order = Number(folder.nextMediaOrder || 0);
            if (!Number.isSafeInteger(order) || order < 0) {
              throw new HttpsError('failed-precondition', 'The album media order is invalid.');
            }
            transaction.set(folderRef, {
              nextMediaOrder: order + 1,
              updatedAt: timestamp
            }, { merge: true });
            transaction.set(targetRef, {
              ...input.payload,
              order,
              deleted: false,
              createdAt: timestamp,
              updatedAt: timestamp
            });
          } else {
            if (!targetSnap?.exists) throw new HttpsError('not-found', 'Team media item not found.');
            const media = targetSnap.data() || {};
            const isVideoLink = TEAM_MEDIA_VIDEO_LINK_TYPE_FIELDS.some((field) => (
              TEAM_MEDIA_VIDEO_LINK_TYPES.includes(media[field])
            ));
            if (!isVideoLink) {
              throw new HttpsError('failed-precondition', 'Only video links can use this removal path.');
            }
            transaction.set(targetRef, {
              deleted: true,
              deletedAt: timestamp,
              deletedBy: uid,
              updatedAt: timestamp
            }, { merge: true });
          }
        } else {
          if (!targetSnap?.exists) throw new HttpsError('not-found', 'Drill not found.');
          const drill = targetSnap.data() || {};
          if (drill.source !== 'custom' || drill.teamId !== input.teamId) {
            throw new HttpsError('permission-denied', 'Only a custom drill for this team can be updated.');
          }
          if (input.action === STRUCTURED_MEDIA_ACTIONS.DELETE) {
            transaction.delete(targetRef);
          } else {
            const patch = { updatedAt: timestamp };
            DRILL_LIBRARY_VIDEO_FIELDS.forEach((field) => {
              patch[field] = input.action === STRUCTURED_MEDIA_ACTIONS.REMOVE
                ? FieldValue.delete()
                : input.payload[field];
            });
            transaction.set(targetRef, patch, { merge: true });
          }
        }

        reservableClipRecords.forEach((record) => {
          transaction.set(firestore.doc(record.path), record.data, { merge: false });
        });
        transaction.set(mutationRef, {
          ...mutationRecord.data,
          committedAt: timestamp
        });
        return buildStructuredMediaWriteResponse(
          input,
          resultTargetId,
          [STRUCTURED_MEDIA_ACTIONS.REMOVE, STRUCTURED_MEDIA_ACTIONS.DELETE].includes(input.action)
            ? null
            : { id: resultTargetId || input.teamId }
        );
      });
    } catch (error) {
      throw toHttpsError(error, HttpsError);
    }
  };
}

module.exports = {
  DRILL_LIBRARY_VIDEO_FIELDS,
  STRUCTURED_MEDIA_ACTIONS,
  STRUCTURED_MEDIA_RESOURCE_KINDS,
  STRUCTURED_MEDIA_WRITE_HASH_PREFIX,
  STRUCTURED_MEDIA_WRITE_MUTATION_COLLECTION,
  STRUCTURED_MEDIA_WRITE_MUTATION_SCHEMA,
  STRUCTURED_MEDIA_WRITE_SCHEMA_VERSION,
  TEAM_FIXED_VIDEO_FIELDS,
  TEAM_MEDIA_CREATE_FIELDS,
  collectStructuredMediaIdentities,
  createStructuredMediaWriteHandler,
  getStructuredMediaItemId,
  getStructuredMediaWriteMutationRecord,
  getStructuredMediaWriteRequestHash,
  normalizeStructuredMediaWriteInput,
  normalizeStructuredMediaWriteMutationRecord
};
