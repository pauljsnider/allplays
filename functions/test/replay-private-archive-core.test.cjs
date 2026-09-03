'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH,
  REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
  REPLAY_READABLE_FIELDS,
  buildReplayArchiveWrite,
  buildReplayCompatibilityParentUpdate,
  buildReplayCompatibilityReceipt,
  buildReplayParentUpdate,
  buildReplayServerProjectionGame,
  canManageReplayArchive,
  collectHighlightProtectedUrlIdentityRecords,
  createReplayRevision,
  extractYouTubeVideoIdForProtection,
  getCompatibleReplayLifecycle,
  getExactReplayLifecycle,
  getPrivateReplayArchivePath,
  getReplayClipYouTubeIdentityRecord,
  getReplayArchiveChildPath,
  getReplayCompatibilityNextGame,
  getReplayCompatibilityParentFingerprint,
  getReplayCompatibilityReceiptPath,
  getReplayCompatibilityState,
  getReplayIdentityHash,
  getReplayProtectedUrlIdentityRecord,
  getReplayProtectedYouTubeIdentityRecordFromHash,
  getReadableReplayArchiveState,
  getReplayMutationHash,
  getReplayProjectionVideo,
  isCanonicalReplayGame,
  isReplayArchiveConsistent,
  isReplayArchiveMigrationReady,
  inspectLegacyReplayArchive,
  normalizeReplayManagementInput,
  normalizeHighlightClipWrite,
  normalizeReplayClipIdentity,
  normalizeReplayCompatibilityReceipt,
  normalizeReplayArchiveMigrationControl,
  normalizeReplayPremiumConfig,
  normalizeStoredReplayArchive,
  normalizeYouTubeReplayUrl,
  resolveReplaySeasonId,
  serializeReplayManagementState
} = require('../replay-private-archive-core.cjs');

test('migration control accepts only the fixed ready schema and version', () => {
  const ready = {
    schema: REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
    status: 'ready',
    version: 1,
    attemptId: 'migration:11111111-1111-4111-8111-111111111111'
  };
  assert.equal(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH, 'systemControls/replayPrivateArchiveMigration');
  assert.deepEqual(normalizeReplayArchiveMigrationControl(ready), ready);
  assert.equal(isReplayArchiveMigrationReady(ready), true);
  assert.equal(isReplayArchiveMigrationReady({ ...ready, status: 'migrating' }), false);
  assert.equal(isReplayArchiveMigrationReady({ ...ready, schema: 'wrong' }), false);
  assert.equal(isReplayArchiveMigrationReady({ ...ready, version: 2 }), false);
  assert.equal(isReplayArchiveMigrationReady({ ...ready, attemptId: ' padded ' }), false);
});

const readyGame = {
  type: 'game',
  status: 'completed',
  liveStatus: 'final',
  hasRecordedReplay: true,
  replayArchiveRevision: 'r:11111111-1111-4111-8111-111111111111'
};
const readyArchive = {
  schemaVersion: 1,
  state: 'ready',
  provider: 'youtube',
  videoId: 'abcdefghijk',
  title: 'Final',
  revision: readyGame.replayArchiveRevision,
  lastMutationId: 'mutation.1',
  lastMutationHash: 'hash'
};

test('strict YouTube normalization accepts exact videos and rejects feeds or ambiguous authorities', () => {
  assert.deepEqual(normalizeYouTubeReplayUrl('https://youtu.be/abcdefghijk?t=3'), {
    provider: 'youtube',
    videoId: 'abcdefghijk',
    embedUrl: 'https://www.youtube.com/embed/abcdefghijk',
    publicUrl: 'https://www.youtube.com/watch?v=abcdefghijk'
  });
  assert.equal(normalizeYouTubeReplayUrl('https://www.youtube.com/live'), null);
  assert.equal(normalizeYouTubeReplayUrl('https://youtube.com.evil.test/watch?v=abcdefghijk'), null);
  assert.equal(normalizeYouTubeReplayUrl('https://www.youtube.com/watch?v=abcdefghijk&v=lmnopqrstuv'), null);
  assert.equal(normalizeYouTubeReplayUrl('http://youtu.be/abcdefghijk'), null);
  for (const unsafeButIdentifiable of [
    'http://youtu.be/abcdefghijk',
    'https://user:password@youtu.be/abcdefghijk',
    'https://youtu.be:8443/abcdefghijk'
  ]) {
    assert.equal(normalizeYouTubeReplayUrl(unsafeButIdentifiable), null);
    assert.equal(extractYouTubeVideoIdForProtection(unsafeButIdentifiable), 'abcdefghijk');
  }
});

