'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DRILL_LIBRARY_VIDEO_FIELDS,
  STRUCTURED_MEDIA_ACTIONS,
  STRUCTURED_MEDIA_RESOURCE_KINDS,
  TEAM_FIXED_VIDEO_FIELDS,
  collectStructuredMediaIdentities,
  createStructuredMediaWriteHandler,
  getStructuredMediaItemId,
  getStructuredMediaWriteMutationRecord,
  getStructuredMediaWriteRequestHash,
  normalizeStructuredMediaWriteInput
} = require('../structured-media-write-core.cjs');
const {
  REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH,
  REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
  getReplayClipYouTubeIdentityRecord,
  getReplayProtectedUrlIdentityRecord,
  getReplayProtectedYouTubeIdentityRecord
} = require('../replay-private-archive-core.cjs');
const {
  ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH,
  ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_SCHEMA
} = require('../athlete-profile-projection-core.cjs');
const { hasTeamAdminAccess } = require('../team-admin-access-core.cjs');

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function makeFirestore(seed = {}) {
  const state = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  const DELETE = Symbol('delete');

  function snapshot(ref) {
    const value = state.get(ref.path);
    return {
      exists: value !== undefined,
      ref,
      data: () => clone(value)
    };
  }

  function doc(path) {
    return { path };
  }

  function applySet(ref, value, options = {}) {
    const next = options.merge ? clone(state.get(ref.path) || {}) : {};
    Object.entries(value || {}).forEach(([key, entry]) => {
      if (entry === DELETE) delete next[key];
      else next[key] = clone(entry);
    });
    state.set(ref.path, next);
  }

  return {
    DELETE,
    doc,
    async runTransaction(operation) {
      const writes = [];
      const transaction = {
        get: async (ref) => snapshot(ref),
        set: (ref, value, options) => writes.push(() => applySet(ref, value, options)),
        delete: (ref) => writes.push(() => state.delete(ref.path))
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

function readyProfileBoundaryControl() {
  return {
    schema: ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_SCHEMA,
    version: 1,
    status: 'ready'
  };
}

function baseSeed(overrides = {}) {
  return {
    [REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH]: readyMigrationControl(),
    [ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH]: readyProfileBoundaryControl(),
    'teams/team-1': {
      ownerId: 'owner-1',
      ownerEmail: 'owner@example.test',
      teamPermissions: {
        teamMediaManagement: { mode: 'selected', memberIds: ['media-1'] }
      }
    },
    'users/owner-1': { isAdmin: false },
    'users/media-1': { isAdmin: false },
    ...overrides
  };
}

function makeHandler({
  seed = baseSeed(),
  uid = 'owner-1',
  email = 'owner@example.test',
  assertSensitiveWrite = async () => {}
} = {}) {
  const firestore = makeFirestore(seed);
  const handler = createStructuredMediaWriteHandler({
    firestore,
    auth: {
      async getUser(requestedUid) {
        return { uid: requestedUid, email, disabled: false };
      }
    },
    FieldValue: {
      serverTimestamp: () => 'SERVER_TIMESTAMP',
      delete: () => firestore.DELETE
    },
    HttpsError,
    hasTeamAdminAccess,
    assertSensitiveWrite
  });
  return {
    firestore,
    call: (request, context = { auth: { uid } }) => handler(request, context)
  };
}

function requestFor({
  resourceKind,
  action,
  teamId = 'team-1',
  targetId,
  payload,
  mutationId = '11111111-2222-4333-8444-555555555555'
}) {
  const semantic = {
    version: 1,
    resourceKind,
    action,
    teamId,
    ...(targetId ? { targetId } : {}),
    payload
  };
  return {
    ...semantic,
    mutationId,
    requestHash: getStructuredMediaWriteRequestHash(semantic)
  };
}

function teamPayload(overrides = {}) {
  return {
    streamEmbedUrl: null,
    youtubeEmbedUrl: null,
    streamUrl: null,
    livestreamUrl: null,
    youtubeVideoId: null,
    ...overrides
  };
}

function mediaPayload(overrides = {}) {
  return {
    folderId: 'folder-1',
    title: 'Replay link',
    type: 'video-link',
    url: null,
    src: null,
    downloadUrl: null,
    ...overrides
  };
}

function drillPayload(overrides = {}) {
  return {
    youtubeUrl: null,
    resourceUrl: null,
    ...overrides
  };
}

const youtubeId = 'dQw4w9WgXcQ';
const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;

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
      uid: 'owner-1',
      token: { email: 'owner@example.test', email_verified: false }
    }
  };
  const request = requestFor({
    resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO,
    action: STRUCTURED_MEDIA_ACTIONS.SET,
    payload: teamPayload({ streamEmbedUrl: youtubeUrl })
  });

  await assert.rejects(denied.call(request, deniedContext), { code: 'failed-precondition' });
  assert.deepEqual(calls, [{
    receivedContext: deniedContext,
    operation: 'mutate-structured-media-identity'
  }]);
  assert.equal(denied.firestore.snapshot(getStructuredMediaWriteMutationRecord(request).path), undefined);
});

