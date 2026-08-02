import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  auth: { currentUser: null },
  collection: vi.fn((_database, path) => ({ path })),
  doc: vi.fn((_database, path, id) => ({ path: `${path}/${id}` })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  listPublicTeams: vi.fn(),
  getPublicTeamProfile: vi.fn(),
  getPublicTeamGamesProjection: vi.fn(),
  getPublicTeamCalendarProjection: vi.fn(),
  getPublicGameProjection: vi.fn(),
  query: vi.fn((collectionRef, ...constraints) => ({ collectionRef, constraints })),
  where: vi.fn((field, op, value) => ({ field, op, value })),
  onSnapshot: vi.fn()
}));

vi.mock('../../js/firebase.js?v=23', () => ({
  db: {},
  auth: firebaseMocks.auth,
  storage: {},
  collection: firebaseMocks.collection,
  getDocs: firebaseMocks.getDocs,
  getDoc: firebaseMocks.getDoc,
  doc: firebaseMocks.doc,
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  setDoc: vi.fn(),
  query: firebaseMocks.query,
  where: firebaseMocks.where,
  orderBy: vi.fn((field, direction) => ({ orderBy: field, direction })),
  Timestamp: { now: vi.fn(), fromDate: vi.fn((date) => ({ date })) },
  increment: vi.fn(),
  arrayUnion: vi.fn(),
  arrayRemove: vi.fn(),
  deleteField: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  getCountFromServer: vi.fn(),
  onSnapshot: firebaseMocks.onSnapshot,
  serverTimestamp: vi.fn(),
  collectionGroup: vi.fn(),
  documentId: vi.fn(),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
  functions: {},
  httpsCallable: vi.fn((_functions, name) => {
    if (name === 'listPublicTeams') return firebaseMocks.listPublicTeams;
    if (name === 'getPublicTeamProfile') return firebaseMocks.getPublicTeamProfile;
    if (name === 'getPublicTeamGamesProjection') return firebaseMocks.getPublicTeamGamesProjection;
    if (name === 'getPublicTeamCalendarProjection') return firebaseMocks.getPublicTeamCalendarProjection;
    if (name === 'getPublicGameProjection') return firebaseMocks.getPublicGameProjection;
    throw new Error(`Unexpected callable: ${name}`);
  }),
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn()
}));

vi.mock('../../js/firebase.js?v=22', async () => import('../../js/firebase.js?v=23'));

vi.mock('../../js/firebase-images.js?v=11', () => ({
  imageStorage: {},
  ensureImageAuth: vi.fn(),
  requireImageAuth: vi.fn()
}));

function createTeamDoc(id, data) {
  return {
    id,
    data: () => data
  };
}

function getWhereConstraint(queryValue) {
  return queryValue.constraints.find((constraint) => constraint?.field);
}

const {
  getPublicTeamCalendarEvents,
  getGame,
  getGames,
  getOfficiatingGames,
  subscribeGame,
  getTeam,
  getTeams,
  getUserTeamsWithAccess
} = await import('../../js/db.js?v=148');

