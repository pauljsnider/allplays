const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PUBLIC_HOMEPAGE_MAX_CANDIDATES_PER_QUERY,
  PUBLIC_HOMEPAGE_MAX_TEAM_IDS_PER_CANDIDATE,
  buildSharedGameSyntheticId,
  buildPublicHomepageCandidateBatch,
  buildPublicHomepageGamesResponse,
  buildPublicHomepageTeamIdBatch,
  limitPublicHomepageCandidates,
  serializeHomepageGame,
  serializePublicHomepageCandidates
} = require('../public-homepage-games-core.cjs');

const publicTeam = {
  id: 'team-public',
  name: 'Public Tigers',
  sport: 'Soccer',
  isPublic: true,
  active: true,
  ownerEmail: 'private@example.com'
};

test('homepage serializer exposes only public game and team fields', () => {
  const game = serializeHomepageGame({
    id: 'game-1',
    date: '2026-07-28T18:00:00Z',
    opponent: 'Falcons',
    liveStatus: 'live',
    homeScore: 3,
    awayScore: 2,
    liveViewerCount: 12,
    assignments: [{ email: 'private@example.com' }],
    notes: 'private note'
  }, 'team-public', publicTeam);

  assert.deepEqual(game, {
    id: 'game-1',
    teamId: 'team-public',
    opponent: 'Falcons',
    date: '2026-07-28T18:00:00.000Z',
    endsAt: null,
    location: '',
    isHome: true,
    status: '',
    liveStatus: 'live',
    homeScore: 3,
    awayScore: 2,
    liveViewerCount: 12,
    videoLifecycle: 'live',
    videoUrl: null,
    isSharedGame: false,
    team: {
      id: 'team-public',
      name: 'Public Tigers',
      sport: 'Soccer',
      photoUrl: null,
      city: null,
      state: null,
      zip: null
    }
  });
  const json = JSON.stringify(game);
  assert.equal(json.includes('ownerEmail'), false);
  assert.equal(json.includes('assignments'), false);
  assert.equal(json.includes('private note'), false);
});

test('homepage serializer does not publish completed replay URLs for a gated team', () => {
  const game = serializeHomepageGame({
    id: 'gated-replay',
    date: '2026-07-28T18:00:00Z',
    opponent: 'Falcons',
    status: 'completed',
    videoUrl: 'https://www.youtube.com/watch?v=privateReplay1',
    replayVideo: { publicUrl: 'https://cdn.example.test/private-replay.mp4' }
  }, 'team-public', {
    ...publicTeam,
    teamPassConfig: { recordedReplayPaywallEnabled: true }
  });

  assert.equal(game.videoUrl, null);
  assert.equal(JSON.stringify(game).includes('privateReplay1'), false);
  assert.equal(JSON.stringify(game).includes('private-replay'), false);
});