test('standalone YouTube clip exclusions are exact server-private records', () => {
  const record = getReplayClipYouTubeIdentityRecord('abcdefghijk');
  assert.match(record.path, /^replayClipIdentities\/youtube:[a-f0-9]{64}$/);
  assert.deepEqual(normalizeReplayClipIdentity(record.data), {
    kind: 'youtube',
    identityHash: record.data.identityHash
  });
  assert.equal(normalizeReplayClipIdentity({ ...record.data, identityHash: 'short' }), null);
  assert.equal(normalizeReplayClipIdentity({ ...record.data, videoId: 'abcdefghijk' }), null);
  const protectedRecord = getReplayProtectedYouTubeIdentityRecordFromHash(
    getReplayIdentityHash('youtube', 'abcdefghijk')
  );
  assert.match(protectedRecord.path, /^replayProtectedIdentities\/youtube:[a-f0-9]{64}$/);
  assert.equal(protectedRecord.data.identityHash, record.data.identityHash);
  assert.equal(Object.prototype.hasOwnProperty.call(protectedRecord.data, 'videoId'), false);
  assert.throws(
    () => getReplayProtectedYouTubeIdentityRecordFromHash('short'),
    /valid protected replay identity hash/
  );
});

test('highlight writes may remove existing YouTube clips but reject additions, changes, duplicates, and reintroduction', () => {
  const existingYouTube = {
    id: 'legacy-youtube',
    downloadUrl: 'https://youtu.be/abcdefghijk?t=4',
    video: { publicUrl: 'https://www.youtube.com/watch?v=abcdefghijk' }
  };
  const appended = { title: 'Fourth quarter', startMs: 1_000, endMs: 5_000 };
  assert.deepEqual(normalizeHighlightClipWrite(
    [existingYouTube, appended],
    { existingClips: [existingYouTube] }
  ), [existingYouTube, appended]);
  assert.deepEqual(normalizeHighlightClipWrite(
    [appended],
    { existingClips: [existingYouTube, appended] }
  ), [appended]);
  assert.throws(() => normalizeHighlightClipWrite([
    { ...existingYouTube, downloadUrl: 'https://youtu.be/lmnopqrstuv' }
  ], { existingClips: [existingYouTube] }), /retained byte-for-byte/);
  assert.throws(() => normalizeHighlightClipWrite([
    existingYouTube,
    { video: { sourceUrl: 'https://www.youtube.com/embed/lmnopqrstuv' } }
  ], { existingClips: [existingYouTube] }), /retained byte-for-byte/);
  assert.throws(() => normalizeHighlightClipWrite([
    existingYouTube,
    existingYouTube
  ], { existingClips: [existingYouTube] }), /retained byte-for-byte/);
  assert.throws(() => normalizeHighlightClipWrite([
    existingYouTube
  ], { existingClips: [appended] }), /retained byte-for-byte/);
  assert.throws(() => normalizeHighlightClipWrite([
    { url: 'http://youtu.be/abcdefghijk' }
  ]), /retained byte-for-byte/);
  assert.deepEqual(normalizeHighlightClipWrite([
    { mediaUrl: 'https://cdn.example.test/team-1/game-1/clip.mp4' }
  ]), [{ mediaUrl: 'https://cdn.example.test/team-1/game-1/clip.mp4' }]);

  const protectedUrlRecords = collectHighlightProtectedUrlIdentityRecords([{
    asset: { url: 'https://private.example/replay?token=secret' }
  }]);
  assert.equal(protectedUrlRecords.length, 1);
  assert.match(protectedUrlRecords[0].path, /^replayProtectedIdentities\/url:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(protectedUrlRecords).includes('token=secret'), false);

  const fragmentAliasRecords = collectHighlightProtectedUrlIdentityRecords([{
    asset: { url: 'https://private.example/replay?token=secret#watch' }
  }]);
  assert.equal(fragmentAliasRecords.some((record) => (
    record.path === getReplayProtectedUrlIdentityRecord(
      'https://private.example/replay?token=secret'
    ).path
  )), true);
});

