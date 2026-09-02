'use strict';

const crypto = require('node:crypto');
const {
  REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH,
  getReplayClipYouTubeIdentityRecord,
  getReplayProtectedUrlIdentityRecord,
  getReplayProtectedYouTubeIdentityRecord,
  getReplayUrlIdentityCandidates,
  extractYouTubeVideoIdForProtection,
  isReplayArchiveMigrationReady,
  normalizeReplayClipIdentity,
  normalizeReplayProtectedIdentity
} = require('./replay-private-archive-core.cjs');

const ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION = 1;
const ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH =
  'systemControls/replayAthleteProfileProjectionBoundary';
const ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_SCHEMA =
  'replay-athlete-profile-projection-boundary';
const ATHLETE_PROFILE_PROJECTION_MUTATION_SCHEMA =
  'athlete-profile-projection-mutation';
const ATHLETE_PROFILE_PROJECTION_MUTATION_COLLECTION =
  'athleteProfileProjectionMutations';

const MAX_PROFILE_SEASONS = 100;
const MAX_INTENTIONAL_CLIPS = 100;
const MAX_GENERATED_CLIPS = 1_000;
const MAX_GENERATED_IDENTITIES = 128;
const MAX_PROFILE_NODES = 20_000;
const MAX_PROFILE_DEPTH = 12;
const MAX_PROFILE_STRING_BYTES = 512 * 1_024;
const MAX_PROFILE_SERIALIZED_BYTES = 768 * 1_024;
const MAX_VALUE_STRING_LENGTH = 8_192;
const MAX_OBJECT_KEYS = 128;
const MAX_GENERIC_ARRAY_LENGTH = 1_000;

const PROFILE_FIELDS = Object.freeze([
  'athlete',
  'bio',
  'privacy',
  'clips',
  'gameClips',
  'seasons',
  'careerSummary',
  'profilePhotoUrl',
  'profilePhotoPath',
  'profilePhotoMimeType',
  'profilePhotoSizeBytes',
  'profilePhotoUploadedAtMs'
]);

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

function cloneBoundedJson(value, state = { nodes: 0, stringBytes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > MAX_PROFILE_NODES || depth > MAX_PROFILE_DEPTH) {
    fail('invalid-argument', 'Athlete profile data is too complex.');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    fail('invalid-argument', 'Athlete profile data contains an invalid number.');
  }
  if (typeof value === 'string') {
    const byteLength = Buffer.byteLength(value, 'utf8');
    state.stringBytes += byteLength;
    if (value.length <= MAX_VALUE_STRING_LENGTH
      && state.stringBytes <= MAX_PROFILE_STRING_BYTES) return value;
    fail('invalid-argument', 'Athlete profile text is too large.');
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_GENERIC_ARRAY_LENGTH) {
      fail('invalid-argument', 'Athlete profile data contains too many list entries.');
    }
    return value.map((entry) => cloneBoundedJson(entry, state, depth + 1));
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value);
    if (entries.length > MAX_OBJECT_KEYS
      || entries.some(([key]) => !key
        || key.length > 128
        || ['__proto__', 'prototype', 'constructor'].includes(key))) {
      fail('invalid-argument', 'Athlete profile data contains invalid fields.');
    }
    return Object.fromEntries(entries.map(([key, entry]) => [
      key,
      cloneBoundedJson(entry, state, depth + 1)
    ]));
  }
  fail('invalid-argument', 'Athlete profile data contains an unsupported value.');
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value)
    .sort()
    .map((key) => [key, stableJsonValue(value[key])]));
}

function getAthleteProfileProjectionRequestHash(profileId, profile) {
  const canonical = JSON.stringify(stableJsonValue({ profileId, profile }));
  return crypto
    .createHash('sha256')
    .update(`athlete-profile-projection-v${ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION}:${canonical}`)
    .digest('hex');
}