test('homepage projection preserves and classifies the ordered replay lifecycle', async () => {
  const candidates = [
    {
      id: 'statsheet',
      date: '2026-07-28T18:00:00Z',
      status: 'completed',
      liveStatus: 'scheduled',
      replayVideo: {
        provider: 'youtube',
        videoId: 'PK1HyC37doc',
        embedUrl: 'https://www.youtube.com/embed/PK1HyC37doc',
        publicUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
        status: 'ready'
      }
    },
    { id: 'report-only-statsheet', date: '2026-07-28T18:30:00Z', status: 'completed', liveStatus: 'scheduled' },
    { id: 'reverse', date: '2026-07-28T19:00:00Z', status: 'scheduled', liveStatus: 'completed' },
    { id: 'contradictory-live', date: '2026-07-28T20:00:00Z', status: 'completed', liveStatus: 'live' },
    { id: 'contradictory-cancelled', date: '2026-07-28T21:00:00Z', status: 'completed', liveStatus: 'cancelled' },
    { id: 'pure-live', date: '2026-07-28T22:00:00Z', status: 'scheduled', liveStatus: 'live' },
    { id: 'upcoming', date: '2026-07-29T00:00:00Z', status: 'scheduled', liveStatus: 'scheduled' },
    {
      id: 'legacy-final-replay',
      date: '2026-07-29T00:10:00Z',
      status: 'final',
      replayVideo: {
        provider: 'youtube',
        videoId: 'PK1HyC37doc',
        embedUrl: 'https://www.youtube.com/embed/PK1HyC37doc',
        publicUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
        status: 'ready'
      }
    },
    { id: 'legacy-live-final', date: '2026-07-29T00:20:00Z', liveStatus: 'final' },
    {
      id: 'padded-completed',
      date: '2026-07-29T01:00:00Z',
      status: ' completed ',
      liveStatus: 'scheduled',
      replayVideo: {
        provider: 'youtube',
        videoId: 'PK1HyC37doc',
        embedUrl: 'https://www.youtube.com/embed/PK1HyC37doc',
        publicUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
        status: 'ready'
      }
    },
    { id: 'uppercase-live', date: '2026-07-29T02:00:00Z', status: 'scheduled', liveStatus: 'LIVE', videoUrl: 'https://live.example.test/feed' },
    { id: 'complete-alias', date: '2026-07-29T03:00:00Z', status: 'complete', liveStatus: 'scheduled' },
    { id: 'finished-alias', date: '2026-07-29T04:00:00Z', status: 'finished', liveStatus: 'scheduled' },
    { id: 'nonstring-status', date: '2026-07-29T05:00:00Z', status: { private: true }, liveStatus: 'scheduled' },
    { id: 'padded-type', date: '2026-07-29T06:00:00Z', type: ' game ', status: 'scheduled', liveStatus: 'live', videoUrl: 'https://live.example.test/feed' }
  ];
  const serialize = (category) => serializePublicHomepageCandidates({
    candidates,
    category,
    getTeamIds: () => ['team-public'],
    getTeam: async () => publicTeam
  });

  const [replays, live, upcoming] = await Promise.all([
    serialize('replays'),
    serialize('live'),
    serialize('upcoming')
  ]);
  assert.deepEqual(replays.games.map((game) => game.id), ['statsheet', 'legacy-final-replay', 'legacy-live-final']);
  assert.deepEqual(live.games.map((game) => game.id), ['pure-live']);
  assert.deepEqual(upcoming.games.map((game) => game.id), ['upcoming']);
  const statsheetProjection = serializeHomepageGame(candidates[0], 'team-public', publicTeam);
  assert.equal(statsheetProjection.status, 'completed');
  assert.equal(statsheetProjection.liveStatus, 'scheduled');
  assert.equal(statsheetProjection.videoLifecycle, 'completed');

  for (const candidate of [candidates[9], candidates[10], candidates[13], candidates[14]]) {
    const projection = serializeHomepageGame(candidate, 'team-public', publicTeam);
    assert.equal(projection.videoLifecycle, 'invalid');
    assert.equal(projection.videoUrl, null);
    assert.equal(
      [...replays.games, ...live.games, ...upcoming.games].some((game) => game.id === candidate.id),
      false
    );
  }

  for (const candidate of [candidates[11], candidates[12]]) {
    const projection = serializeHomepageGame(candidate, 'team-public', publicTeam);
    assert.equal(projection.status, 'completed');
    assert.equal(projection.videoLifecycle, 'completed');
    assert.equal(projection.videoUrl, null);
  }

  const privateStatusGame = serializeHomepageGame({
    id: 'private-status',
    date: '2026-07-28T23:00:00Z',
    status: 'SENTINEL_PRIVATE_STATUS',
    liveStatus: 'SENTINEL_PRIVATE_LIVE_STATUS'
  }, 'team-public', publicTeam);
  assert.equal(privateStatusGame.status, 'invalid');
  assert.equal(privateStatusGame.liveStatus, 'invalid');
  assert.equal(privateStatusGame.videoLifecycle, 'invalid');
  assert.equal(JSON.stringify(privateStatusGame).includes('SENTINEL_PRIVATE'), false);
});

test('homepage serializer rejects private teams and unsafe games', () => {
  assert.equal(serializeHomepageGame(
    { id: 'game-1', date: '2026-07-28T18:00:00Z' },
    'team-private',
    { ...publicTeam, isPublic: false }
  ), null);
  assert.equal(serializeHomepageGame(
    { id: 'game-1', date: '2026-07-28T18:00:00Z', visibility: 'private' },
    'team-public',
    publicTeam
  ), null);
});

test('homepage response sorts, deduplicates, and enforces the public result cap', () => {
  const games = Array.from({ length: 8 }, (_, index) => ({
    id: `game-${index}`,
    teamId: 'team-public',
    date: `2026-07-${String(index + 10).padStart(2, '0')}T18:00:00.000Z`
  }));
  const response = buildPublicHomepageGamesResponse({
    live: [games[1], games[1]],
    upcoming: [...games].reverse(),
    replays: games
  });

  assert.equal(response.live.length, 1);
  assert.deepEqual(response.upcoming.map((game) => game.id), games.slice(0, 6).map((game) => game.id));
  assert.deepEqual(response.replays.map((game) => game.id), [...games].reverse().slice(0, 6).map((game) => game.id));
  assert.equal(PUBLIC_HOMEPAGE_MAX_CANDIDATES_PER_QUERY, 120);
});

test('homepage candidate overflow truncates at the scan budget without failing discovery', () => {
  const candidates = Array.from({ length: 121 }, (_, index) => ({ id: `candidate-${index}` }));
  const limited = limitPublicHomepageCandidates(candidates);

  assert.equal(limited.length, PUBLIC_HOMEPAGE_MAX_CANDIDATES_PER_QUERY);
  assert.equal(limited[0].id, 'candidate-0');
  assert.equal(limited.at(-1).id, 'candidate-119');
  assert.equal(candidates.length, 121);
});