describe('team access query resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseMocks.auth.currentUser = {
      uid: 'owner-1',
      email: 'coach@example.com'
    };
    firebaseMocks.listPublicTeams.mockResolvedValue({
      data: { items: [], nextCursor: null }
    });
  });

  it('keeps public and owned teams when the optional admin-email query is denied', async () => {
    const ownedTeam = createTeamDoc('owned-1', { name: 'Vipers', ownerId: 'owner-1' });
    const permissionError = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied'
    });
    firebaseMocks.listPublicTeams.mockResolvedValue({
      data: {
        items: [{ id: 'public-1', name: 'Falcons', isPublic: true }],
        nextCursor: null
      }
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    firebaseMocks.getDocs.mockImplementation(async (queryValue) => {
      const constraint = getWhereConstraint(queryValue);
      if (constraint.field === 'ownerId') return { docs: [ownedTeam] };
      if (constraint.field === 'adminEmails') throw permissionError;
      throw new Error(`Unexpected query: ${constraint.field}`);
    });

    await expect(getTeams()).resolves.toEqual([
      { id: 'public-1', name: 'Falcons', isPublic: true },
      { id: 'owned-1', name: 'Vipers', ownerId: 'owner-1' }
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      'Unable to load teams granted through admin email; continuing with public and owned teams.',
      permissionError
    );
    expect(firebaseMocks.listPublicTeams).toHaveBeenCalled();
  });

  it('keeps owned and owner-email teams when the optional admin-email query is denied', async () => {
    const ownedTeam = createTeamDoc('owned-1', { name: 'Falcons', ownerId: 'owner-1' });
    const emailTeam = createTeamDoc('email-1', { name: 'Vipers', ownerEmail: 'coach@example.com' });
    const permissionError = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied'
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    firebaseMocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ email: 'coach@example.com' })
    });
    firebaseMocks.getDocs.mockImplementation(async (queryValue) => {
      const constraint = getWhereConstraint(queryValue);
      if (constraint.field === 'ownerId') return { docs: [ownedTeam] };
      if (constraint.field === 'adminEmails') throw permissionError;
      if (constraint.field === 'ownerEmail') return { docs: [emailTeam] };
      if (constraint.field === 'ownerEmailLower') return { docs: [] };
      throw new Error(`Unexpected query: ${constraint.field}`);
    });

    await expect(getUserTeamsWithAccess('owner-1', 'coach@example.com')).resolves.toEqual([
      { id: 'owned-1', name: 'Falcons', ownerId: 'owner-1' },
      { id: 'email-1', name: 'Vipers', ownerEmail: 'coach@example.com' }
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      'Optional team access query failed (adminEmails:coach@example.com).',
      permissionError
    );
  });

  it('recognizes namespaced permission errors when loading a public team projection', async () => {
    firebaseMocks.getDoc.mockRejectedValue(Object.assign(new Error('denied'), {
      code: 'firestore/permission-denied'
    }));
    firebaseMocks.getPublicTeamProfile.mockResolvedValue({
      data: {
        item: {
          id: 'public-1',
          name: 'Falcons',
          isPublic: true,
          active: true
        }
      }
    });

    await expect(getTeam('public-1')).resolves.toEqual({
      id: 'public-1',
      name: 'Falcons',
      isPublic: true,
      active: true
    });
    expect(firebaseMocks.getPublicTeamProfile).toHaveBeenCalledWith({ teamId: 'public-1' });
  });
});