function normalizeAthleteProfileProjection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid-argument', 'profile is required.');
  }
  const unknownFields = Object.keys(value).filter((field) => !PROFILE_FIELDS.includes(field));
  if (unknownFields.length) {
    fail('invalid-argument', 'Athlete profile data contains unsupported top-level fields.');
  }
  if (!PROFILE_FIELDS.every((field) => hasOwn(value, field))) {
    fail('invalid-argument', 'Athlete profile data is incomplete.');
  }
  const profile = cloneBoundedJson(value);
  if (Buffer.byteLength(JSON.stringify(profile), 'utf8') > MAX_PROFILE_SERIALIZED_BYTES) {
    fail('resource-exhausted', 'Athlete profile data exceeds the maximum stored size.');
  }
  if (!profile.athlete || typeof profile.athlete !== 'object' || Array.isArray(profile.athlete)
    || !profile.bio || typeof profile.bio !== 'object' || Array.isArray(profile.bio)
    || !profile.careerSummary || typeof profile.careerSummary !== 'object'
    || Array.isArray(profile.careerSummary)) {
    fail('invalid-argument', 'Athlete profile summary data is invalid.');
  }
  if (!['private', 'public'].includes(profile.privacy)) {
    fail('invalid-argument', 'Athlete profile privacy is invalid.');
  }
  if (!Array.isArray(profile.clips) || profile.clips.length > MAX_INTENTIONAL_CLIPS) {
    fail('invalid-argument', `An athlete profile can store at most ${MAX_INTENTIONAL_CLIPS} intentional clips.`);
  }
  if (!Array.isArray(profile.gameClips)) {
    fail('invalid-argument', 'Athlete profile game clips are invalid.');
  }
  if (!Array.isArray(profile.seasons) || profile.seasons.length > MAX_PROFILE_SEASONS) {
    fail('invalid-argument', `An athlete profile can store at most ${MAX_PROFILE_SEASONS} seasons.`);
  }
  let generatedClipCount = profile.gameClips.length;
  const flattened = [];
  profile.seasons.forEach((season) => {
    if (!season || typeof season !== 'object' || Array.isArray(season)
      || !Array.isArray(season.gameClips)) {
      fail('invalid-argument', 'Athlete profile season game clips are invalid.');
    }
    generatedClipCount += season.gameClips.length;
    flattened.push(...season.gameClips);
  });
  if (generatedClipCount > MAX_GENERATED_CLIPS) {
    fail('resource-exhausted', `An athlete profile can store at most ${MAX_GENERATED_CLIPS} generated clip entries.`);
  }
  if (JSON.stringify(stableJsonValue(flattened))
    !== JSON.stringify(stableJsonValue(profile.gameClips))) {
    fail('invalid-argument', 'Athlete profile game clips do not match their season summaries.');
  }
  return profile;
}

