'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH,
  ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_SCHEMA,
  ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION,
  MAX_GENERATED_IDENTITIES,
  MAX_PROFILE_SERIALIZED_BYTES,
  collectGeneratedProfileMediaIdentities,
  createAthleteProfileProjectionSaveHandler,
  getAthleteProfileProjectionRequestHash,
  getAthleteProfileProjectionMutationRecord,
  normalizeAthleteProfileProjectionInput
} = require('../athlete-profile-projection-core.cjs');
const {
  REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH,
  REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
  getReplayClipYouTubeIdentityRecord,
  getReplayProtectedUrlIdentityRecord,
  getReplayProtectedYouTubeIdentityRecord
} = require('../replay-private-archive-core.cjs');

class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function makeFirestore(seed = {}) {
  const state = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  const isDelete = (value) => value?.__op === 'delete';

  function applyWrite(path, value, { merge = false } = {}) {
    const next = merge ? clone(state.get(path) || {}) : {};
    Object.entries(value || {}).forEach(([key, entry]) => {
      if (isDelete(entry)) delete next[key];
      else next[key] = clone(entry);
    });
    state.set(path, next);
  }

  function doc(path) {
    const ref = {
      path,
      async get() {
        const value = state.get(path);
        return {
          exists: value !== undefined,
          ref,
          data: () => clone(value)
        };
      }
    };
    return ref;
  }

  return {
    doc,
    async runTransaction(operation) {
      const writes = [];
      const transaction = {
        get: (ref) => ref.get(),
        set(ref, value, options) {
          writes.push(() => applyWrite(ref.path, value, options || {}));
        }
      };
      const result = await operation(transaction);
      writes.forEach((write) => write());
      return result;
    },
    snapshot(path) {
      return clone(state.get(path));
    }
  };
}

function readyMigrationControl() {
  return {
    schema: REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
    version: 1,
    status: 'ready',
    attemptId: 'migration:11111111-1111-4111-8111-111111111111'
  };
}

function readyProfileBoundary() {
  return {
    schema: ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_SCHEMA,
    version: ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION,
    status: 'ready'
  };
}

function baseProfile(overrides = {}) {
  const seasonClip = {
    id: 'game-1-clip-1',
    source: 'game',
    title: 'Score-linked clip',
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
    gameId: 'game-1'
  };
  return {
    athlete: { name: 'Athlete One', headline: 'Guard' },
    bio: {
      hometown: 'Chicago',
      graduationYear: '2030',
      position: 'G',
      dominantHand: 'Right',
      achievements: ''
    },
    privacy: 'public',
    clips: [{
      id: 'intentional-1',
      source: 'external',
      mediaType: 'link',
      title: 'Intentional profile clip',
      url: 'https://youtu.be/zyxwvutsrqp'
    }],
    gameClips: [seasonClip],
    seasons: [{
      seasonKey: 'team-1::player-1',
      teamId: 'team-1',
      teamName: 'Team One',
      playerId: 'player-1',
      playerName: 'Athlete One',
      playerPhotoUrl: null,
      gamesPlayed: 1,
      totalTimeMs: 60_000,
      statTotals: { points: 2 },
      gameClips: [seasonClip]
    }],
    careerSummary: {
      gamesPlayed: 1,
      totalMinutes: 1,
      statTotals: { points: 2 },
      statAverages: { points: '2.0' }
    },
    profilePhotoUrl: null,
    profilePhotoPath: null,
    profilePhotoMimeType: null,
    profilePhotoSizeBytes: null,
    profilePhotoUploadedAtMs: null,
    ...overrides
  };
}

function requestFor(profile = baseProfile(), overrides = {}) {
  const profileId = overrides.profileId || 'profile-1';
  return {
    profileId,
    mutationId: '11111111-1111-4111-8111-111111111111',
    requestHash: getAthleteProfileProjectionRequestHash(profileId, profile),
    profile,
    ...overrides
  };
}

function mutationReceiptFor(request) {
  return getAthleteProfileProjectionMutationRecord(request);
}

