import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSearchTeam } from './searchService';

const legacySearchDbMocks = vi.hoisted(() => ({
  collection: vi.fn(),
  db: {},
  doc: vi.fn(),
  executeBoundedPlayerSearch: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  isTeamActive: vi.fn(() => true),
  limit: vi.fn(),
  orderBy: vi.fn(),
  playerSearchFirestoreQueryBudget: 12,
  playerSearchResultLimit: 20,
  query: vi.fn(),
  where: vi.fn()
}));

const publicTeamsServiceMocks = vi.hoisted(() => ({
  getPublicTeamsPage: vi.fn()
}));

vi.mock('./adapters/legacySearchDb', () => legacySearchDbMocks);
vi.mock('./homeService', () => ({
  loadParentHomeSummary: vi.fn()
}));
vi.mock('./helpKnowledgeService', () => ({
  searchHelpKnowledge: vi.fn(() => [])
}));
vi.mock('./publicTeamsService', () => publicTeamsServiceMocks);

import {
  resetAppSearchCache,
  searchAppPlayers,
  searchAppTeams
} from './searchService';

const searchCacheMaxEntries = 40;
const teamsById = new Map<string, AppSearchTeam>([
  ['team-1', { id: 'team-1', name: 'Rockets', isPublic: true }]
]);

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function buildPlayerDoc(rawQuery: string, name = `${rawQuery} Player`) {
  return {
    id: `player-${rawQuery}`,
    ref: { path: `teams/team-1/players/player-${rawQuery}` },
    data: () => ({ name })
  };
}

function buildPlayerSearchSnapshot(rawQuery: string, name?: string) {
  return {
    snapshots: [
      {
        status: 'fulfilled',
        value: { docs: [buildPlayerDoc(rawQuery, name)] }
      }
    ],
    nameQueryCount: 1,
    completedAllQueries: true
  };
}

function buildPublicTeamsResult(queryText: string) {
  return {
    teams: [
      {
        teamId: `team-${queryText}`,
        teamName: `${queryText} Team`,
        active: true,
        isPublic: true
      }
    ],
    nextCursor: null
  };
}

function uniqueQuery(index: number) {
  return `q${String(index).padStart(3, '0')}`;
}