function addProfileMediaIdentityValue(value, key, identities, state, depth = 0) {
  state.nodes += 1;
  if (state.nodes > MAX_PROFILE_NODES || depth > MAX_PROFILE_DEPTH) {
    fail('invalid-argument', 'Athlete profile media is too complex.');
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return;
    const youtubeVideoId = extractYouTubeVideoIdForProtection(trimmed);
    if (youtubeVideoId) identities.youtubeVideoIds.add(youtubeVideoId);
    if (key === 'videoId' && /^[A-Za-z0-9_-]{11}$/.test(trimmed) && trimmed !== 'live_stream') {
      identities.youtubeVideoIds.add(trimmed);
    }
    getReplayUrlIdentityCandidates(trimmed).forEach((candidate) => {
      identities.exactUrls.add(candidate);
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => addProfileMediaIdentityValue(entry, '', identities, state, depth + 1));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.entries(value).forEach(([childKey, entry]) => {
    addProfileMediaIdentityValue(entry, childKey, identities, state, depth + 1);
  });
}

function collectGeneratedProfileMediaIdentities(profile) {
  const intentionalIdentities = {
    youtubeVideoIds: new Set(),
    exactUrls: new Set()
  };
  const generatedIdentities = {
    youtubeVideoIds: new Set(),
    exactUrls: new Set()
  };
  const state = { nodes: 0 };
  addProfileMediaIdentityValue(profile.clips, '', intentionalIdentities, state);
  addProfileMediaIdentityValue(profile.gameClips, '', generatedIdentities, state);
  profile.seasons.forEach((season) => {
    addProfileMediaIdentityValue(season.gameClips, '', generatedIdentities, state);
  });
  const identities = {
    youtubeVideoIds: new Set([
      ...intentionalIdentities.youtubeVideoIds,
      ...generatedIdentities.youtubeVideoIds
    ]),
    exactUrls: new Set([
      ...intentionalIdentities.exactUrls,
      ...generatedIdentities.exactUrls
    ]),
    intentionalYouTubeVideoIds: intentionalIdentities.youtubeVideoIds,
    intentionalExactUrls: intentionalIdentities.exactUrls,
    generatedYouTubeVideoIds: generatedIdentities.youtubeVideoIds,
    generatedExactUrls: generatedIdentities.exactUrls
  };
  if (identities.youtubeVideoIds.size + identities.exactUrls.size > MAX_GENERATED_IDENTITIES) {
    fail('resource-exhausted', `Athlete profile media can reference at most ${MAX_GENERATED_IDENTITIES} unique identities.`);
  }
  return identities;
}

function normalizeAthleteProfileProjectionInput(data = {}) {
  const profileId = normalizeIdentifier(data.profileId, 'profileId');
  const mutationId = normalizeIdentifier(data.mutationId, 'mutationId');
  const requestHash = normalizeRequestHash(data.requestHash);
  const profile = normalizeAthleteProfileProjection(data.profile);
  const expectedHash = getAthleteProfileProjectionRequestHash(profileId, profile);
  if (requestHash !== expectedHash) {
    fail('invalid-argument', 'requestHash does not match the athlete profile projection.');
  }
  return {
    profileId,
    mutationId,
    requestHash,
    profile,
    identities: collectGeneratedProfileMediaIdentities(profile)
  };
}

function getAthleteProfileProjectionMutationRecord({
  profileId,
  mutationId,
  requestHash
}) {
  const normalizedProfileId = normalizeIdentifier(profileId, 'profileId');
  const normalizedMutationId = normalizeIdentifier(mutationId, 'mutationId');
  const normalizedRequestHash = normalizeRequestHash(requestHash);
  const digest = crypto
    .createHash('sha256')
    .update(`athlete-profile-projection-mutation:${normalizedProfileId}\0${normalizedMutationId}`)
    .digest('hex');
  return {
    path: `${ATHLETE_PROFILE_PROJECTION_MUTATION_COLLECTION}/${digest}`,
    data: {
      schema: ATHLETE_PROFILE_PROJECTION_MUTATION_SCHEMA,
      version: ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION,
      profileId: normalizedProfileId,
      mutationId: normalizedMutationId,
      requestHash: normalizedRequestHash
    }
  };
}

function normalizeAthleteProfileProjectionMutationRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== ATHLETE_PROFILE_PROJECTION_MUTATION_SCHEMA
    || value.version !== ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION) return null;
  try {
    return {
      profileId: normalizeIdentifier(value.profileId, 'profileId'),
      mutationId: normalizeIdentifier(value.mutationId, 'mutationId'),
      requestHash: normalizeRequestHash(value.requestHash)
    };
  } catch {
    return null;
  }
}

function normalizeAthleteProfileProjectionBoundaryControl(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_SCHEMA
    || value.version !== ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION
    || value.status !== 'ready') return null;
  return {
    schema: value.schema,
    version: value.version,
    status: value.status
  };
}

function isAthleteProfileProjectionBoundaryReady(value) {
  return Boolean(normalizeAthleteProfileProjectionBoundaryControl(value));
}