test('finite team aliases all produce the same canonical YouTube identity', () => {
  const cases = TEAM_FIXED_VIDEO_FIELDS.map((field) => [
    field,
    field === 'youtubeVideoId' ? youtubeId : youtubeUrl
  ]);
  cases.forEach(([field, value], index) => {
    const request = requestFor({
      resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO,
      action: STRUCTURED_MEDIA_ACTIONS.SET,
      mutationId: `team-alias-${index}`,
      payload: teamPayload({ [field]: value })
    });
    const input = normalizeStructuredMediaWriteInput(request);
    assert.deepEqual([...collectStructuredMediaIdentities(input).youtubeVideoIds], [youtubeId]);
  });
});

test('finite typed media URL aliases all produce a canonical identity', () => {
  ['url', 'src', 'downloadUrl'].forEach((field, index) => {
    const request = requestFor({
      resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_MEDIA_VIDEO_LINK,
      action: STRUCTURED_MEDIA_ACTIONS.CREATE,
      mutationId: `media-alias-${index}`,
      payload: mediaPayload({ [field]: youtubeUrl })
    });
    const input = normalizeStructuredMediaWriteInput(request);
    assert.deepEqual([...collectStructuredMediaIdentities(input).youtubeVideoIds], [youtubeId]);
  });
});

test('finite drill URL aliases all produce a canonical identity', () => {
  DRILL_LIBRARY_VIDEO_FIELDS.forEach((field, index) => {
    const request = requestFor({
      resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.DRILL_LIBRARY_VIDEO,
      action: STRUCTURED_MEDIA_ACTIONS.SET,
      targetId: 'drill-1',
      mutationId: `drill-alias-${index}`,
      payload: drillPayload({ [field]: youtubeUrl })
    });
    const input = normalizeStructuredMediaWriteInput(request);
    assert.deepEqual([...collectStructuredMediaIdentities(input).youtubeVideoIds], [youtubeId]);
  });
});

test('historical HTTP and default-port aliases reserve the same permanent replay identity', async () => {
  for (const [index, alias] of [
    `http://youtu.be/${youtubeId}`,
    `https://www.youtube.com:443/watch?v=${youtubeId}`
  ].entries()) {
    const input = normalizeStructuredMediaWriteInput(requestFor({
      resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO,
      action: STRUCTURED_MEDIA_ACTIONS.SET,
      mutationId: `broad-youtube-alias-${index}`,
      payload: teamPayload({ streamEmbedUrl: alias })
    }));
    assert.deepEqual([...collectStructuredMediaIdentities(input).youtubeVideoIds], [youtubeId]);

    const { firestore, call } = makeHandler();
    await call(input);
    assert.equal(firestore.snapshot('teams/team-1').streamEmbedUrl, alias);
    assert.deepEqual(
      firestore.snapshot(getReplayClipYouTubeIdentityRecord(youtubeId).path),
      getReplayClipYouTubeIdentityRecord(youtubeId).data
    );
  }
});