function makeHandler({ seed = {}, authUsers = {}, assertSensitiveWrite = async () => {} } = {}) {
  const firestore = makeFirestore({
    [REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH]: readyMigrationControl(),
    [ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH]: readyProfileBoundary(),
    'athleteProfiles/profile-1': {
      parentUserId: 'parent-1',
      mediaUploadReservation: true
    },
    ...seed
  });
  const auth = {
    async getUser(uid) {
      if (Object.prototype.hasOwnProperty.call(authUsers, uid)) {
        const configured = authUsers[uid];
        if (!configured) {
          throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
        }
        return { uid, ...configured };
      }
      return { uid, disabled: false, email: `${uid}@example.test` };
    }
  };
  const FieldValue = {
    serverTimestamp: () => ({ __op: 'serverTimestamp' }),
    delete: () => ({ __op: 'delete' })
  };
  return {
    firestore,
    handler: createAthleteProfileProjectionSaveHandler({
      firestore,
      auth,
      FieldValue,
      HttpsError,
      assertSensitiveWrite
    })
  };
}

function context(uid = 'parent-1') {
  return { auth: uid ? { uid } : null };
}

test('normalization hashes a bounded exact projection and rejects mismatched generated summaries', () => {
  const input = requestFor();
  assert.deepEqual(normalizeAthleteProfileProjectionInput(input).profile, input.profile);
  assert.match(input.requestHash, /^[a-f0-9]{64}$/);

  const mismatched = baseProfile({ gameClips: [] });
  assert.throws(
    () => normalizeAthleteProfileProjectionInput(requestFor(mismatched)),
    /do not match their season summaries/
  );
  assert.throws(
    () => normalizeAthleteProfileProjectionInput({ ...input, requestHash: '0'.repeat(64) }),
    /does not match/
  );
});

test('normalization enforces a serialized document-size bound in addition to node and string limits', () => {
  const wideObject = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [
    `${String(index).padStart(3, '0')}-${'k'.repeat(120)}`,
    index
  ]));
  const oversized = baseProfile({
    careerSummary: {
      rows: Array.from({ length: 100 }, () => ({ ...wideObject }))
    }
  });
  assert.ok(Buffer.byteLength(JSON.stringify(oversized), 'utf8') > MAX_PROFILE_SERIALIZED_BYTES);
  assert.throws(
    () => normalizeAthleteProfileProjectionInput(requestFor(oversized)),
    /maximum stored size/
  );
});

test('identity inventory scans intentional and generated athlete profile clips', () => {
  const identities = collectGeneratedProfileMediaIdentities(baseProfile());
  assert.deepEqual([...identities.youtubeVideoIds], ['zyxwvutsrqp', 'abcdefghijk']);
  assert.deepEqual([...identities.intentionalYouTubeVideoIds], ['zyxwvutsrqp']);
  assert.deepEqual([...identities.generatedYouTubeVideoIds], ['abcdefghijk']);
});

test('identity inventory and ready writes reserve historical HTTP and default-port YouTube aliases', async () => {
  const aliases = [
    { id: 'http-alias', url: 'http://youtu.be/lmnopqrstuv' },
    { id: 'default-port-alias', url: 'https://www.youtube.com:443/watch?v=wxyzABCDE12' }
  ];
  const profile = baseProfile({ clips: aliases });
  const identities = collectGeneratedProfileMediaIdentities(profile);
  assert.deepEqual(
    [...identities.intentionalYouTubeVideoIds],
    ['lmnopqrstuv', 'wxyzABCDE12']
  );

  const { handler, firestore } = makeHandler();
  await handler(requestFor(profile), context());
  for (const videoId of ['lmnopqrstuv', 'wxyzABCDE12']) {
    const identity = getReplayClipYouTubeIdentityRecord(videoId);
    assert.deepEqual(firestore.snapshot(identity.path), {
      ...identity.data,
      updatedAt: { __op: 'serverTimestamp' }
    });
  }
});

test('identity inventory is deterministically bounded', () => {
  const gameClips = Array.from({ length: MAX_GENERATED_IDENTITIES + 1 }, (_, index) => ({
    url: `https://media.example.test/${index}`
  }));
  const profile = baseProfile({
    gameClips,
    seasons: [{ ...baseProfile().seasons[0], gameClips }]
  });
  assert.throws(
    () => normalizeAthleteProfileProjectionInput(requestFor(profile)),
    /unique identities/
  );
});