function getStoredMutation(profile = {}) {
  if (profile.profileProjectionSchemaVersion !== ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION
    || typeof profile.profileProjectionMutationId !== 'string'
    || typeof profile.profileProjectionMutationHash !== 'string') return null;
  try {
    return {
      mutationId: normalizeIdentifier(profile.profileProjectionMutationId, 'profileProjectionMutationId'),
      requestHash: normalizeRequestHash(profile.profileProjectionMutationHash)
    };
  } catch {
    return null;
  }
}

function getStoredProjectionRequestHash(profileId, profile = {}) {
  if (!PROFILE_FIELDS.every((field) => hasOwn(profile, field))) return null;
  try {
    const projection = Object.fromEntries(PROFILE_FIELDS.map((field) => [field, profile[field]]));
    return getAthleteProfileProjectionRequestHash(
      profileId,
      normalizeAthleteProfileProjection(projection)
    );
  } catch {
    return null;
  }
}

function serializeAthleteProfileProjection(profileId, profile) {
  const projected = {};
  PROFILE_FIELDS.forEach((field) => {
    if (hasOwn(profile, field)) projected[field] = cloneBoundedJson(profile[field]);
  });
  const mutation = getStoredMutation(profile);
  return {
    id: profileId,
    ...projected,
    profileProjectionSchemaVersion: mutation
      ? ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION
      : null,
    profileProjectionMutationId: mutation?.mutationId || null,
    profileProjectionMutationHash: mutation?.requestHash || null
  };
}

function validateProtectedIdentitySnapshot(snapshot, expectedRecord) {
  if (!snapshot.exists) return false;
  const identity = normalizeReplayProtectedIdentity(snapshot.data() || {});
  const matchesExpectedIdentity = identity?.kind === expectedRecord.data.kind
    && identity.identityHash === expectedRecord.data.identityHash;
  if (!matchesExpectedIdentity || snapshot.ref?.path !== expectedRecord.path) {
    fail('failed-precondition', 'The protected replay identity index is unavailable for safe profile updates.');
  }
  return true;
}

function validateClipIdentitySnapshot(snapshot, expectedRecord, { requireExists = false } = {}) {
  if (!snapshot.exists) {
    if (requireExists) {
      fail('failed-precondition', 'The replay clip identity index is unavailable for safe profile updates.');
    }
    return;
  }
  const identity = normalizeReplayClipIdentity(snapshot.data() || {});
  if (!identity
    || identity.kind !== expectedRecord.data.kind
    || identity.identityHash !== expectedRecord.data.identityHash
    || snapshot.ref?.path !== expectedRecord.path) {
    fail('failed-precondition', 'The replay clip identity index is unavailable for safe profile updates.');
  }
}

function validateMutationReceiptSnapshot(snapshot, expectedRecord) {
  if (!snapshot.exists) return null;
  const receipt = normalizeAthleteProfileProjectionMutationRecord(snapshot.data() || {});
  if (!receipt
    || receipt.profileId !== expectedRecord.data.profileId
    || receipt.mutationId !== expectedRecord.data.mutationId
    || snapshot.ref?.path !== expectedRecord.path) {
    fail('failed-precondition', 'The athlete profile mutation receipt is unavailable for safe reconciliation.');
  }
  return receipt;
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
  return new HttpsError(code, error?.message || 'Athlete profile save failed.');
}