test('team fixed video writes atomically reserve hashed clip identities without plaintext capability data', async () => {
  const { firestore, call } = makeHandler();
  const request = requestFor({
    resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO,
    action: STRUCTURED_MEDIA_ACTIONS.SET,
    payload: teamPayload({ streamEmbedUrl: youtubeUrl })
  });
  const result = await call(request);
  assert.deepEqual(result, {
    version: 1,
    mutationId: request.mutationId,
    requestHash: request.requestHash,
    resourceKind: request.resourceKind,
    action: request.action,
    committed: true,
    targetId: null,
    resource: { id: 'team-1' }
  });
  assert.equal(firestore.snapshot('teams/team-1').streamEmbedUrl, youtubeUrl);
  const record = getReplayClipYouTubeIdentityRecord(youtubeId);
  assert.match(record.path, /^replayClipIdentities\/youtube:[a-f0-9]{64}$/);
  assert.equal(record.path.includes(youtubeId), false);
  assert.deepEqual(firestore.snapshot(record.path), record.data);
  assert.equal(JSON.stringify(record.data).includes(youtubeId), false);
  const receipt = getStructuredMediaWriteMutationRecord(
    normalizeStructuredMediaWriteInput(request),
    null
  );
  assert.deepEqual(firestore.snapshot(receipt.path), {
    ...receipt.data,
    committedAt: 'SERVER_TIMESTAMP'
  });
  assert.equal(JSON.stringify(firestore.snapshot(receipt.path)).includes('owner-1'), false);
});

test('non-YouTube and YouTube channel/live_stream URLs are preserved without clip reservations', async () => {
  for (const [index, value] of [
    'https://video.example.test/live/game-1',
    'https://www.youtube.com/channel/UCa9ghvbup6VQmnDOdqwYpqQ',
    'https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ'
  ].entries()) {
    const { firestore, call } = makeHandler();
    const request = requestFor({
      resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO,
      action: STRUCTURED_MEDIA_ACTIONS.SET,
      mutationId: `non-youtube-${index}`,
      payload: teamPayload({ streamEmbedUrl: value })
    });
    await call(request);
    assert.equal(firestore.snapshot('teams/team-1').streamEmbedUrl, value);
    assert.equal([...collectStructuredMediaIdentities(normalizeStructuredMediaWriteInput(request)).youtubeVideoIds].length, 0);
  }
});

test('a protected YouTube ID or exact URL rejects the target and permanent clip ledger atomically', async () => {
  for (const protectedRecord of [
    getReplayProtectedYouTubeIdentityRecord(youtubeId),
    getReplayProtectedUrlIdentityRecord(youtubeUrl)
  ]) {
    const seed = baseSeed({ [protectedRecord.path]: protectedRecord.data });
    const { firestore, call } = makeHandler({ seed });
    const request = requestFor({
      resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO,
      action: STRUCTURED_MEDIA_ACTIONS.SET,
      payload: teamPayload({ streamEmbedUrl: youtubeUrl })
    });
    await assert.rejects(call(request), { code: 'failed-precondition' });
    assert.equal(firestore.snapshot('teams/team-1').streamEmbedUrl, undefined);
    assert.equal(firestore.snapshot(getReplayClipYouTubeIdentityRecord(youtubeId).path), undefined);
  }
});

test('protected URL lookup covers exact raw and canonical URL aliases', async () => {
  const canonicalUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
  for (const [index, alias] of [
    `https://www.youtube.com:443/watch?v=${youtubeId}`,
    `https://WWW.YOUTUBE.COM/watch?v=${youtubeId}`,
    `https://www.youtube.com/a/../watch?v=${youtubeId}`
  ].entries()) {
    const protectedRecord = getReplayProtectedUrlIdentityRecord(canonicalUrl);
    const { firestore, call } = makeHandler({
      seed: baseSeed({ [protectedRecord.path]: protectedRecord.data })
    });
    const request = requestFor({
      resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO,
      action: STRUCTURED_MEDIA_ACTIONS.SET,
      mutationId: `canonical-alias-${index}`,
      payload: teamPayload({ streamEmbedUrl: alias })
    });

    await assert.rejects(call(request), { code: 'failed-precondition' });
    assert.equal(firestore.snapshot('teams/team-1').streamEmbedUrl, undefined);
    assert.equal(firestore.snapshot(getReplayClipYouTubeIdentityRecord(youtubeId).path), undefined);
  }
});