test('mixed-visibility overflow is explicitly marked partial when a public candidate falls beyond the scan budget', () => {
  const candidates = [
    ...Array.from({ length: PUBLIC_HOMEPAGE_MAX_CANDIDATES_PER_QUERY }, (_, index) => ({
      id: `private-${index}`,
      visibility: 'private'
    })),
    { id: 'public-beyond-budget', visibility: 'public' }
  ];
  const batch = buildPublicHomepageCandidateBatch(candidates);
  const response = buildPublicHomepageGamesResponse({
    live: [],
    partialCategories: batch.truncated ? ['live'] : []
  });

  assert.equal(batch.candidates.some((candidate) => candidate.id === 'public-beyond-budget'), false);
  assert.equal(batch.truncated, true);
  assert.equal(response.partial, true);
  assert.deepEqual(response.partialCategories, ['live']);
});

test('team lookup failures mark the affected homepage category partial', async () => {
  const errors = [];
  const result = await serializePublicHomepageCandidates({
    candidates: [{ id: 'game-1', _teamId: 'team-unavailable' }],
    category: 'live',
    getTeamIds: (candidate) => [candidate._teamId],
    getTeam: async () => {
      throw new Error('transient team read failure');
    },
    onTeamError: (failure) => errors.push(failure)
  });

  assert.deepEqual(result.games, []);
  assert.equal(result.partial, true);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].teamId, 'team-unavailable');
});

test('oversized shared-game team ID arrays are validated, capped, and marked partial', async () => {
  const batch = buildPublicHomepageTeamIdBatch([
    'team-home',
    'team-away',
    '../invalid',
    'team-extra-1',
    'team-extra-2',
    'team-home'
  ]);
  const lookups = [];
  const result = await serializePublicHomepageCandidates({
    candidates: [{ id: 'shared-oversized' }],
    category: 'live',
    getTeamIds: () => batch,
    getTeam: async (teamId) => {
      lookups.push(teamId);
      return null;
    }
  });

  assert.equal(PUBLIC_HOMEPAGE_MAX_TEAM_IDS_PER_CANDIDATE, 2);
  assert.deepEqual(batch.teamIds, ['team-home', 'team-away']);
  assert.equal(batch.truncated, true);
  assert.deepEqual(lookups, ['team-home', 'team-away']);
  assert.deepEqual(result, { games: [], partial: true });
});

test('aggregate unique team lookup exhaustion marks only affected serialization partial', async () => {
  const teamLookupBudget = {
    seenTeamIds: new Set(),
    maxUniqueTeamLookups: 3
  };
  const lookups = [];
  const makeCandidate = (teamId) => ({
    id: `game-${teamId}`,
    _teamId: teamId,
    date: '2026-07-28T18:00:00Z',
    liveStatus: 'live'
  });
  const serialize = (teamIds) => serializePublicHomepageCandidates({
    candidates: teamIds.map(makeCandidate),
    category: 'live',
    getTeamIds: (candidate) => [candidate._teamId],
    getTeam: async (teamId) => {
      lookups.push(teamId);
      return publicTeam;
    },
    teamLookupBudget
  });

  const first = await serialize(['team-1', 'team-2']);
  const affected = await serialize(['team-2', 'team-3', 'team-4']);

  assert.equal(first.partial, false);
  assert.equal(affected.partial, true);
  assert.deepEqual(lookups, ['team-1', 'team-2', 'team-2', 'team-3']);
  assert.deepEqual([...teamLookupBudget.seenTeamIds], ['team-1', 'team-2', 'team-3']);
  assert.equal(affected.games.some((game) => game.teamId === 'team-4'), false);
});

test('private or missing teams remain an authoritative omission', async () => {
  const result = await serializePublicHomepageCandidates({
    candidates: [{ id: 'game-1', _teamId: 'team-private' }],
    category: 'live',
    getTeamIds: (candidate) => [candidate._teamId],
    getTeam: async () => null
  });

  assert.deepEqual(result, { games: [], partial: false });
});

test('shared games are projected from the selected public team perspective', () => {
  const sharedGamePath = 'events/event with spaces/sharedGames/shared-1';
  const game = serializeHomepageGame({
    id: 'shared-1',
    _sharedGamePath: sharedGamePath,
    date: '2026-07-28T18:00:00Z',
    homeTeamId: 'team-public',
    homeTeamName: 'Public Tigers',
    awayTeamId: 'team-away',
    awayTeamName: 'Falcons',
    homeScore: 4,
    awayScore: 1,
    isSharedGame: true
  }, 'team-public', publicTeam);

  assert.equal(game.teamId, 'team-public');
  assert.equal(game.opponent, 'Falcons');
  assert.equal(game.homeScore, 4);
  assert.equal(game.isSharedGame, true);
  assert.equal(game.id, buildSharedGameSyntheticId(sharedGamePath));
  assert.equal(
    decodeURIComponent(game.id.slice('shared_'.length)),
    sharedGamePath
  );
});