test('callable requires a current enabled Auth user and an existing owner-bound reservation', async () => {
  const { handler } = makeHandler();
  await assert.rejects(handler(requestFor(), context(null)), { code: 'unauthenticated' });

  const disabled = makeHandler({ authUsers: { 'parent-1': { disabled: true } } });
  await assert.rejects(disabled.handler(requestFor(), context()), { code: 'permission-denied' });

  const missing = makeHandler({ seed: { 'athleteProfiles/profile-1': undefined } });
  await assert.rejects(missing.handler(requestFor(), context()), { code: 'failed-precondition' });

  const unreservedCreate = makeHandler({
    seed: { 'athleteProfiles/profile-1': { parentUserId: 'parent-1' } }
  });
  await assert.rejects(
    unreservedCreate.handler(requestFor(), context()),
    { code: 'failed-precondition', message: 'Reserve this athlete profile before saving it.' }
  );

  const otherOwner = makeHandler({
    seed: { 'athleteProfiles/profile-1': { parentUserId: 'other-parent' } }
  });
  await assert.rejects(otherOwner.handler(requestFor(), context()), { code: 'permission-denied' });
});

test('callable enforces the shared verified-email sensitive-write boundary before Firestore mutation', async () => {
  const calls = [];
  const denied = makeHandler({
    assertSensitiveWrite: async (receivedContext, operation) => {
      calls.push({ receivedContext, operation });
      throw new HttpsError('failed-precondition', 'Verify your email before completing this action.');
    }
  });
  const deniedContext = {
    auth: {
      uid: 'parent-1',
      token: { email: 'parent@example.test', email_verified: false }
    }
  };

  await assert.rejects(
    denied.handler(requestFor(), deniedContext),
    { code: 'failed-precondition' }
  );
  assert.deepEqual(calls, [{
    receivedContext: deniedContext,
    operation: 'save-athlete-profile-projection'
  }]);
  assert.equal(denied.firestore.snapshot(mutationReceiptFor(requestFor()).path), undefined);
});

test('callable accepts exact compatibility absence or exact ready and blocks partial, migrating, or malformed controls', async () => {
  const compatibility = makeHandler({
    seed: {
      [REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH]: undefined,
      [ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH]: undefined
    }
  });
  const compatibilityRequest = requestFor();
  await assert.doesNotReject(compatibility.handler(compatibilityRequest, context()));
  for (const videoId of ['zyxwvutsrqp', 'abcdefghijk']) {
    assert.equal(
      compatibility.firestore.snapshot(getReplayClipYouTubeIdentityRecord(videoId).path),
      undefined
    );
  }

  const compatibilityReceipt = mutationReceiptFor(compatibilityRequest);
  const finalizedRetry = makeHandler({
    seed: {
      'athleteProfiles/profile-1': compatibility.firestore.snapshot('athleteProfiles/profile-1'),
      [compatibilityReceipt.path]: compatibility.firestore.snapshot(compatibilityReceipt.path)
    }
  });
  await assert.rejects(
    finalizedRetry.handler(compatibilityRequest, context()),
    {
      code: 'failed-precondition',
      message: 'The replay clip identity index is unavailable for safe profile updates.'
    }
  );

  const noMigration = makeHandler({
    seed: { [REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH]: undefined }
  });
  await assert.rejects(noMigration.handler(requestFor(), context()), { code: 'failed-precondition' });

  const noBoundary = makeHandler({
    seed: { [ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH]: undefined }
  });
  await assert.rejects(noBoundary.handler(requestFor(), context()), { code: 'failed-precondition' });

  for (const migrationControl of [
    {
      schema: REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
      version: 1,
      status: 'migrating',
      attemptId: 'migration:22222222-2222-4222-8222-222222222222'
    },
    { status: 'ready' }
  ]) {
    const blocked = makeHandler({
      seed: { [REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH]: migrationControl }
    });
    await assert.rejects(blocked.handler(requestFor(), context()), { code: 'failed-precondition' });
  }
});

test('callable rejects protected generated replay identities without changing the reserved profile', async () => {
  const protectedIdentity = getReplayProtectedYouTubeIdentityRecord('abcdefghijk');
  const { handler, firestore } = makeHandler({
    seed: { [protectedIdentity.path]: protectedIdentity.data }
  });
  await assert.rejects(handler(requestFor(), context()), {
    code: 'failed-precondition',
    message: 'Athlete profile media contains a protected game replay.'
  });
  assert.deepEqual(firestore.snapshot('athleteProfiles/profile-1'), {
    parentUserId: 'parent-1',
    mediaUploadReservation: true
  });
  assert.equal(
    firestore.snapshot(getReplayClipYouTubeIdentityRecord('abcdefghijk').path),
    undefined
  );
});

