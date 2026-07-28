const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PUBLIC_HOMEPAGE_MAX_CANDIDATES_PER_QUERY,
  buildPublicHomepageCandidateBatch,
  buildPublicHomepageGamesResponse,
  limitPublicHomepageCandidates,
  serializeHomepageGame
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
    status: 'live',
    liveStatus: 'live',
    homeScore: 3,
    awayScore: 2,
    liveViewerCount: 12,
    videoUrl: null,
    isSharedGame: false,
    team: {
      id: 'team-public',
      name: 'Public Tigers',
      sport: 'Soccer',
      photoUrl: null
    }
  });
  const json = JSON.stringify(game);
  assert.equal(json.includes('ownerEmail'), false);
  assert.equal(json.includes('assignments'), false);
  assert.equal(json.includes('private note'), false);
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

test('shared games are projected from the selected public team perspective', () => {
  const game = serializeHomepageGame({
    id: 'shared-1',
    _sharedGamePath: 'events/event-1/sharedGames/shared-1',
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
  assert.match(game.id, /^shared_/);
});