describe('game access query resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseMocks.auth.currentUser = {
      uid: 'official-1',
      email: 'official@example.com'
    };
  });

  it('falls back to a sanitized public schedule projection when canonical reads are denied', async () => {
    firebaseMocks.getDocs.mockRejectedValue(Object.assign(new Error('denied'), {
      code: 'firestore/permission-denied'
    }));
    firebaseMocks.getPublicTeamGamesProjection.mockResolvedValue({
      data: {
        games: [{
          id: 'game-1',
          startsAt: '2026-08-01T18:00:00.000Z',
          opponent: 'Falcons',
          location: 'Public Field',
          isHome: true,
          teamScore: 3,
          opponentScore: 2,
          status: 'completed',
          summary: 'Final',
          tournament: { divisionName: '10U Gold', poolName: 'Pool A' },
          opponentStats: { opponent1: { name: 'Opponent One', points: 2 } },
          statSheetPhotoUrl: 'https://images.example.test/stat-sheet.png'
        }]
      }
    });

    const result = await getGames('team-1', {
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: new Date('2026-08-02T00:00:00.000Z')
    });

    expect(firebaseMocks.getPublicTeamGamesProjection).toHaveBeenCalledWith({
      teamId: 'team-1',
      from: '2026-08-01',
      to: '2026-08-02',
      limit: 500
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: 'game-1',
        teamId: 'team-1',
        opponent: 'Falcons',
        homeScore: 3,
        awayScore: 2,
        tournament: { divisionName: '10U Gold', poolName: 'Pool A' },
        opponentStats: { opponent1: { name: 'Opponent One', points: 2 } },
        statSheetPhotoUrl: 'https://images.example.test/stat-sheet.png',
        isPublicProjection: true
      })
    ]);
    expect(result[0]).not.toHaveProperty('assignments');
    expect(result[0]).not.toHaveProperty('gamePlan');
    expect(result[0]).not.toHaveProperty('notes');
  });

  it('maps a public calendar projection without exposing its source URL', async () => {
    firebaseMocks.getPublicTeamCalendarProjection.mockResolvedValue({
      data: {
        events: [{
          id: 'opaque-event',
          type: 'practice',
          startsAt: '2026-08-01T18:00:00.000Z',
          endsAt: '2026-08-01T20:00:00.000Z',
          title: 'Workout',
          location: 'Public Field',
          status: 'scheduled'
        }]
      }
    });

    const result = await getPublicTeamCalendarEvents('team-1', {
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: new Date('2026-08-02T00:00:00.000Z')
    });

    expect(firebaseMocks.getPublicTeamCalendarProjection).toHaveBeenCalledWith({
      teamId: 'team-1',
      from: '2026-08-01',
      to: '2026-08-02',
      limit: 500
    });
    expect(result).toEqual([expect.objectContaining({
      id: 'opaque-event',
      uid: 'opaque-event',
      type: 'practice',
      summary: 'Workout',
      location: 'Public Field',
      status: 'SCHEDULED',
      isPublicProjection: true
    })]);
    expect(result[0]).not.toHaveProperty('sourceUrl');
  });

  it('follows projection cursors so schedules and calendars retain entries beyond 500', async () => {
    const games = Array.from({ length: 500 }, (_, index) => ({
      id: `game-${index}`,
      startsAt: `2026-08-${String((index % 28) + 1).padStart(2, '0')}T18:00:00.000Z`,
      opponent: 'Falcons'
    }));
    const events = Array.from({ length: 500 }, (_, index) => ({
      id: `event-${index}`,
      type: 'practice',
      startsAt: `2026-08-${String((index % 28) + 1).padStart(2, '0')}T18:00:00.000Z`,
      title: 'Practice'
    }));
    firebaseMocks.getDocs.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    firebaseMocks.getPublicTeamGamesProjection
      .mockResolvedValueOnce({ data: { games, range: { truncated: true }, nextCursor: 'games-page-2' } })
      .mockResolvedValueOnce({ data: { games: [{ id: 'game-500', startsAt: '2026-09-01T18:00:00.000Z', opponent: 'Rockets' }], range: { truncated: false } } });
    firebaseMocks.getPublicTeamCalendarProjection
      .mockResolvedValueOnce({ data: { events, range: { truncated: true }, nextCursor: 'calendar-page-2' } })
      .mockResolvedValueOnce({ data: { events: [{ id: 'event-500', type: 'practice', startsAt: '2026-09-01T18:00:00.000Z', title: 'Practice' }], range: { truncated: false } } });

    const [projectedGames, projectedEvents] = await Promise.all([
      getGames('team-1'),
      getPublicTeamCalendarEvents('team-1')
    ]);

    expect(projectedGames).toHaveLength(501);
    expect(projectedGames.at(-1)).toEqual(expect.objectContaining({ id: 'game-500', opponent: 'Rockets' }));
    expect(projectedEvents).toHaveLength(501);
    expect(projectedEvents.at(-1)).toEqual(expect.objectContaining({ id: 'event-500', summary: 'Practice' }));
    expect(firebaseMocks.getPublicTeamGamesProjection.mock.calls[1][0]).toEqual(expect.objectContaining({ cursor: 'games-page-2' }));
    expect(firebaseMocks.getPublicTeamCalendarProjection.mock.calls[1][0]).toEqual(expect.objectContaining({ cursor: 'calendar-page-2' }));
  });

  it('falls back to a sanitized public game detail when canonical get is denied', async () => {
    firebaseMocks.getDoc.mockRejectedValue(Object.assign(new Error('denied'), {
      code: 'permission-denied'
    }));
    firebaseMocks.getPublicGameProjection.mockResolvedValue({
      data: {
        item: {
          id: 'game-2',
          startsAt: '2026-08-02T18:00:00.000Z',
          opponent: 'Rockets',
          location: 'Diamond 1',
          isHome: false,
          teamScore: 4,
          opponentScore: 5,
          status: 'completed'
        }
      }
    });

    await expect(getGame('team-1', 'game-2')).resolves.toEqual(expect.objectContaining({
      id: 'game-2',
      teamId: 'team-1',
      homeScore: 5,
      awayScore: 4,
      isPublicProjection: true
    }));
    expect(firebaseMocks.getPublicGameProjection).toHaveBeenCalledWith({
      teamId: 'team-1',
      gameId: 'game-2'
    });
  });

  it('polls the public projection without opening a forbidden canonical listener', async () => {
    const callback = vi.fn();
    const onError = vi.fn();
    firebaseMocks.getPublicGameProjection.mockResolvedValue({
      data: {
        item: {
          id: 'game-2',
          startsAt: '2026-08-02T18:00:00.000Z',
          opponent: 'Rockets',
          status: 'live'
        }
      }
    });

    const unsubscribe = subscribeGame(
      'team-1',
      'game-2',
      callback,
      onError,
      { publicProjection: true }
    );
    try {
      await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        id: 'game-2',
        teamId: 'team-1',
        isPublicProjection: true
      })));
      expect(firebaseMocks.onSnapshot).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('does not publish a late projection after the viewer unsubscribes', async () => {
    let resolveProjection;
    const projectionResponse = new Promise((resolve) => {
      resolveProjection = resolve;
    });
    const callback = vi.fn();
    firebaseMocks.getPublicGameProjection.mockReturnValue(projectionResponse);

    const unsubscribe = subscribeGame(
      'team-1',
      'game-2',
      callback,
      vi.fn(),
      { publicProjection: true }
    );
    unsubscribe();
    resolveProjection({
      data: {
        item: {
          id: 'game-2',
          startsAt: '2026-08-02T18:00:00.000Z',
          opponent: 'Rockets',
          status: 'live'
        }
      }
    });
    await projectionResponse;
    await Promise.resolve();

    expect(callback).not.toHaveBeenCalled();
    expect(firebaseMocks.onSnapshot).not.toHaveBeenCalled();
  });

  it('uses a bounded nine-year public fallback for legacy unbounded schedule reads', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T12:00:00.000Z'));
    try {
      firebaseMocks.getDocs.mockRejectedValue(Object.assign(new Error('denied'), {
        code: 'permission-denied'
      }));
      firebaseMocks.getPublicTeamGamesProjection.mockResolvedValue({
        data: { games: [] }
      });

      await expect(getGames('team-1')).resolves.toEqual([]);
      expect(firebaseMocks.getPublicTeamGamesProjection).toHaveBeenCalledWith({
        teamId: 'team-1',
        from: '2019-07-30',
        to: '2028-07-30',
        limit: 500
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains tournament group filtering when the public projection fallback is used', async () => {
    firebaseMocks.getDocs.mockRejectedValue(Object.assign(new Error('denied'), {
      code: 'permission-denied'
    }));
    firebaseMocks.getPublicTeamGamesProjection.mockResolvedValue({
      data: {
        games: [
          {
            id: 'pool-a',
            startsAt: '2026-08-02T18:00:00.000Z',
            opponent: 'Falcons',
            competitionType: 'tournament',
            tournament: { divisionName: '10U Gold', poolName: 'Pool A' }
          },
          {
            id: 'pool-b',
            startsAt: '2026-08-03T18:00:00.000Z',
            opponent: 'Rockets',
            competitionType: 'tournament',
            tournament: { divisionName: '10U Gold', poolName: 'Pool B' }
          }
        ]
      }
    });

    const result = await getGames('team-1', {
      tournamentGroup: { divisionName: '10U Gold', poolName: 'Pool A' }
    });

    expect(result.map((game) => game.id)).toEqual(['pool-a']);
  });

  it('loads only games explicitly assigned to the signed-in official', async () => {
    firebaseMocks.getDocs.mockImplementation(async (queryValue) => {
      const constraint = getWhereConstraint(queryValue);
      if (constraint.field === 'officiatingAuthorizedUserIds') {
        return {
          docs: [{
            id: 'uid-game',
            data: () => ({ opponent: 'Falcons', date: new Date('2026-08-03T18:00:00Z') })
          }]
        };
      }
      if (constraint.field === 'officiatingAuthorizedEmails') {
        return {
          docs: [{
            id: 'email-game',
            data: () => ({ opponent: 'Rockets', date: new Date('2026-08-04T18:00:00Z') })
          }]
        };
      }
      throw new Error(`Unexpected query: ${constraint.field}`);
    });

    const result = await getOfficiatingGames('team-1');

    expect(result.map((game) => game.id)).toEqual(['uid-game', 'email-game']);
    expect(firebaseMocks.where).toHaveBeenCalledWith(
      'officiatingAuthorizedUserIds',
      'array-contains',
      'official-1'
    );
    expect(firebaseMocks.where).toHaveBeenCalledWith(
      'officiatingAuthorizedEmails',
      'array-contains',
      'official@example.com'
    );
  });

  it.each([
    'officiatingAuthorizedUserIds',
    'officiatingAuthorizedEmails'
  ])('rejects the assignment load when the %s query fails', async (failedField) => {
    const queryError = new Error(`${failedField} query failed`);
    firebaseMocks.getDocs.mockImplementation(async (queryValue) => {
      const constraint = getWhereConstraint(queryValue);
      if (constraint.field === failedField) throw queryError;
      return {
        docs: [{
          id: 'partial-game',
          data: () => ({ opponent: 'Falcons', date: new Date('2026-08-03T18:00:00Z') })
        }]
      };
    });

    await expect(getOfficiatingGames('team-1')).rejects.toBe(queryError);
  });
});