test('callable rejects a protected generated identity even when stale state retained the same bytes', async () => {
  const protectedIdentity = getReplayProtectedYouTubeIdentityRecord('abcdefghijk');
  const staleProfile = baseProfile();
  const request = requestFor(staleProfile);
  const { handler, firestore } = makeHandler({
    seed: {
      [protectedIdentity.path]: protectedIdentity.data,
      'athleteProfiles/profile-1': {
        parentUserId: 'parent-1',
        ...staleProfile,
        profileProjectionSchemaVersion: 1,
        profileProjectionMutationId: request.mutationId,
        profileProjectionMutationHash: request.requestHash
      }
    }
  });
  await assert.rejects(handler(request, context()), { code: 'failed-precondition' });
  assert.equal(
    firestore.snapshot('athleteProfiles/profile-1').profileProjectionMutationId,
    request.mutationId
  );
});

test('callable rejects a protected identity document whose body does not match its exact path', async () => {
  const protectedIdentity = getReplayProtectedYouTubeIdentityRecord('abcdefghijk');
  const { handler } = makeHandler({
    seed: {
      [protectedIdentity.path]: {
        ...protectedIdentity.data,
        videoId: 'lmnopqrstuv'
      }
    }
  });
  await assert.rejects(handler(requestFor(), context()), {
    code: 'failed-precondition',
    message: 'The protected replay identity index is unavailable for safe profile updates.'
  });
});

test('callable rejects a protected intentional YouTube profile clip', async () => {
  const intentionalIdentity = getReplayProtectedYouTubeIdentityRecord('zyxwvutsrqp');
  const { handler, firestore } = makeHandler({
    seed: { [intentionalIdentity.path]: intentionalIdentity.data }
  });
  await assert.rejects(handler(requestFor(), context()), {
    code: 'failed-precondition',
    message: 'Athlete profile media contains a protected game replay.'
  });
  assert.equal(firestore.snapshot('athleteProfiles/profile-1').clips, undefined);
});

test('callable rejects an exact protected non-YouTube URL in generated media', async () => {
  const exactUrl = 'https://media.example.test/private-replay.m3u8';
  const protectedIdentity = getReplayProtectedUrlIdentityRecord(exactUrl);
  const clip = { id: 'generated-1', url: `${exactUrl}#watch` };
  const profile = baseProfile({
    gameClips: [clip],
    seasons: [{ ...baseProfile().seasons[0], gameClips: [clip] }]
  });
  const { handler } = makeHandler({
    seed: { [protectedIdentity.path]: protectedIdentity.data }
  });
  await assert.rejects(handler(requestFor(profile), context()), { code: 'failed-precondition' });
});