test('management input preserves supported Firestore ID punctuation and requires a mutation CAS boundary', () => {
  const input = normalizeReplayManagementInput({
    action: 'set',
    teamId: 'team.alpha:1',
    gameId: 'game-alpha',
    expectedRevision: null,
    mutationId: 'mutation.1:client',
    youtubeUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    title: '  Championship   final  '
  });
  assert.equal(input.title, 'Championship final');
  assert.equal(input.replay.videoId, 'abcdefghijk');
  assert.throws(() => normalizeReplayManagementInput({
    action: 'remove', teamId: 'team', gameId: 'game', mutationId: 'one'
  }), /expectedRevision/);
  assert.throws(() => normalizeReplayManagementInput({
    action: 'read', teamId: 'bad/path', gameId: 'game'
  }), /teamId is invalid/);
});

test('only full access or an explicit selected videographer can manage an archive', () => {
  assert.equal(canManageReplayArchive({ full: true }), true);
  assert.equal(canManageReplayArchive({ videography: true, modes: { videography: 'selected' } }), true);
  assert.equal(canManageReplayArchive({ videography: true, modes: { videography: 'all_confirmed' } }), false);
  assert.equal(canManageReplayArchive({ parent: true }), false);
});

test('exact lifecycle and canonical target checks fail closed', () => {
  assert.equal(getExactReplayLifecycle({ type: 'game', status: 'completed', liveStatus: 'scheduled' }).isCompleted, true);
  assert.equal(getExactReplayLifecycle({ type: 'practice', status: 'completed' }).isCompleted, false);
  assert.equal(getExactReplayLifecycle({ status: 'complete' }).isCompleted, false);
  assert.equal(getExactReplayLifecycle({ status: 123, liveStatus: 'final' }).isCompleted, false);
  assert.equal(isCanonicalReplayGame('game-1', {}), true);
  assert.equal(isCanonicalReplayGame('shared_games%2F1', {}), false);
  assert.equal(isCanonicalReplayGame('game-1', { sharedScheduleId: 'share' }), false);
});

test('server playback preserves exact historical lifecycle aliases without broadening mutations', () => {
  for (const status of ['complete', 'finished']) {
    const game = { ...readyGame, status, liveStatus: 'scheduled' };
    assert.equal(getExactReplayLifecycle(game).isCompleted, false);
    assert.equal(getCompatibleReplayLifecycle(game).isCompleted, true);
    assert.equal(getReplayProjectionVideo(game, readyArchive)?.videoId, 'abcdefghijk');
  }
  for (const status of [' Complete ', 'COMPLETE', 'done']) {
    const game = { ...readyGame, status, liveStatus: 'scheduled' };
    assert.equal(getCompatibleReplayLifecycle(game).isCompleted, false);
    assert.equal(getReplayProjectionVideo(game, readyArchive), null);
  }
});

