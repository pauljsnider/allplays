'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
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
} = require('../replay-structured-media-core.cjs');
const {
  getReplayClipYouTubeIdentityRecord,
  getReplayIdentityHash
} = require('../replay-private-archive-core.cjs');

const VIDEO_IDS = Object.freeze({
  alpha: 'abcdefghijk',
  bravo: 'lmnopqrstuv',
  charlie: 'wxyzABCDE12',
  delta: 'FGHIJKLMN34',
  echo: 'OPQRSTUVWX5'
});

function watch(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function embed(videoId) {
  return `https://www.youtube.com/embed/${videoId}`;
}

function sourceSummary(sources) {
  return sources.map((source) => ({
    videoId: source.videoId,
    sourceKind: source.sourceKind,
    sourceRole: source.sourceRole,
    pathRole: source.pathRole,
    fieldPath: source.fieldPath
  }));
}

test('exports a frozen finite descriptor and alias inventory for migration and rule contracts', () => {
  assert.deepEqual(TEAM_FIXED_VIDEO_ID_FIELDS, ['youtubeVideoId']);
  assert.deepEqual(TEAM_FIXED_VIDEO_URL_FIELDS, [
    'streamEmbedUrl',
    'youtubeEmbedUrl',
    'streamUrl',
    'livestreamUrl'
  ]);
  assert.deepEqual(BROADCAST_PROVIDER_VIDEO_ID_FIELDS, ['videoId']);
  assert.deepEqual(BROADCAST_PROVIDER_VIDEO_URL_FIELDS, ['embedUrl']);
  assert.deepEqual(TEAM_MEDIA_VIDEO_LINK_TYPE_FIELDS, ['type', 'mediaType']);
  assert.deepEqual(TEAM_MEDIA_VIDEO_LINK_TYPES, ['video-link', 'video_link']);
  assert.deepEqual(TEAM_MEDIA_VIDEO_LINK_URL_FIELDS, ['url', 'src', 'downloadUrl']);
  assert.deepEqual(DRILL_LIBRARY_VIDEO_URL_FIELDS, ['youtubeUrl', 'resourceUrl']);
  assert.deepEqual(GAME_FIXED_VIDEO_ID_FIELDS, ['youtubeVideoId']);
  assert.deepEqual(GAME_FIXED_VIDEO_URL_FIELDS, ['streamEmbedUrl', 'youtubeEmbedUrl']);
  assert.deepEqual(AUTOMATED_GAME_COPY_MARKER_FIELDS, [
    'sharedGameId',
    'sharedGamePath',
    '_sharedGamePath',
    'sharedScheduleId',
    'sharedScheduleSourceTeamId',
    'sharedScheduleOpponentTeamId',
    'sharedScheduleOpponentGameId'
  ]);
  assert.deepEqual(STRUCTURED_REPLAY_CLIP_SCAN_TARGETS, [
    { mode: 'collection', collectionId: 'teams' },
    { mode: 'collection-group', collectionId: 'games' },
    { mode: 'collection-group', collectionId: 'sharedGames' },
    { mode: 'collection-group', collectionId: 'mediaItems' },
    { mode: 'collection', collectionId: 'drillLibrary' }
  ]);
  assert.deepEqual(
    STRUCTURED_REPLAY_CLIP_SOURCE_DESCRIPTORS.map((descriptor) => descriptor.id),
    [
      'team-fixed-video',
      'game-fixed-video',
      'game-broadcast-provider',
      'game-active-video-url',
      'team-media-video-link',
      'drill-library-video'
    ]
  );
  for (const value of [
    TEAM_FIXED_VIDEO_ID_FIELDS,
    TEAM_FIXED_VIDEO_URL_FIELDS,
    BROADCAST_PROVIDER_VIDEO_ID_FIELDS,
    BROADCAST_PROVIDER_VIDEO_URL_FIELDS,
    TEAM_MEDIA_VIDEO_LINK_TYPE_FIELDS,
    TEAM_MEDIA_VIDEO_LINK_TYPES,
    TEAM_MEDIA_VIDEO_LINK_URL_FIELDS,
    DRILL_LIBRARY_VIDEO_URL_FIELDS,
    GAME_FIXED_VIDEO_ID_FIELDS,
    GAME_FIXED_VIDEO_URL_FIELDS,
    AUTOMATED_GAME_COPY_MARKER_FIELDS,
    STRUCTURED_REPLAY_CLIP_SCAN_TARGETS,
    STRUCTURED_REPLAY_CLIP_SOURCE_DESCRIPTORS
  ]) {
    assert.equal(Object.isFrozen(value), true);
  }
  STRUCTURED_REPLAY_CLIP_SOURCE_DESCRIPTORS.forEach((descriptor) => {
    assert.equal(Object.isFrozen(descriptor), true);
    assert.equal(Object.isFrozen(descriptor.pathRoles), true);
    assert.equal(Object.isFrozen(descriptor.scanTargetIds), true);
  });
});

test('classifies only finite supported structured document paths', () => {
  assert.equal(getStructuredReplayClipPathRole('teams/team-1'), STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM);
  assert.equal(getStructuredReplayClipPathRole('teams/team-1/games/game-1'), STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_GAME);
  assert.equal(getStructuredReplayClipPathRole('organizations/org-1/sharedGames/game-1'), STRUCTURED_REPLAY_CLIP_PATH_ROLES.SHARED_GAME);
  assert.equal(getStructuredReplayClipPathRole('teams/team-1/mediaItems/item-1'), STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_MEDIA_ITEM);
  assert.equal(getStructuredReplayClipPathRole('drillLibrary/drill-1'), STRUCTURED_REPLAY_CLIP_PATH_ROLES.DRILL_LIBRARY);

  for (const path of [
    '',
    '/teams/team-1',
    'teams/team-1/',
    'users/user-1',
    'socialPosts/post-1',
    'athleteProfiles/player-1',
    'teams/team-1/posts/post-1',
    'teams/team-1/mediaItems/item-1/comments/comment-1',
    'games/game-1'
  ]) {
    assert.equal(getStructuredReplayClipPathRole(path), null, path);
  }
});

test('extracts every finite team fixed-video alias with exact YouTube normalization', () => {
  const sources = extractStructuredReplayClipSources('teams/team-1', {
    youtubeVideoId: VIDEO_IDS.alpha,
    streamEmbedUrl: `${embed(VIDEO_IDS.bravo)}?autoplay=1&mute=1`,
    youtubeEmbedUrl: `https://youtu.be/${VIDEO_IDS.charlie}?si=legacy`,
    streamUrl: `https://youtube.com/live/${VIDEO_IDS.delta}`,
    livestreamUrl: `https://m.youtube.com/shorts/${VIDEO_IDS.echo}`,
    description: `Free text ${watch('ZZZZZZZZZZZ')}`,
    socialLinks: { youtube: watch('YYYYYYYYYYY') }
  });

  assert.deepEqual(sourceSummary(sources), [
    {
      videoId: VIDEO_IDS.alpha,
      sourceKind: 'team-fixed-video',
      sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT,
      pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM,
      fieldPath: 'youtubeVideoId'
    },
    {
      videoId: VIDEO_IDS.delta,
      sourceKind: 'team-fixed-video',
      sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT,
      pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM,
      fieldPath: 'streamUrl'
    },
    {
      videoId: VIDEO_IDS.bravo,
      sourceKind: 'team-fixed-video',
      sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT,
      pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM,
      fieldPath: 'streamEmbedUrl'
    },
    {
      videoId: VIDEO_IDS.echo,
      sourceKind: 'team-fixed-video',
      sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT,
      pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM,
      fieldPath: 'livestreamUrl'
    },
    {
      videoId: VIDEO_IDS.charlie,
      sourceKind: 'team-fixed-video',
      sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT,
      pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM,
      fieldPath: 'youtubeEmbedUrl'
    }
  ].sort((left, right) => left.videoId.localeCompare(right.videoId)
    || left.fieldPath.localeCompare(right.fieldPath)));
});

test('broadly protects identifiable historical YouTube URL aliases while playback remains strict', () => {
  for (const [field, value] of [
    ['streamEmbedUrl', `http://youtu.be/${VIDEO_IDS.alpha}`],
    ['youtubeEmbedUrl', `https://www.youtube.com:443/watch?v=${VIDEO_IDS.bravo}`],
    ['streamUrl', `https://viewer:secret@youtu.be/${VIDEO_IDS.charlie}`]
  ]) {
    const sources = extractStructuredReplayClipSources('teams/team-1', { [field]: value });
    assert.equal(sources.length, 1, field);
    assert.equal(sources[0].videoId, {
      streamEmbedUrl: VIDEO_IDS.alpha,
      youtubeEmbedUrl: VIDEO_IDS.bravo,
      streamUrl: VIDEO_IDS.charlie
    }[field]);
    assert.deepEqual(sources[0].urlIdentityHashes, getExactUrlIdentityHashes(value));
  }
});

test('preserves channel feeds, live_stream, non-YouTube URLs, and unlisted team text', () => {
  const values = [
    { streamEmbedUrl: 'https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ' },
    { youtubeEmbedUrl: 'https://www.youtube.com/channel/UCa9ghvbup6VQmnDOdqwYpqQ' },
    { youtubeVideoId: 'live_stream' },
    { streamUrl: 'https://twitch.tv/allplays' },
    { livestreamUrl: 'https://vimeo.com/123456789' },
    { website: watch(VIDEO_IDS.alpha) },
    { description: watch(VIDEO_IDS.alpha) },
    { social: { youtubeUrl: watch(VIDEO_IDS.alpha) } }
  ];
  values.forEach((team) => {
    assert.deepEqual(extractStructuredReplayClipSources('teams/team-1', team), [], JSON.stringify(team));
  });
});

test('inventories finite generic URL aliases as bounded raw and canonical hash identities', () => {
  const rawUrl = 'https://CDN.Example.test:443/a/../watch.m3u8?signature=a%2Fb';
  const canonicalUrl = 'https://cdn.example.test/watch.m3u8?signature=a%2Fb';
  const expectedHashes = [
    getReplayIdentityHash('url', rawUrl),
    getReplayIdentityHash('url', canonicalUrl)
  ].sort();
  assert.deepEqual(getExactUrlIdentityHashes(rawUrl), expectedHashes);
  assert.equal(
    getExactUrlIdentityHashes(`${canonicalUrl}#watch`).includes(
      getReplayIdentityHash('url', canonicalUrl)
    ),
    true
  );
  const normalizedFragmentAlias = `${rawUrl}#watch`;
  const fragmentSources = extractStructuredReplayIdentitySources(
    'teams/team-1/games/game-fragment',
    { status: 'live', sharedGameId: 'shared-1', videoUrl: normalizedFragmentAlias }
  );
  assert.equal(fragmentSources[0].urlIdentityHashes.length, 3);
  assert.doesNotThrow(() => buildStructuredReplayClipIdentityReport(fragmentSources));

  const sources = extractStructuredReplayIdentitySources('teams/team-1/games/game-1', {
    status: 'live',
    sharedGameId: 'shared-1',
    videoUrl: rawUrl,
    streamEmbedUrl: rawUrl,
    broadcastSession: {
      provider: { type: 'external_provider', embedUrl: rawUrl }
    }
  });
  assert.equal(sources.length, 3);
  sources.forEach((source) => {
    assert.equal(source.videoId, null);
    assert.deepEqual(source.urlIdentityHashes, expectedHashes);
    assert.equal(source.sourceRole, STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.AUTOMATED_COPY);
  });
  assert.deepEqual(
    sources.map((source) => source.fieldPath).sort(),
    ['broadcastSession.provider.embedUrl', 'streamEmbedUrl', 'videoUrl']
  );

  const distinctSignedUrl = 'https://cdn.example.test/watch.m3u8?signature=a/b';
  assert.equal(
    getExactUrlIdentityHashes(distinctSignedUrl).some((hash) => expectedHashes.includes(hash)),
    false
  );
});

test('reports protected generic URL overlap with exact automated source evidence', () => {
  const rawUrl = 'https://CDN.Example.test:443/a/../watch.m3u8?signature=a%2Fb';
  const canonicalHash = getReplayIdentityHash(
    'url',
    'https://cdn.example.test/watch.m3u8?signature=a%2Fb'
  );
  const sources = extractStructuredReplayIdentitySources('teams/team-1/games/game-1', {
    streamEmbedUrl: rawUrl,
    broadcastSession: {
      provider: { type: 'external_provider', embedUrl: rawUrl }
    }
  });
  const report = buildStructuredReplayClipIdentityReport(sources, {
    protectedIdentityHashes: [canonicalHash]
  });

  assert.deepEqual(report.videoIds, []);
  assert.equal(report.protectedUrlOverlaps.length, 1);
  assert.equal(report.protectedUrlOverlaps[0].identityHash, canonicalHash);
  assert.equal(report.independentProtectedUrlOverlaps.length, 0);
  assert.equal(report.automatedProtectedUrlCopies.length, 1);
  assert.deepEqual(
    report.automatedProtectedSources.map((source) => source.fieldPath).sort(),
    ['broadcastSession.provider.embedUrl', 'streamEmbedUrl']
  );
  assert.throws(
    () => assertNoStructuredReplayProtectedOverlap(report),
    (error) => error?.code === 'failed-precondition' && error.report === report
  );

  const plan = buildPermanentReplayClipIdentityInputs(sources);
  assert.deepEqual(plan.upserts, []);
  assert.equal(plan.urlIdentityInputs.length, 2);
  assert.equal(JSON.stringify(plan.urlIdentityInputs).includes(rawUrl), false);
  plan.urlIdentityInputs.forEach((input) => {
    assert.equal(input.kind, 'url');
    assert.deepEqual(input.sourceRoles, ['automated-copy']);
  });
});

test('scrubs team-game fixed-video copies while preserving canonical shared event streams', () => {
  const canonical = extractStructuredReplayClipSources('teams/team-1/games/game-1', {
    youtubeVideoId: VIDEO_IDS.alpha,
    streamEmbedUrl: embed(VIDEO_IDS.bravo),
    youtubeEmbedUrl: `https://youtu.be/${VIDEO_IDS.charlie}`
  });
  assert.deepEqual(sourceSummary(canonical), [
    {
      videoId: VIDEO_IDS.alpha,
      sourceKind: 'game-fixed-video',
      sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.AUTOMATED_COPY,
      pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_GAME,
      fieldPath: 'youtubeVideoId'
    },
    {
      videoId: VIDEO_IDS.bravo,
      sourceKind: 'game-fixed-video',
      sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.AUTOMATED_COPY,
      pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_GAME,
      fieldPath: 'streamEmbedUrl'
    },
    {
      videoId: VIDEO_IDS.charlie,
      sourceKind: 'game-fixed-video',
      sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.AUTOMATED_COPY,
      pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_GAME,
      fieldPath: 'youtubeEmbedUrl'
    }
  ].sort((left, right) => left.videoId.localeCompare(right.videoId)
    || left.fieldPath.localeCompare(right.fieldPath)));

  const [sharedSource] = extractStructuredReplayClipSources(
    'organizations/org-1/sharedGames/game-1',
    { youtubeVideoId: VIDEO_IDS.alpha }
  );
  assert.equal(sharedSource.sourceKind, 'game-fixed-video');
  assert.equal(sharedSource.sourceRole, STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT);

  const [projectedSource] = extractStructuredReplayClipSources(
    'teams/team-1/games/game-1',
    { youtubeVideoId: VIDEO_IDS.alpha, sharedGameId: 'shared-1' }
  );
  assert.equal(projectedSource.sourceKind, 'game-fixed-video');
  assert.equal(projectedSource.sourceRole, STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.AUTOMATED_COPY);
});

test('extracts typed broadcast provider identities as automated copies without traversing session text', () => {
  const sources = extractStructuredReplayClipSources('teams/team-1/games/game-1', {
    status: 'scheduled',
    liveStatus: 'scheduled',
    broadcastSession: {
      name: `Watch ${watch('ZZZZZZZZZZZ')}`,
      provider: {
        type: 'YouTube',
        videoId: VIDEO_IDS.alpha,
        embedUrl: `${embed(VIDEO_IDS.bravo)}?autoplay=1&mute=1`,
        publicUrl: watch('YYYYYYYYYYY')
      }
    }
  });

  assert.deepEqual(sourceSummary(sources), [
    {
      videoId: VIDEO_IDS.alpha,
      sourceKind: 'game-broadcast-provider',
      sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.AUTOMATED_COPY,
      pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_GAME,
      fieldPath: 'broadcastSession.provider.videoId'
    },
    {
      videoId: VIDEO_IDS.bravo,
      sourceKind: 'game-broadcast-provider',
      sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.AUTOMATED_COPY,
      pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_GAME,
      fieldPath: 'broadcastSession.provider.embedUrl'
    }
  ]);

  assert.deepEqual(sourceSummary(extractStructuredReplayClipSources('teams/team-1/games/game-1', {
    broadcastSession: { provider: { type: 'external_provider', embedUrl: embed(VIDEO_IDS.alpha) } }
  })), [{
    videoId: VIDEO_IDS.alpha,
    sourceKind: 'game-broadcast-provider',
    sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.AUTOMATED_COPY,
    pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_GAME,
    fieldPath: 'broadcastSession.provider.embedUrl'
  }]);
  assert.deepEqual(extractStructuredReplayClipSources('teams/team-1/games/game-1', {
    broadcastSession: { provider: { type: 'youtube', embedUrl: 'https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ' } }
  }), []);
});

test('reserves videoUrl for every non-completed game while retaining exact active classification', () => {
  const activeCases = [
    { status: 'scheduled', liveStatus: 'live' },
    { status: 'live', liveStatus: 'live' },
    { status: 'in_progress', liveStatus: 'scheduled' },
    { status: 'in-progress' }
  ];
  activeCases.forEach((lifecycle) => {
    assert.equal(getExactActiveGameVideoLifecycle(lifecycle).isActive, true, JSON.stringify(lifecycle));
    const sources = extractStructuredReplayClipSources('teams/team-1/games/game-1', {
      ...lifecycle,
      videoUrl: watch(VIDEO_IDS.alpha)
    });
    assert.deepEqual(sourceSummary(sources), [{
      videoId: VIDEO_IDS.alpha,
      sourceKind: 'game-active-video-url',
      sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT,
      pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_GAME,
      fieldPath: 'videoUrl'
    }]);
  });

  const nonActiveButReadableCases = [
    { status: 'scheduled', liveStatus: 'scheduled' },
    { status: 'completed', liveStatus: 'live' },
    { status: 'live', liveStatus: 'completed' },
    { status: 'LIVE', liveStatus: 'live' },
    { status: ' live ', liveStatus: 'live' },
    { status: 'mystery', liveStatus: 'live' },
    { type: 'practice', status: 'live' },
    { status: 'live', isCancelled: true },
    { status: 'live', deleted: true },
    { status: 'live', isDeleted: true }
  ];
  nonActiveButReadableCases.forEach((lifecycle) => {
    assert.equal(getExactActiveGameVideoLifecycle(lifecycle).isActive, false, JSON.stringify(lifecycle));
    assert.deepEqual(sourceSummary(extractStructuredReplayClipSources('teams/team-1/games/game-1', {
      ...lifecycle,
      videoUrl: watch(VIDEO_IDS.alpha)
    })), [{
      videoId: VIDEO_IDS.alpha,
      sourceKind: 'game-active-video-url',
      sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT,
      pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_GAME,
      fieldPath: 'videoUrl'
    }], JSON.stringify(lifecycle));
  });

  for (const lifecycle of [
    { status: 'completed', liveStatus: 'scheduled' },
    { status: 'final' },
    { status: 'complete' },
    { liveStatus: 'finished' }
  ]) {
    assert.deepEqual(extractStructuredReplayClipSources('teams/team-1/games/game-1', {
      ...lifecycle,
      videoUrl: watch(VIDEO_IDS.alpha)
    }), [], JSON.stringify(lifecycle));
  }
});

test('preserves canonical shared active video while classifying explicit projections as copies', () => {
  const sharedSources = extractStructuredReplayClipSources('organizations/org-1/sharedGames/game-1', {
    status: 'scheduled',
    liveStatus: 'live',
    videoUrl: watch(VIDEO_IDS.alpha)
  });
  assert.deepEqual(sourceSummary(sharedSources), [{
    videoId: VIDEO_IDS.alpha,
    sourceKind: 'game-active-video-url',
    sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT,
    pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.SHARED_GAME,
    fieldPath: 'videoUrl'
  }]);

  for (const marker of [
    { isSharedGame: true },
    { sharedGamePath: 'organizations/org-1/sharedGames/game-1' },
    { isPublicProjection: true }
  ]) {
    const markedSharedSources = extractStructuredReplayClipSources(
      'organizations/org-1/sharedGames/game-1',
      {
        status: 'scheduled',
        liveStatus: 'live',
        videoUrl: watch(VIDEO_IDS.alpha),
        youtubeVideoId: VIDEO_IDS.bravo,
        ...marker
      }
    );
    assert.deepEqual(markedSharedSources.map((source) => source.sourceRole), [
      STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT,
      STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT
    ], JSON.stringify(marker));
  }

  for (const marker of [
    { isPublicProjection: true },
    { isSharedGame: true },
    { sharedGamePath: 'organizations/org-1/sharedGames/game-1' },
    { sharedScheduleId: 'schedule-1' }
  ]) {
    const [source] = extractStructuredReplayClipSources('teams/team-1/games/game-1', {
      status: 'scheduled',
      liveStatus: 'live',
      videoUrl: watch(VIDEO_IDS.alpha),
      ...marker
    });
    assert.equal(source.sourceRole, STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.AUTOMATED_COPY);
  }
});

test('extracts only typed team media video-link URLs across the finite type aliases', () => {
  const cases = [
    [{ type: 'video-link', url: watch(VIDEO_IDS.alpha) }, VIDEO_IDS.alpha, 'url'],
    [{ type: 'video_link', url: `https://youtu.be/${VIDEO_IDS.bravo}` }, VIDEO_IDS.bravo, 'url'],
    [{ mediaType: 'video-link', url: embed(VIDEO_IDS.charlie) }, VIDEO_IDS.charlie, 'url'],
    [{ type: 'video-link', src: watch(VIDEO_IDS.delta) }, VIDEO_IDS.delta, 'src'],
    [{ type: 'video_link', downloadUrl: watch(VIDEO_IDS.echo) }, VIDEO_IDS.echo, 'downloadUrl']
  ];
  cases.forEach(([item, videoId, fieldPath]) => {
    assert.deepEqual(sourceSummary(extractStructuredReplayClipSources(
      'teams/team-1/mediaItems/item-1',
      item
    )), [{
      videoId,
      sourceKind: 'team-media-video-link',
      sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT,
      pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.TEAM_MEDIA_ITEM,
      fieldPath
    }]);
  });

  for (const item of [
    { type: 'photo', url: watch(VIDEO_IDS.alpha) },
    { type: 'file', url: watch(VIDEO_IDS.alpha) },
    { type: 'video', url: watch(VIDEO_IDS.alpha) },
    { type: 'video-link', url: 'https://vimeo.com/123456789' },
    { type: 'video-link', videoUrl: watch(VIDEO_IDS.alpha) },
    { type: 'video-link', title: watch(VIDEO_IDS.alpha) },
    { description: watch(VIDEO_IDS.alpha) }
  ]) {
    assert.deepEqual(extractStructuredReplayClipSources(
      'teams/team-1/mediaItems/item-1',
      item
    ), [], JSON.stringify(item));
  }
});

test('extracts only drillLibrary youtubeUrl and resourceUrl identities', () => {
  const sources = extractStructuredReplayClipSources('drillLibrary/drill-1', {
    youtubeUrl: `${watch(VIDEO_IDS.alpha)}&t=20`,
    resourceUrl: `https://youtu.be/${VIDEO_IDS.bravo}?si=resource`,
    description: watch('ZZZZZZZZZZZ'),
    instructions: watch('YYYYYYYYYYY'),
    socialUrl: watch('XXXXXXXXXXX')
  });
  assert.deepEqual(sourceSummary(sources), [
    {
      videoId: VIDEO_IDS.alpha,
      sourceKind: 'drill-library-video',
      sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT,
      pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.DRILL_LIBRARY,
      fieldPath: 'youtubeUrl'
    },
    {
      videoId: VIDEO_IDS.bravo,
      sourceKind: 'drill-library-video',
      sourceRole: STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT,
      pathRole: STRUCTURED_REPLAY_CLIP_PATH_ROLES.DRILL_LIBRARY,
      fieldPath: 'resourceUrl'
    }
  ]);
  assert.deepEqual(extractStructuredReplayClipSources('drillLibrary/drill-2', {
    youtubeUrl: 'https://vimeo.com/123456789',
    resourceUrl: 'https://example.com/drill.pdf'
  }), []);
});

test('does not inventory social, free-text, or intentional athlete profile media', () => {
  const document = {
    title: watch(VIDEO_IDS.alpha),
    description: watch(VIDEO_IDS.bravo),
    notes: { markdown: watch(VIDEO_IDS.charlie) },
    gameClips: [{ provider: 'youtube', videoId: VIDEO_IDS.delta }],
    seasons: [{ clips: [{ url: watch(VIDEO_IDS.echo) }] }]
  };
  assert.deepEqual(extractStructuredReplayClipSources('athleteProfiles/player-1', document), []);
  assert.deepEqual(extractStructuredReplayClipSources('teams/team-1/posts/post-1', document), []);
  assert.deepEqual(extractStructuredReplayClipSources('socialPosts/post-1', document), []);
});

test('builds a deterministic split report and deduplicates repeated source observations', () => {
  const team = extractStructuredReplayClipSources('teams/team-1', {
    youtubeVideoId: VIDEO_IDS.alpha,
    streamEmbedUrl: embed(VIDEO_IDS.alpha)
  });
  const broadcast = extractStructuredReplayClipSources('teams/team-1/games/game-1', {
    broadcastSession: {
      provider: { type: 'youtube', videoId: VIDEO_IDS.alpha }
    }
  });
  const media = extractStructuredReplayClipSources('teams/team-1/mediaItems/item-1', {
    type: 'video-link',
    url: watch(VIDEO_IDS.bravo)
  });
  const report = buildStructuredReplayClipIdentityReport([
    ...team,
    ...broadcast,
    ...media,
    team[0]
  ]);

  assert.deepEqual(report.videoIds, [VIDEO_IDS.alpha, VIDEO_IDS.bravo]);
  assert.deepEqual(report.independentVideoIds, [VIDEO_IDS.alpha, VIDEO_IDS.bravo]);
  assert.deepEqual(report.automatedCopyVideoIds, [VIDEO_IDS.alpha]);
  assert.equal(report.independentSources.length, 3);
  assert.equal(report.automatedCopies.length, 1);
  assert.deepEqual(report.summary, {
    sourceCount: 4,
    independentSourceCount: 3,
    automatedCopyCount: 1,
    identityCount: 2,
    urlIdentityCount: 2,
    protectedOverlapCount: 0,
    independentProtectedOverlapCount: 0,
    automatedProtectedCopyCount: 0,
    protectedUrlOverlapCount: 0,
    independentProtectedUrlOverlapCount: 0,
    automatedProtectedUrlCopyCount: 0
  });
  assert.deepEqual(report.identities.map((identity) => ({
    videoId: identity.videoId,
    sourceCount: identity.sourceCount,
    independentSourceCount: identity.independentSourceCount,
    automatedCopyCount: identity.automatedCopyCount
  })), [
    { videoId: VIDEO_IDS.alpha, sourceCount: 3, independentSourceCount: 2, automatedCopyCount: 1 },
    { videoId: VIDEO_IDS.bravo, sourceCount: 1, independentSourceCount: 1, automatedCopyCount: 0 }
  ]);
});

test('reports every protected overlap with its independent and automated source evidence', () => {
  const sources = [
    ...extractStructuredReplayClipSources('teams/team-1', { youtubeVideoId: VIDEO_IDS.alpha }),
    ...extractStructuredReplayClipSources('teams/team-1/games/game-1', {
      broadcastSession: { provider: { type: 'youtube', videoId: VIDEO_IDS.alpha } }
    }),
    ...extractStructuredReplayClipSources('teams/team-1/games/game-2', {
      broadcastSession: { provider: { type: 'youtube', videoId: VIDEO_IDS.charlie } }
    }),
    ...extractStructuredReplayClipSources('drillLibrary/drill-1', { youtubeUrl: watch(VIDEO_IDS.bravo) })
  ];
  const report = buildStructuredReplayClipIdentityReport(sources, {
    protectedVideoIds: { youtubeVideoIds: new Set([VIDEO_IDS.alpha, VIDEO_IDS.charlie]) }
  });

  assert.equal(report.protectedOverlaps.length, 2);
  assert.equal(report.protectedOverlaps[0].videoId, VIDEO_IDS.alpha);
  assert.equal(report.protectedOverlaps[0].independentSourceCount, 1);
  assert.equal(report.protectedOverlaps[0].automatedCopyCount, 1);
  assert.deepEqual(
    report.independentProtectedOverlaps.map((identity) => identity.videoId),
    [VIDEO_IDS.alpha]
  );
  assert.deepEqual(
    report.automatedProtectedCopies.map((identity) => identity.videoId),
    [VIDEO_IDS.charlie]
  );
  assert.equal(report.summary.protectedOverlapCount, 2);
  assert.equal(report.summary.independentProtectedOverlapCount, 1);
  assert.equal(report.summary.automatedProtectedCopyCount, 1);
  assert.throws(
    () => assertNoStructuredReplayProtectedOverlap(report),
    (error) => error?.code === 'failed-precondition' && error.report === report
  );
});

test('builds permanent exclusion upserts for every role and never emits identity deletes', () => {
  const sources = [
    ...extractStructuredReplayClipSources('teams/team-1', { youtubeVideoId: VIDEO_IDS.alpha }),
    ...extractStructuredReplayClipSources('teams/team-1/games/game-1', {
      broadcastSession: { provider: { type: 'youtube', videoId: VIDEO_IDS.alpha } }
    }),
    ...extractStructuredReplayClipSources('organizations/org-1/sharedGames/game-2', {
      status: 'live',
      videoUrl: watch(VIDEO_IDS.bravo)
    })
  ];
  const plan = buildPermanentReplayClipIdentityInputs(sources);
  const alphaIdentity = getReplayClipYouTubeIdentityRecord(VIDEO_IDS.alpha);
  const bravoIdentity = getReplayClipYouTubeIdentityRecord(VIDEO_IDS.bravo);

  assert.deepEqual(plan.upserts, [
    {
      videoId: VIDEO_IDS.alpha,
      ...alphaIdentity,
      sourceKinds: ['game-broadcast-provider', 'team-fixed-video'],
      sourceRoles: ['automated-copy', 'independent']
    },
    {
      videoId: VIDEO_IDS.bravo,
      ...bravoIdentity,
      sourceKinds: ['game-active-video-url'],
      sourceRoles: ['independent']
    }
  ]);
  assert.deepEqual(plan.deletes, []);

  const removalPlan = buildPermanentReplayClipIdentityInputs([]);
  assert.deepEqual(removalPlan.upserts, []);
  assert.deepEqual(removalPlan.deletes, []);
});

test('rejects protected overlap before producing a permanent reservation plan', () => {
  const sources = extractStructuredReplayClipSources('teams/team-1/mediaItems/item-1', {
    type: 'video-link',
    url: watch(VIDEO_IDS.alpha)
  });
  assert.throws(
    () => buildPermanentReplayClipIdentityInputs(sources, {
      protectedVideoIds: [VIDEO_IDS.alpha]
    }),
    (error) => error?.code === 'failed-precondition'
      && error.report?.protectedOverlaps?.[0]?.videoId === VIDEO_IDS.alpha
  );
});

test('fails closed for malformed report sources and protected identity inputs', () => {
  const [source] = extractStructuredReplayClipSources('teams/team-1', {
    youtubeVideoId: VIDEO_IDS.alpha
  });
  assert.throws(
    () => buildStructuredReplayClipIdentityReport([{ ...source, videoId: 'short' }]),
    /source metadata is invalid/
  );
  assert.throws(
    () => buildStructuredReplayClipIdentityReport([{ ...source, sourceKind: 'unlisted-source' }]),
    /source metadata is invalid/
  );
  assert.throws(
    () => buildStructuredReplayClipIdentityReport([{ ...source, sourceRole: 'automated-copy' }]),
    /source metadata is invalid/
  );
  assert.throws(
    () => buildStructuredReplayClipIdentityReport([source], { protectedVideoIds: ['short'] }),
    /invalid YouTube video ID/
  );
  assert.throws(
    () => buildStructuredReplayClipIdentityReport([source], { protectedVideoIds: { youtubeVideoIds: 'not-a-set' } }),
    /must provide a YouTube video ID set or array/
  );
});