test('protected exact URL candidates preserve signed-query byte distinctions', async () => {
  const protectedUrl = 'https://video.example.test/watch?signature=a%2Fb';
  const distinctUrl = 'https://video.example.test/watch?signature=a/b';
  const protectedRecord = getReplayProtectedUrlIdentityRecord(protectedUrl);
  const { firestore, call } = makeHandler({
    seed: baseSeed({ [protectedRecord.path]: protectedRecord.data })
  });
  const request = requestFor({
    resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO,
    action: STRUCTURED_MEDIA_ACTIONS.SET,
    payload: teamPayload({ streamEmbedUrl: distinctUrl })
  });

  await call(request);
  assert.equal(firestore.snapshot('teams/team-1').streamEmbedUrl, distinctUrl);
});

test('server normalization rejects unknown top-level request fields', () => {
  const request = requestFor({
    resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO,
    action: STRUCTURED_MEDIA_ACTIONS.SET,
    payload: teamPayload({ streamEmbedUrl: youtubeUrl })
  });

  assert.throws(
    () => normalizeStructuredMediaWriteInput({ ...request, callerUid: 'owner-1' }),
    { code: 'invalid-argument' }
  );
});

test('media creation reserves folder order, item, receipt, and permanent ledger once across retries', async () => {
  const { firestore, call } = makeHandler({
    seed: baseSeed({
      'teams/team-1/mediaFolders/folder-1': { nextMediaOrder: 7, visibility: 'team' }
    })
  });
  const request = requestFor({
    resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_MEDIA_VIDEO_LINK,
    action: STRUCTURED_MEDIA_ACTIONS.CREATE,
    payload: mediaPayload({ url: youtubeUrl })
  });
  const first = await call(request);
  const second = await call(request);
  const targetId = getStructuredMediaItemId('team-1', request.mutationId);
  assert.deepEqual(second, first);
  assert.equal(first.targetId, targetId);
  assert.equal(firestore.snapshot('teams/team-1/mediaFolders/folder-1').nextMediaOrder, 8);
  assert.deepEqual(firestore.snapshot(`teams/team-1/mediaItems/${targetId}`), {
    ...mediaPayload({ url: youtubeUrl }),
    order: 7,
    deleted: false,
    createdAt: 'SERVER_TIMESTAMP',
    updatedAt: 'SERVER_TIMESTAMP'
  });
  assert.deepEqual(
    firestore.snapshot(getReplayClipYouTubeIdentityRecord(youtubeId).path),
    getReplayClipYouTubeIdentityRecord(youtubeId).data
  );
});

test('delegated media managers can create and remove video links while the permanent ledger remains', async () => {
  const { firestore, call } = makeHandler({
    uid: 'media-1',
    email: 'media@example.test',
    seed: baseSeed({
      'teams/team-1/mediaFolders/folder-1': { nextMediaOrder: 0, visibility: 'team' }
    })
  });
  const createRequest = requestFor({
    resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_MEDIA_VIDEO_LINK,
    action: STRUCTURED_MEDIA_ACTIONS.CREATE,
    payload: mediaPayload({ url: youtubeUrl })
  });
  const created = await call(createRequest);
  const removeRequest = requestFor({
    resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_MEDIA_VIDEO_LINK,
    action: STRUCTURED_MEDIA_ACTIONS.REMOVE,
    targetId: created.targetId,
    mutationId: '99999999-2222-4333-8444-555555555555',
    payload: {}
  });
  await call(removeRequest);
  assert.equal(firestore.snapshot(`teams/team-1/mediaItems/${created.targetId}`).deleted, true);
  assert.deepEqual(
    firestore.snapshot(getReplayClipYouTubeIdentityRecord(youtubeId).path),
    getReplayClipYouTubeIdentityRecord(youtubeId).data
  );
});