test('archive writes keep replay identity private and scrub every readable alias from the parent', () => {
  const input = normalizeReplayManagementInput({
    action: 'set',
    teamId: 'team',
    gameId: 'game',
    expectedRevision: null,
    mutationId: 'mutation.1',
    youtubeUrl: 'https://youtu.be/abcdefghijk',
    title: 'Final'
  });
  const timestamp = { server: true };
  const archive = buildReplayArchiveWrite({
    input,
    uid: 'manager.uid',
    revision: readyGame.replayArchiveRevision,
    timestamp
  });
  assert.equal(archive.videoId, 'abcdefghijk');
  assert.equal(Object.hasOwn(archive, 'linkedBy'), false);
  assert.equal(Object.hasOwn(archive, 'updatedBy'), false);
  assert.equal(archive.lastMutationHash, getReplayMutationHash(input));

  const deleted = Symbol('deleted');
  const parent = buildReplayParentUpdate({ state: 'ready', revision: archive.revision, deleteValue: deleted, timestamp });
  assert.deepEqual(
    REPLAY_READABLE_FIELDS.filter((field) => parent[field] !== deleted),
    []
  );
  assert.deepEqual(
    Object.keys(parent).filter((field) => !REPLAY_READABLE_FIELDS.includes(field)).sort(),
    ['hasRecordedReplay', 'replayArchiveRevision', 'updatedAt']
  );
  assert.equal(parent.hasRecordedReplay, true);
});