function createAthleteProfileProjectionSaveHandler({
  firestore,
  auth,
  FieldValue,
  HttpsError,
  assertSensitiveWrite
}) {
  if (!firestore || !auth || !FieldValue || !HttpsError || typeof assertSensitiveWrite !== 'function') {
    throw new TypeError('Athlete profile projection handler dependencies are required.');
  }
  return async function saveAthleteProfileProjection(data, context = {}) {
    const response = context?.rawRequest?.res;
    if (typeof response?.set === 'function') response.set('Cache-Control', 'private, no-store, max-age=0');
    if (typeof response?.setHeader === 'function') response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    let uid;
    try {
      uid = normalizeIdentifier(context?.auth?.uid, 'uid');
    } catch {
      throw new HttpsError('unauthenticated', 'Sign in to save an athlete profile.');
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

    await assertSensitiveWrite(context, 'save-athlete-profile-projection');

    let input;
    try {
      input = normalizeAthleteProfileProjectionInput(data || {});
    } catch (error) {
      throw toHttpsError(error, HttpsError);
    }

    const profileRef = firestore.doc(`athleteProfiles/${input.profileId}`);
    const migrationControlRef = firestore.doc(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH);
    const boundaryControlRef = firestore.doc(ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH);
    const mutationRecord = getAthleteProfileProjectionMutationRecord(input);
    const mutationRef = firestore.doc(mutationRecord.path);
    const protectedRecords = [
      ...[...input.identities.youtubeVideoIds]
        .sort()
        .map((videoId) => getReplayProtectedYouTubeIdentityRecord(videoId)),
      ...[...input.identities.exactUrls]
        .sort()
        .map((exactUrl) => getReplayProtectedUrlIdentityRecord(exactUrl))
    ];
    const protectedByPath = new Map(protectedRecords.map((record) => [record.path, record]));
    const clipRecords = [...input.identities.youtubeVideoIds]
      .sort()
      .map((videoId) => getReplayClipYouTubeIdentityRecord(videoId));

    try {
      return await firestore.runTransaction(async (transaction) => {
        const [
          profileSnap,
          migrationControlSnap,
          boundaryControlSnap,
          mutationSnap,
          ...identitySnaps
        ] = await Promise.all([
          transaction.get(profileRef),
          transaction.get(migrationControlRef),
          transaction.get(boundaryControlRef),
          transaction.get(mutationRef),
          ...[...protectedByPath.keys()].map((path) => transaction.get(firestore.doc(path))),
          ...clipRecords.map((record) => transaction.get(firestore.doc(record.path)))
        ]);
        if (!profileSnap.exists) {
          throw new HttpsError(
            'failed-precondition',
            'Reserve this athlete profile before saving it.'
          );
        }
        const existing = profileSnap.data() || {};
        if (existing.parentUserId !== uid) {
          throw new HttpsError('permission-denied', 'You do not have permission to edit this athlete profile.');
        }
        const compatibilityBoundary = !migrationControlSnap.exists && !boundaryControlSnap.exists;
        const finalizedBoundary = migrationControlSnap.exists
          && boundaryControlSnap.exists
          && isReplayArchiveMigrationReady(migrationControlSnap.data() || {})
          && isAthleteProfileProjectionBoundaryReady(boundaryControlSnap.data() || {});
        if (!compatibilityBoundary && !finalizedBoundary) {
          throw new HttpsError(
            'failed-precondition',
            'Athlete profile media updates are temporarily unavailable while replay privacy is verified.'
          );
        }

        const hasSavedProjection = hasOwn(existing, 'athlete')
          || Array.isArray(existing.seasons)
          || existing.profileProjectionSchemaVersion === ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION;
        if (!hasSavedProjection && existing.mediaUploadReservation !== true) {
          throw new HttpsError(
            'failed-precondition',
            'Reserve this athlete profile before saving it.'
          );
        }

        const storedMutation = getStoredMutation(existing);
        const storedReceipt = validateMutationReceiptSnapshot(mutationSnap, mutationRecord);
        const protectedSnapshots = identitySnaps.slice(0, protectedByPath.size);
        const clipSnapshots = identitySnaps.slice(protectedByPath.size);
        const clipSnapshotsByPath = new Map(clipRecords.map((record, index) => [
          record.path,
          clipSnapshots[index]
        ]));
        // Before the migration controls exist, legacy readable replay aliases
        // may still overlap either intentional or generated profile media.
        // Let the migration adjudicate the complete inventory before creating
        // any permanent clip exclusion record.
        const reservableClipRecords = finalizedBoundary ? clipRecords : [];
        const protectedPaths = [...protectedByPath.keys()];
        const containsProtectedReplay = protectedSnapshots.some((snapshot, index) => (
          validateProtectedIdentitySnapshot(snapshot, protectedByPath.get(protectedPaths[index]))
        ));
        if (containsProtectedReplay) {
          throw new HttpsError(
            'failed-precondition',
            'Athlete profile media contains a protected game replay.'
          );
        }
        if (storedReceipt) {
          if (storedReceipt.requestHash !== input.requestHash) {
            throw new HttpsError(
              'already-exists',
              'This athlete profile mutation ID was already used for a different request.'
            );
          }
          if (storedMutation?.mutationId !== input.mutationId
            || storedMutation.requestHash !== input.requestHash) {
            throw new HttpsError(
              'failed-precondition',
              'This athlete profile mutation was already committed and later superseded.'
            );
          }
          if (getStoredProjectionRequestHash(input.profileId, existing) !== input.requestHash) {
            throw new HttpsError(
              'failed-precondition',
              'The stored athlete profile does not match its mutation marker.'
            );
          }
          reservableClipRecords.forEach((record) => {
            validateClipIdentitySnapshot(clipSnapshotsByPath.get(record.path), record, { requireExists: true });
          });
          return { profile: serializeAthleteProfileProjection(input.profileId, existing) };
        }
        if (storedMutation?.mutationId === input.mutationId) {
          throw new HttpsError(
            'failed-precondition',
            'The athlete profile mutation receipt is unavailable for safe reconciliation.'
          );
        }
        reservableClipRecords.forEach((record) => {
          validateClipIdentitySnapshot(clipSnapshotsByPath.get(record.path), record);
        });

        const timestamp = FieldValue.serverTimestamp();
        const write = {
          ...input.profile,
          parentUserId: uid,
          mediaUploadReservation: FieldValue.delete(),
          profileProjectionSchemaVersion: ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION,
          profileProjectionMutationId: input.mutationId,
          profileProjectionMutationHash: input.requestHash,
          updatedAt: timestamp,
          ...(!hasSavedProjection ? { createdAt: timestamp } : {})
        };
        reservableClipRecords.forEach((record) => {
          transaction.set(firestore.doc(record.path), {
            ...record.data,
            updatedAt: timestamp
          }, { merge: false });
        });
        transaction.set(mutationRef, {
          ...mutationRecord.data,
          committedAt: timestamp
        }, { merge: false });
        transaction.set(profileRef, write, { merge: true });
        return {
          profile: serializeAthleteProfileProjection(input.profileId, {
            ...existing,
            ...input.profile,
            profileProjectionSchemaVersion: ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION,
            profileProjectionMutationId: input.mutationId,
            profileProjectionMutationHash: input.requestHash
          })
        };
      });
    } catch (error) {
      throw toHttpsError(error, HttpsError);
    }
  };
}

module.exports = {
  ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH,
  ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_SCHEMA,
  ATHLETE_PROFILE_PROJECTION_MUTATION_COLLECTION,
  ATHLETE_PROFILE_PROJECTION_MUTATION_SCHEMA,
  ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION,
  MAX_GENERATED_IDENTITIES,
  MAX_GENERATED_CLIPS,
  MAX_INTENTIONAL_CLIPS,
  MAX_PROFILE_SEASONS,
  MAX_PROFILE_SERIALIZED_BYTES,
  PROFILE_FIELDS,
  collectGeneratedProfileMediaIdentities,
  createAthleteProfileProjectionSaveHandler,
  getAthleteProfileProjectionMutationRecord,
  getAthleteProfileProjectionRequestHash,
  isAthleteProfileProjectionBoundaryReady,
  normalizeAthleteProfileProjection,
  normalizeAthleteProfileProjectionBoundaryControl,
  normalizeAthleteProfileProjectionInput,
  normalizeAthleteProfileProjectionMutationRecord,
  serializeAthleteProfileProjection
};