test('drill video set, removal, and delete use the server boundary without deleting the ledger', async () => {
  const seed = baseSeed({
    'drillLibrary/drill-1': {
      source: 'custom',
      teamId: 'team-1',
      title: 'Passing drill'
    }
  });
  const { firestore, call } = makeHandler({ seed });
  await call(requestFor({
    resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.DRILL_LIBRARY_VIDEO,
    action: STRUCTURED_MEDIA_ACTIONS.SET,
    targetId: 'drill-1',
    payload: drillPayload({ resourceUrl: youtubeUrl })
  }));
  assert.equal(firestore.snapshot('drillLibrary/drill-1').resourceUrl, youtubeUrl);

  await call(requestFor({
    resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.DRILL_LIBRARY_VIDEO,
    action: STRUCTURED_MEDIA_ACTIONS.REMOVE,
    targetId: 'drill-1',
    mutationId: '22222222-2222-4222-8222-222222222222',
    payload: {}
  }));
  assert.equal(firestore.snapshot('drillLibrary/drill-1').resourceUrl, undefined);
  assert.deepEqual(
    firestore.snapshot(getReplayClipYouTubeIdentityRecord(youtubeId).path),
    getReplayClipYouTubeIdentityRecord(youtubeId).data
  );

  await call(requestFor({
    resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.DRILL_LIBRARY_VIDEO,
    action: STRUCTURED_MEDIA_ACTIONS.DELETE,
    targetId: 'drill-1',
    mutationId: '33333333-3333-4333-8333-333333333333',
    payload: {}
  }));
  assert.equal(firestore.snapshot('drillLibrary/drill-1'), undefined);
  assert.notEqual(firestore.snapshot(getReplayClipYouTubeIdentityRecord(youtubeId).path), undefined);
});

test('a reused mutation ID with a different exact request fails closed', async () => {
  const { call } = makeHandler();
  const first = requestFor({
    resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO,
    action: STRUCTURED_MEDIA_ACTIONS.SET,
    payload: teamPayload({ streamEmbedUrl: youtubeUrl })
  });
  await call(first);
  const second = requestFor({
    resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO,
    action: STRUCTURED_MEDIA_ACTIONS.SET,
    mutationId: first.mutationId,
    payload: teamPayload({ streamEmbedUrl: 'https://video.example.test/other' })
  });
  await assert.rejects(call(second), { code: 'already-exists' });
});

test('only both absent or both exact-ready controls allow writes', async () => {
  const request = requestFor({
    resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO,
    action: STRUCTURED_MEDIA_ACTIONS.SET,
    payload: teamPayload({ streamEmbedUrl: youtubeUrl })
  });
  const unauthorized = makeHandler({ uid: 'stranger', email: 'stranger@example.test' });
  await assert.rejects(unauthorized.call(request), { code: 'permission-denied' });

  const compatibilitySeed = baseSeed();
  delete compatibilitySeed[REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH];
  delete compatibilitySeed[ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH];
  const compatibility = makeHandler({ seed: compatibilitySeed });
  await compatibility.call(request);
  assert.equal(compatibility.firestore.snapshot('teams/team-1').streamEmbedUrl, youtubeUrl);
  assert.equal(
    compatibility.firestore.snapshot(getReplayClipYouTubeIdentityRecord(youtubeId).path),
    undefined
  );
  await compatibility.call(requestFor({
    resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO,
    action: STRUCTURED_MEDIA_ACTIONS.REMOVE,
    mutationId: 'compatibility-remove-1',
    payload: {}
  }));
  assert.equal(compatibility.firestore.snapshot('teams/team-1').streamEmbedUrl, undefined);
  assert.equal(
    compatibility.firestore.snapshot(getReplayClipYouTubeIdentityRecord(youtubeId).path),
    undefined
  );

  for (const control of [
    {
      schema: REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
      version: 1,
      status: 'migrating',
      attemptId: 'migration:22222222-2222-4222-8222-222222222222'
    },
    { status: 'ready' }
  ]) {
    const blocked = makeHandler({
      seed: baseSeed({ [REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH]: control })
    });
    await assert.rejects(blocked.call(request), { code: 'failed-precondition' });
    assert.equal(blocked.firestore.snapshot('teams/team-1').streamEmbedUrl, undefined);
  }

  for (const overrides of [
    { [ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH]: undefined },
    { [REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH]: undefined },
    {
      [ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH]: {
        schema: ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_SCHEMA,
        version: 1,
        status: 'migrating'
      }
    }
  ]) {
    const seed = baseSeed();
    Object.entries(overrides).forEach(([path, value]) => {
      if (value === undefined) delete seed[path];
      else seed[path] = value;
    });
    const blocked = makeHandler({ seed });
    await assert.rejects(blocked.call(request), { code: 'failed-precondition' });
    assert.equal(blocked.firestore.snapshot('teams/team-1').streamEmbedUrl, undefined);
  }
});