test('private ready/removed state must exactly match safe markers and completed lifecycle', () => {
  assert.deepEqual(normalizeStoredReplayArchive(readyArchive), {
    ...readyArchive,
    protectedVideoIdHashes: [],
    linkedBy: null
  });
  assert.equal(isReplayArchiveConsistent(readyGame, readyArchive), true);
  assert.equal(getReplayProjectionVideo(readyGame, readyArchive).publicUrl, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(getReplayProjectionVideo({ ...readyGame, replayArchiveRevision: 'other' }, readyArchive), null);
  assert.equal(getReplayProjectionVideo({ ...readyGame, status: 'scheduled' }, readyArchive), null);
  assert.equal(serializeReplayManagementState(readyGame, readyArchive).state, 'ready');
  assert.equal(serializeReplayManagementState(readyGame, readyArchive).lastMutationId, 'mutation.1');
  assert.equal(serializeReplayManagementState({ ...readyGame, replayArchiveRevision: 'other' }, readyArchive).state, 'unavailable');
  assert.deepEqual(buildReplayServerProjectionGame({
    ...readyGame,
    replayVideoUrl: 'https://leaked.example.test',
    videoUrl: 'https://also-leaked.example.test'
  }, readyArchive).replayVideo, {
    provider: 'youtube',
    videoId: 'abcdefghijk',
    embedUrl: 'https://www.youtube.com/embed/abcdefghijk',
    publicUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    title: 'Final',
    status: 'ready'
  });

  const activeCopy = {
    type: 'game',
    status: 'scheduled',
    liveStatus: 'live',
    videoUrl: 'https://youtu.be/abcdefghijk',
    isPublicProjection: true
  };
  assert.equal(buildReplayServerProjectionGame(activeCopy).videoUrl, activeCopy.videoUrl);
  assert.equal(buildReplayServerProjectionGame(activeCopy, null, {
    stripNonCompletedVideoUrl: true
  }).videoUrl, undefined);

  const removed = {
    schemaVersion: 1,
    state: 'removed',
    revision: 'r:22222222-2222-4222-8222-222222222222',
    lastMutationId: 'remove.1',
    lastMutationHash: 'hash'
  };
  assert.equal(normalizeStoredReplayArchive({ ...removed, videoId: 'abcdefghijk' }), null);
  assert.equal(isReplayArchiveConsistent({ hasRecordedReplay: false, replayArchiveRevision: removed.revision }, removed), true);
});

test('legacy inspection shares the complete readable alias inventory with migration code', () => {
  const legacy = {
    type: 'game',
    status: 'completed',
    replayVideoUrl: 'https://youtu.be/abcdefghijk',
    replayVideoTitle: 'Old final'
  };
  assert.deepEqual(Object.keys(getReadableReplayArchiveState(legacy)).sort(), [
    'replayVideoTitle', 'replayVideoUrl'
  ]);
  assert.deepEqual(inspectLegacyReplayArchive(legacy).replay, {
    provider: 'youtube',
    videoId: 'abcdefghijk',
    embedUrl: 'https://www.youtube.com/embed/abcdefghijk',
    publicUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    title: 'Old final'
  });
  assert.equal(inspectLegacyReplayArchive({
    ...legacy,
    recordedVideoUrl: 'https://youtu.be/lmnopqrstuv'
  }).state, 'quarantine');
  assert.equal(inspectLegacyReplayArchive({ replayVideoFallbackDisabled: true }).state, 'removed');
  assert.equal(inspectLegacyReplayArchive({
    type: 'game', status: 'scheduled', videoUrl: 'https://youtu.be/abcdefghijk'
  }).state, 'none');
  assert.equal(getPrivateReplayArchivePath('team.alpha:1', 'game-1'), 'teams/team.alpha:1/games/game-1/privateReplay/archive');
  assert.equal(getReplayArchiveChildPath('organizations/org-1/sharedGames/game-1'), 'organizations/org-1/sharedGames/game-1/privateReplay/archive');
  assert.throws(() => getReplayArchiveChildPath('teams/team-1/games'), /valid parent document path/);
});

test('legacy inspection never promotes blocked or unknown replay availability to ready', () => {
  const legacy = {
    type: 'game',
    status: 'completed',
    replayVideoUrl: 'https://youtu.be/abcdefghijk'
  };
  for (const replayStatus of ['processing', 'pending', 'failed', 'error', 'unknown']) {
    const inspected = inspectLegacyReplayArchive({ ...legacy, replayStatus });
    assert.equal(inspected.state, 'quarantine', replayStatus);
    assert.equal(
      inspected.reason,
      `${replayStatus === 'unknown' ? 'invalid' : 'blocked'}-replay-availability`,
      replayStatus
    );
  }
  assert.equal(inspectLegacyReplayArchive({
    ...legacy,
    replayStatus: 'ready',
    recordedReplayStatus: 'failed'
  }).state, 'quarantine');
  assert.equal(inspectLegacyReplayArchive({
    ...legacy,
    replayStatus: 'ready',
    recordedReplayStatus: 'complete'
  }).state, 'ready');
  assert.equal(inspectLegacyReplayArchive({
    ...legacy,
    replayVideo: {
      provider: 'youtube',
      videoId: 'abcdefghijk',
      status: 'ready',
      processingStatus: 'encoding'
    }
  }).state, 'quarantine');
});

test('legacy compatibility fingerprints preserve exact typed state and receipts carry only bounded hashes', () => {
  class FakeTimestamp {
    constructor(seconds, nanoseconds) {
      this.seconds = seconds;
      this.nanoseconds = nanoseconds;
    }

    toMillis() {
      return this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000);
    }
  }

  const base = {
    type: 'game',
    status: 'completed',
    replayVideo: {
      provider: 'youtube',
      videoId: 'abcdefghijk',
      linkedAt: new FakeTimestamp(100, 1)
    }
  };
  assert.notEqual(
    getReplayCompatibilityParentFingerprint(base),
    getReplayCompatibilityParentFingerprint({
      ...base,
      replayVideo: { ...base.replayVideo, linkedAt: new FakeTimestamp(100, 2) }
    })
  );
  assert.notEqual(
    getReplayCompatibilityParentFingerprint(base),
    getReplayCompatibilityParentFingerprint({
      ...base,
      replayVideo: { ...base.replayVideo, linkedAt: { seconds: 100, nanoseconds: 1 } }
    })
  );
  assert.notEqual(
    getReplayCompatibilityParentFingerprint(base),
    getReplayCompatibilityParentFingerprint({ ...base, replayVideoFallbackDisabled: null })
  );

  const input = {
    action: 'set',
    teamId: 'team-1',
    gameId: 'game-1',
    mutationId: 'mutation.1',
    replay: {
      provider: 'youtube',
      videoId: 'abcdefghijk',
      embedUrl: 'https://www.youtube.com/embed/abcdefghijk',
      publicUrl: 'https://www.youtube.com/watch?v=abcdefghijk'
    }
  };
  const revision = 'r:11111111-1111-4111-8111-111111111111';
  const next = getReplayCompatibilityNextGame({ type: 'game', status: 'completed' }, input, revision);
  const beforeStateHash = getReplayCompatibilityParentFingerprint({ type: 'game', status: 'completed' });
  const afterStateHash = getReplayCompatibilityParentFingerprint(next);
  const receipt = buildReplayCompatibilityReceipt({
    input,
    revision,
    beforeStateHash,
    afterStateHash,
    protectedIdentityHashes: [getReplayIdentityHash('youtube', 'abcdefghijk')],
    timestamp: 'timestamp'
  });
  assert.equal(getReplayCompatibilityReceiptPath('teams/team-1/games/game-1'),
    'teams/team-1/games/game-1/privateReplay/compatibility');
  assert.deepEqual(normalizeReplayCompatibilityReceipt(receipt), {
    schema: receipt.schema,
    version: 1,
    teamId: 'team-1',
    gameId: 'game-1',
    state: 'ready',
    revision,
    lastMutationId: 'mutation.1',
    lastMutationHash: receipt.lastMutationHash,
    beforeStateHash,
    afterStateHash,
    protectedIdentityHashes: [getReplayIdentityHash('youtube', 'abcdefghijk')]
  });
  assert.equal(JSON.stringify(receipt).includes('abcdefghijk'), false);
  assert.equal(JSON.stringify(receipt).includes('youtube.com'), false);
  assert.equal(normalizeReplayCompatibilityReceipt({ ...receipt, videoId: 'abcdefghijk' }), null);
  const current = getReplayCompatibilityState(next, receipt, { teamId: 'team-1', gameId: 'game-1' });
  assert.equal(current.receiptMatches, true);
  assert.equal(current.replayArchiveRevision, revision);

  const deleted = Symbol('deleted');
  const parentUpdate = buildReplayCompatibilityParentUpdate({
    input,
    revision,
    deleteValue: deleted,
    timestamp: 'timestamp',
    isCompleted: true
  });
  assert.equal(parentUpdate.hasRecordedReplay, true);
  assert.equal(parentUpdate.replayArchiveRevision, revision);
  assert.equal(parentUpdate.videoUrl, deleted);
});