test('callable accepts unrelated YouTube generated media and atomically reserves its standalone clip identity', async () => {
  const { handler, firestore } = makeHandler();
  const result = await handler(requestFor(), context());
  assert.equal(result.profile.id, 'profile-1');
  assert.equal(result.profile.profileProjectionMutationId, requestFor().mutationId);
  assert.equal(result.profile.profileProjectionMutationHash, requestFor().requestHash);

  const stored = firestore.snapshot('athleteProfiles/profile-1');
  assert.equal(stored.parentUserId, 'parent-1');
  assert.equal(stored.mediaUploadReservation, undefined);
  assert.equal(stored.gameClips[0].url, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(stored.clips[0].url, 'https://youtu.be/zyxwvutsrqp');
  assert.equal(stored.profileProjectionSchemaVersion, 1);
  const receipt = mutationReceiptFor(requestFor());
  assert.deepEqual(firestore.snapshot(receipt.path), {
    ...receipt.data,
    committedAt: { __op: 'serverTimestamp' }
  });
  for (const videoId of ['abcdefghijk', 'zyxwvutsrqp']) {
    const identity = getReplayClipYouTubeIdentityRecord(videoId);
    assert.deepEqual(firestore.snapshot(identity.path), {
      ...identity.data,
      updatedAt: { __op: 'serverTimestamp' }
    });
    assert.equal(identity.path.includes(videoId), false);
    assert.equal(JSON.stringify(firestore.snapshot(identity.path)).includes(videoId), false);
  }
});

test('same mutation and hash is idempotent while mutation-id reuse with another payload fails closed', async () => {
  const { handler, firestore } = makeHandler();
  const request = requestFor();
  await handler(request, context());
  const first = firestore.snapshot('athleteProfiles/profile-1');
  const replay = await handler(request, context());
  assert.equal(replay.profile.profileProjectionMutationId, request.mutationId);
  assert.deepEqual(firestore.snapshot('athleteProfiles/profile-1'), first);

  const changedProfile = baseProfile({
    athlete: { name: 'Athlete One', headline: 'Updated headline' }
  });
  await assert.rejects(
    handler(requestFor(changedProfile, { mutationId: request.mutationId }), context()),
    { code: 'already-exists' }
  );
});

test('same mutation marker fails closed when the stored projection body no longer matches its hash', async () => {
  const request = requestFor();
  const receipt = mutationReceiptFor(request);
  const clipIdentity = getReplayClipYouTubeIdentityRecord('abcdefghijk');
  const { handler } = makeHandler({
    seed: {
      'athleteProfiles/profile-1': {
        parentUserId: 'parent-1',
        ...request.profile,
        bio: { ...request.profile.bio, hometown: 'Changed after commit' },
        profileProjectionSchemaVersion: 1,
        profileProjectionMutationId: request.mutationId,
        profileProjectionMutationHash: request.requestHash
      },
      [receipt.path]: receipt.data,
      [clipIdentity.path]: clipIdentity.data
    }
  });
  await assert.rejects(handler(request, context()), {
    code: 'failed-precondition',
    message: 'The stored athlete profile does not match its mutation marker.'
  });
});

test('same mutation marker fails closed when its permanent clip ledger is missing', async () => {
  const request = requestFor();
  const receipt = mutationReceiptFor(request);
  const { handler } = makeHandler({
    seed: {
      'athleteProfiles/profile-1': {
        parentUserId: 'parent-1',
        ...request.profile,
        profileProjectionSchemaVersion: 1,
        profileProjectionMutationId: request.mutationId,
        profileProjectionMutationHash: request.requestHash
      },
      [receipt.path]: receipt.data
    }
  });
  await assert.rejects(handler(request, context()), {
    code: 'failed-precondition',
    message: 'The replay clip identity index is unavailable for safe profile updates.'
  });
});

test('a permanently receipted retry cannot overwrite a later profile mutation', async () => {
  const request = requestFor();
  const receipt = mutationReceiptFor(request);
  const { handler, firestore } = makeHandler({
    seed: {
      [receipt.path]: receipt.data,
      'athleteProfiles/profile-1': {
        parentUserId: 'parent-1',
        ...baseProfile({ athlete: { name: 'Athlete One', headline: 'Later save' } }),
        profileProjectionSchemaVersion: 1,
        profileProjectionMutationId: 'later-mutation',
        profileProjectionMutationHash: 'c'.repeat(64)
      }
    }
  });
  await assert.rejects(handler(request, context()), {
    code: 'failed-precondition',
    message: 'This athlete profile mutation was already committed and later superseded.'
  });
  assert.equal(
    firestore.snapshot('athleteProfiles/profile-1').profileProjectionMutationId,
    'later-mutation'
  );
});

test('mutation receipt reuse with a different request hash fails closed', async () => {
  const request = requestFor();
  const receipt = mutationReceiptFor(request);
  const { handler } = makeHandler({
    seed: {
      [receipt.path]: {
        ...receipt.data,
        requestHash: 'd'.repeat(64)
      }
    }
  });
  await assert.rejects(handler(request, context()), { code: 'already-exists' });
});

test('a misbound mutation receipt fails closed instead of authorizing reconciliation', async () => {
  const request = requestFor();
  const receipt = mutationReceiptFor(request);
  const { handler } = makeHandler({
    seed: {
      [receipt.path]: {
        ...receipt.data,
        profileId: 'another-profile'
      }
    }
  });
  await assert.rejects(handler(request, context()), {
    code: 'failed-precondition',
    message: 'The athlete profile mutation receipt is unavailable for safe reconciliation.'
  });
});
