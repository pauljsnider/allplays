import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the vendored Firestore data layer so we can observe exactly which queries
// player search issues. collection() returns the collection path, query() passes
// the path through, and getDocs() records the path it was asked to read.
const firebaseMocks = vi.hoisted(() => {
  const getDocsCalls: string[] = [];
  return {
    getDocsCalls,
    db: {},
    collection: vi.fn((_db: unknown, path: string) => path),
    doc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(async (path: string) => {
      getDocsCalls.push(path);
      return { docs: [] };
    }),
    query: vi.fn((path: string) => path),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn()
  };
});

vi.mock('../../../../js/firebase.js', () => firebaseMocks);
vi.mock('./homeService', () => ({ loadParentHomeSummary: vi.fn() }));
vi.mock('./helpKnowledgeService', () => ({ searchHelpKnowledge: vi.fn(() => []) }));

import { searchAppPlayers, resetAppSearchCacheForTests } from './searchService';

function makeTeamMap() {
  return new Map<string, any>([
    ['team-a', { id: 'team-a', name: 'Aces', isPublic: true }],
    ['team-b', { id: 'team-b', name: 'Bears', isPublic: true }]
  ]);
}

const user = { uid: 'parent-1', email: 'p@example.com', parentOf: [] } as any;

describe('searchAppPlayers — no collectionGroup cascade (regression for #2036)', () => {
  beforeEach(() => {
    firebaseMocks.getDocsCalls.length = 0;
    firebaseMocks.getDocs.mockClear();
    resetAppSearchCacheForTests();
  });

  afterEach(() => {
    resetAppSearchCacheForTests();
  });

  it('does not query Firestore for single-character input (min length guard)', async () => {
    const result = await searchAppPlayers('a', makeTeamMap(), user);
    expect(result).toEqual([]);
    expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
  });

  it('only issues scoped per-team player queries (never a collectionGroup scan)', async () => {
    await searchAppPlayers('smith', makeTeamMap(), user);
    expect(firebaseMocks.getDocs).toHaveBeenCalled();
    // Every read targets a specific team's players subcollection...
    for (const path of firebaseMocks.getDocsCalls) {
      expect(path).toMatch(/^teams\/team-[ab]\/players$/);
    }
    // ...and the module never imports/builds a collectionGroup query.
    expect(firebaseMocks.getDocsCalls.some((path) => !path.startsWith('teams/'))).toBe(false);
  });

  it('serves a repeated identical search from the session cache with no new reads', async () => {
    await searchAppPlayers('smith', makeTeamMap(), user);
    const firstCallCount = firebaseMocks.getDocs.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    await searchAppPlayers('smith', makeTeamMap(), user);
    // No additional Firestore reads on the second identical search.
    expect(firebaseMocks.getDocs.mock.calls.length).toBe(firstCallCount);
  });
});