test('a non-final removal preserves videoUrl because it can still be the live transport', () => {
  const deleted = Symbol('deleted');
  const parent = buildReplayParentUpdate({
    state: 'removed',
    revision: 'r:22222222-2222-4222-8222-222222222222',
    deleteValue: deleted,
    timestamp: {},
    isCompleted: false
  });
  assert.equal(Object.prototype.hasOwnProperty.call(parent, 'videoUrl'), false);
  assert.equal(parent.replayVideo, deleted);
});

test('revision generation fails closed and season resolution uses authoritative game then team scope', () => {
  assert.equal(
    createReplayRevision(() => '11111111-1111-4111-8111-111111111111'),
    'r:11111111-1111-4111-8111-111111111111'
  );
  assert.throws(() => createReplayRevision(() => 'weak'), /Secure replay revision/);
  assert.equal(resolveReplaySeasonId({ seasonId: 'spring-27' }, { currentSeasonId: 'fall-27' }), 'spring-27');
  assert.equal(resolveReplaySeasonId({}, { currentSeasonId: 'fall-27' }), 'fall-27');
  assert.equal(resolveReplaySeasonId({}, {}, new Date('2032-05-01T00:00:00Z')), '2032');
  assert.equal(resolveReplaySeasonId({ seasonId: 'bad season' }, {}), '');
  assert.deepEqual(normalizeReplayPremiumConfig(null, { exists: false }), {
    state: 'unavailable', openToAll: false, reason: 'missing-global-config'
  });
  assert.equal(normalizeReplayPremiumConfig({ openToAll: false }).openToAll, false);
  assert.equal(normalizeReplayPremiumConfig({ openToAll: 'false' }).state, 'unavailable');
});