describe('searchService app search caches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAppSearchCache();
    legacySearchDbMocks.isTeamActive.mockReturnValue(true);
    legacySearchDbMocks.executeBoundedPlayerSearch.mockImplementation(async (options: { rawQuery: string }) => (
      buildPlayerSearchSnapshot(options.rawQuery)
    ));
    publicTeamsServiceMocks.getPublicTeamsPage.mockImplementation(async ({ searchText }: { searchText: string }) => (
      buildPublicTeamsResult(searchText)
    ));
  });

  it('evicts older completed player cache entries while keeping newer queries reusable', async () => {
    const maxEntries = searchCacheMaxEntries;

    for (let index = 0; index < maxEntries + 2; index += 1) {
      await searchAppPlayers(uniqueQuery(index), teamsById, null);
    }

    expect(legacySearchDbMocks.executeBoundedPlayerSearch).toHaveBeenCalledTimes(maxEntries + 2);

    await searchAppPlayers(uniqueQuery(maxEntries + 1), teamsById, null);
    expect(legacySearchDbMocks.executeBoundedPlayerSearch).toHaveBeenCalledTimes(maxEntries + 2);

    await searchAppPlayers(uniqueQuery(0), teamsById, null);
    expect(legacySearchDbMocks.executeBoundedPlayerSearch).toHaveBeenCalledTimes(maxEntries + 3);
  });

  it('keeps retained player source docs available for prefix reuse after eviction', async () => {
    const maxEntries = searchCacheMaxEntries;

    for (let index = 0; index < maxEntries; index += 1) {
      await searchAppPlayers(uniqueQuery(index), teamsById, null);
    }
    legacySearchDbMocks.executeBoundedPlayerSearch.mockImplementation(async (options: { rawQuery: string }) => (
      options.rawQuery === 'al'
        ? buildPlayerSearchSnapshot(options.rawQuery, 'Alana Ace')
        : buildPlayerSearchSnapshot(options.rawQuery)
    ));
    await searchAppPlayers('al', teamsById, null);
    const callsAfterRetainedPrefix = legacySearchDbMocks.executeBoundedPlayerSearch.mock.calls.length;

    const players = await searchAppPlayers('alan', teamsById, null);

    expect(legacySearchDbMocks.executeBoundedPlayerSearch).toHaveBeenCalledTimes(callsAfterRetainedPrefix);
    expect(players).toEqual([
      expect.objectContaining({
        title: 'Alana Ace',
        route: '/players/team-1/player-al'
      })
    ]);
  });

  it('does not evict in-flight player searches before they settle', async () => {
    const maxEntries = searchCacheMaxEntries;
    const pendingPlayerSearch = createDeferred<ReturnType<typeof buildPlayerSearchSnapshot>>();
    legacySearchDbMocks.executeBoundedPlayerSearch.mockImplementation((options: { rawQuery: string }) => (
      options.rawQuery === 'pending' ? pendingPlayerSearch.promise : Promise.resolve(buildPlayerSearchSnapshot(options.rawQuery))
    ));

    const firstPendingResult = searchAppPlayers('pending', teamsById, null);
    for (let index = 0; index < maxEntries + 1; index += 1) {
      await searchAppPlayers(uniqueQuery(index), teamsById, null);
    }
    const secondPendingResult = searchAppPlayers('pending', teamsById, null);

    expect(legacySearchDbMocks.executeBoundedPlayerSearch.mock.calls.filter(([options]) => options.rawQuery === 'pending')).toHaveLength(1);
    pendingPlayerSearch.resolve(buildPlayerSearchSnapshot('pending'));
    await expect(firstPendingResult).resolves.toEqual([
      expect.objectContaining({ route: '/players/team-1/player-pending' })
    ]);
    await expect(secondPendingResult).resolves.toEqual([
      expect.objectContaining({ route: '/players/team-1/player-pending' })
    ]);

    await searchAppPlayers('pending', teamsById, null);
    expect(legacySearchDbMocks.executeBoundedPlayerSearch.mock.calls.filter(([options]) => options.rawQuery === 'pending')).toHaveLength(1);
  });

  it('bounds completed public team cache entries and dedupes concurrent identical requests', async () => {
    const maxEntries = searchCacheMaxEntries;
    const pendingPublicSearch = createDeferred<ReturnType<typeof buildPublicTeamsResult>>();
    publicTeamsServiceMocks.getPublicTeamsPage.mockImplementation(({ searchText }: { searchText: string }) => (
      searchText === 'pending' ? pendingPublicSearch.promise : Promise.resolve(buildPublicTeamsResult(searchText))
    ));

    const firstPendingResult = searchAppTeams('pending', [], null);
    for (let index = 0; index < maxEntries + 2; index += 1) {
      await searchAppTeams(uniqueQuery(index), [], null);
    }
    const secondPendingResult = searchAppTeams('pending', [], null);

    expect(publicTeamsServiceMocks.getPublicTeamsPage.mock.calls.filter(([options]) => options.searchText === 'pending')).toHaveLength(1);

    pendingPublicSearch.resolve(buildPublicTeamsResult('pending'));
    await expect(firstPendingResult).resolves.toEqual([
      expect.objectContaining({ id: 'team-pending', name: 'pending Team' })
    ]);
    await expect(secondPendingResult).resolves.toEqual([
      expect.objectContaining({ id: 'team-pending', name: 'pending Team' })
    ]);

    await searchAppTeams(uniqueQuery(maxEntries + 1), [], null);
    expect(publicTeamsServiceMocks.getPublicTeamsPage.mock.calls.filter(([options]) => options.searchText === uniqueQuery(maxEntries + 1))).toHaveLength(1);

    await searchAppTeams(uniqueQuery(0), [], null);
    expect(publicTeamsServiceMocks.getPublicTeamsPage.mock.calls.filter(([options]) => options.searchText === uniqueQuery(0))).toHaveLength(2);
  });

  it('uses lightweight public team pages and caches normalized search metadata', async () => {
    publicTeamsServiceMocks.getPublicTeamsPage.mockResolvedValue({
      teams: [{
        teamId: 'team-austin',
        teamName: 'Austin Bats',
        sport: 'Baseball',
        photoUrl: 'https://example.com/team.png',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        location: 'Austin, TX',
        isPublic: true
      }],
      nextCursor: null
    });

    await expect(searchAppTeams('Austin', [], null)).resolves.toEqual([
      expect.objectContaining({
        id: 'team-austin',
        name: 'Austin Bats',
        sport: 'Baseball',
        photoUrl: 'https://example.com/team.png',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        location: 'Austin, TX',
        isPublic: true
      })
    ]);
    await searchAppTeams(' Austin ', [], null);

    expect(publicTeamsServiceMocks.getPublicTeamsPage).toHaveBeenCalledTimes(1);
    expect(publicTeamsServiceMocks.getPublicTeamsPage).toHaveBeenCalledWith({
      searchText: 'Austin',
      pageSize: 20,
      includeRosterCounts: false
    });
  });
});
