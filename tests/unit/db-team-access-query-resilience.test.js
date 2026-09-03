import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  auth: { currentUser: null },
  collection: vi.fn((_database, path) => ({ path })),
  doc: vi.fn((_database, path, id) => ({ path: `${path}/${id}` })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  listManagedTeams: vi.fn(),
  listPublicTeams: vi.fn(),
  getPublicTeamProfile: vi.fn(),
  getDelegatedTeamContext: vi.fn(),
  getPublicTeamGamesProjection: vi.fn(),
  getPublicTeamCalendarProjection: vi.fn(),
  getPublicGameProjection: vi.fn(),
  query: vi.fn((collectionRef, ...constraints) => ({ collectionRef, constraints })),
  where: vi.fn((field, op, value) => ({ field, op, value })),
  onSnapshot: vi.fn()
}));

vi.mock('../../js/firebase.js?v=34', () => ({
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
    if (name === 'listManagedTeams') return firebaseMocks.listManagedTeams;
    if (name === 'getPublicTeamProfile') return firebaseMocks.getPublicTeamProfile;
    if (name === 'getDelegatedTeamContext') return firebaseMocks.getDelegatedTeamContext;
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


vi.mock('../../js/firebase-images.js?v=18', () => ({
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
  getGameDayTeamContext,
  getTeams,
  getUserTeamsWithAccess
} = await import('../../js/db.js?v=4433196');

describe('team access query resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseMocks.auth.currentUser = {
      uid: 'owner-1',
      email: 'coach@example.com',
      getIdToken: vi.fn().mockResolvedValue('fake-id-token')
    };
    firebaseMocks.auth.app = { options: { projectId: 'game-flow-c6311' } };
    firebaseMocks.listPublicTeams.mockResolvedValue({
      data: { items: [], nextCursor: null }
    });
    firebaseMocks.listManagedTeams.mockResolvedValue({ data: { items: [], isPartial: false } });
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

  it('loads legacy and canonical managed teams through the server-filtered callable', async () => {
    firebaseMocks.listManagedTeams.mockResolvedValue({
      data: {
        items: [
          { id: 'email-1', name: 'Vipers', ownerEmail: 'coach@example.com' },
          { id: 'owned-1', name: 'Falcons', ownerId: 'owner-1' }
        ],
        isPartial: false
      }
    });

    await expect(getUserTeamsWithAccess('owner-1', 'coach@example.com')).resolves.toEqual([
      { id: 'owned-1', name: 'Falcons', ownerId: 'owner-1' },
      { id: 'email-1', name: 'Vipers', ownerEmail: 'coach@example.com' }
    ]);
    expect(firebaseMocks.listManagedTeams).toHaveBeenCalledWith({});
    expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
  });

  it('lets a slow managed-team discovery run to completion when no timeout is requested', async () => {
    let resolveCallable;
    firebaseMocks.listManagedTeams.mockReturnValue(new Promise((resolve) => {
      resolveCallable = resolve;
    }));

    const resultPromise = getUserTeamsWithAccess('owner-1', 'coach@example.com');
    resolveCallable({ data: { items: [{ id: 'owned-1', name: 'Falcons', ownerId: 'owner-1' }], isPartial: false } });

    await expect(resultPromise).resolves.toEqual([{ id: 'owned-1', name: 'Falcons', ownerId: 'owner-1' }]);
  });

  it('bounds managed-team discovery to an explicit timeoutMs instead of hanging indefinitely', async () => {
    vi.useFakeTimers();
    try {
      firebaseMocks.listManagedTeams.mockReturnValue(new Promise(() => {})); // never resolves
      const resultPromise = getUserTeamsWithAccess('owner-1', 'coach@example.com', { timeoutMs: 10000 });
      const assertion = expect(resultPromise).rejects.toThrow('Managed team discovery timed out.');
      await vi.advanceTimersByTimeAsync(10000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves from the authenticated REST hedge when the SDK callable is still cold at the 2s mark', async () => {
    vi.useFakeTimers();
    const originalFetch = globalThis.fetch;
    try {
      firebaseMocks.listManagedTeams.mockReturnValue(new Promise(() => {})); // never resolves in this test
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            items: [{ id: 'owned-1', name: 'Falcons', ownerId: 'owner-1' }],
            isPartial: false
          }
        })
      });

      const resultPromise = getUserTeamsWithAccess('owner-1', 'coach@example.com');
      await vi.advanceTimersByTimeAsync(2000);
      await expect(resultPromise).resolves.toEqual([{ id: 'owned-1', name: 'Falcons', ownerId: 'owner-1' }]);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://us-central1-game-flow-c6311.cloudfunctions.net/listManagedTeams',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer fake-id-token' })
        })
      );
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it('keeps racing when the REST hedge is partial and the SDK callable later returns a complete result', async () => {
    vi.useFakeTimers();
    const originalFetch = globalThis.fetch;
    try {
      let resolveCallable;
      firebaseMocks.listManagedTeams.mockReturnValue(new Promise((resolve) => {
        resolveCallable = resolve;
      }));
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            items: [{ id: 'partial-1', name: 'Incomplete team' }],
            isPartial: true
          }
        })
      });

      const resultPromise = getUserTeamsWithAccess('owner-1', 'coach@example.com');
      await vi.advanceTimersByTimeAsync(2000);
      resolveCallable({
        data: {
          items: [{ id: 'owned-1', name: 'Falcons', ownerId: 'owner-1' }],
          isPartial: false
        }
      });

      await expect(resultPromise).resolves.toEqual([
        { id: 'owned-1', name: 'Falcons', ownerId: 'owner-1' }
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it('never fires the REST hedge when the SDK callable answers before the delay elapses', async () => {
    vi.useFakeTimers();
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn();
      firebaseMocks.listManagedTeams.mockResolvedValue({
        data: { items: [{ id: 'owned-1', name: 'Falcons', ownerId: 'owner-1' }], isPartial: false }
      });

      const resultPromise = getUserTeamsWithAccess('owner-1', 'coach@example.com');
      await vi.advanceTimersByTimeAsync(0);
      await expect(resultPromise).resolves.toEqual([{ id: 'owned-1', name: 'Falcons', ownerId: 'owner-1' }]);

      await vi.advanceTimersByTimeAsync(5000);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it('rejects partial managed-team discovery instead of returning an authoritative incomplete array', async () => {
    firebaseMocks.listManagedTeams.mockResolvedValue({
      data: {
        items: [{ id: 'owned-1', name: 'Falcons', ownerId: 'owner-1' }],
        isPartial: true
      }
    });

    await expect(getUserTeamsWithAccess('owner-1', 'coach@example.com')).rejects.toMatchObject({
      code: 'managed-team-discovery-partial',
      partialTeams: [{ id: 'owned-1', name: 'Falcons', ownerId: 'owner-1' }]
    });
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

  it('loads delegated Game Day context without attempting a canonical team document read', async () => {
    firebaseMocks.getDelegatedTeamContext.mockResolvedValue({
      data: {
        item: {
          id: 'private-1',
          name: 'Falcons',
          active: true,
          delegatedAccess: { scorekeeping: true }
        }
      }
    });

    await expect(getGameDayTeamContext('private-1', 'game-1')).resolves.toEqual({
      id: 'private-1',
      name: 'Falcons',
      active: true,
      delegatedAccess: { scorekeeping: true }
    });
    expect(firebaseMocks.getDelegatedTeamContext).toHaveBeenCalledWith({
      teamId: 'private-1',
      gameId: 'game-1'
    });
    expect(firebaseMocks.getDoc).not.toHaveBeenCalled();
    expect(firebaseMocks.getPublicTeamProfile).not.toHaveBeenCalled();
  });

  it('propagates delegated projection failures without falling back to a canonical read', async () => {
    firebaseMocks.getDelegatedTeamContext.mockRejectedValue(Object.assign(new Error('offline'), {
      code: 'functions/unavailable'
    }));

    await expect(getGameDayTeamContext('private-1', 'game-1')).rejects.toMatchObject({
      code: 'functions/unavailable'
    });
    expect(firebaseMocks.getDoc).not.toHaveBeenCalled();
    expect(firebaseMocks.getPublicTeamProfile).not.toHaveBeenCalled();
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
          sourceStatus: 'completed',
          liveStatus: 'scheduled',
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
        status: 'completed',
        liveStatus: 'scheduled',
        isPublicProjection: true
      })
    ]);
    expect(result[0]).not.toHaveProperty('assignments');
    expect(result[0]).not.toHaveProperty('gamePlan');
    expect(result[0]).not.toHaveProperty('notes');
  });

  it('preserves ordered public lifecycle fields instead of reconstructing contradictions', async () => {
    firebaseMocks.getDocs.mockRejectedValue(Object.assign(new Error('denied'), {
      code: 'firestore/permission-denied'
    }));
    firebaseMocks.getPublicTeamGamesProjection.mockResolvedValue({
      data: {
        games: [
          { id: 'statsheet', startsAt: '2026-08-01T18:00:00.000Z', status: 'completed', sourceStatus: 'completed', liveStatus: 'scheduled' },
          { id: 'reverse', startsAt: '2026-08-01T19:00:00.000Z', status: 'completed', sourceStatus: 'scheduled', liveStatus: 'completed' },
          { id: 'active', startsAt: '2026-08-01T20:00:00.000Z', status: 'live', sourceStatus: 'scheduled', liveStatus: 'live' },
          { id: 'legacy', startsAt: '2026-08-01T21:00:00.000Z', status: 'completed' }
        ]
      }
    });

    const result = await getGames('team-1');
    expect(result.map(({ id, status, liveStatus }) => ({ id, status, liveStatus }))).toEqual([
      { id: 'statsheet', status: 'completed', liveStatus: 'scheduled' },
      { id: 'reverse', status: 'scheduled', liveStatus: 'completed' },
      { id: 'active', status: 'scheduled', liveStatus: 'live' },
      { id: 'legacy', status: 'completed', liveStatus: 'completed' }
    ]);
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
          status: 'completed',
          liveResetAt: '2026-08-02T18:15:00.000Z',
          liveResetEventId: 'reset-public-2',
          isPublicProjection: false
        }
      }
    });

    await expect(getGame('team-1', 'game-2')).resolves.toEqual(expect.objectContaining({
      id: 'game-2',
      teamId: 'team-1',
      homeScore: 5,
      awayScore: 4,
      liveResetAt: new Date('2026-08-02T18:15:00.000Z'),
      liveResetEventId: 'reset-public-2',
      isPublicProjection: true
    }));
    expect(firebaseMocks.getPublicGameProjection).toHaveBeenCalledWith({
      teamId: 'team-1',
      gameId: 'game-2'
    });
  });

  it('does not trust a stored public-projection marker on a canonical game read', async () => {
    firebaseMocks.getDoc.mockResolvedValue({
      id: 'game-2',
      exists: () => true,
      data: () => ({
        opponent: 'Rockets',
        videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
        broadcastSession: {
          status: 'ready_for_managed_stream',
          provider: {
            type: 'youtube',
            name: 'YouTube',
            channel: 'team-channel',
            embedUrl: 'https://www.youtube.com/embed/PK1HyC37doc',
            videoId: 'PK1HyC37doc'
          }
        },
        youtubeVideoId: 'PK1HyC37doc',
        streamEmbedUrl: 'https://www.youtube.com/embed/PK1HyC37doc',
        youtubeEmbedUrl: 'https://youtu.be/PK1HyC37doc',
        isPublicProjection: true
      })
    });

    const game = await getGame('team-1', 'game-2');
    expect(game).toEqual(expect.objectContaining({
      id: 'game-2',
      opponent: 'Rockets',
      broadcastSession: {
        status: 'ready_for_managed_stream',
        provider: {
          type: 'youtube',
          name: 'YouTube',
          channel: 'team-channel'
        }
      },
      isPublicProjection: false
    }));
    expect(game).not.toHaveProperty('videoUrl');
    expect(game).not.toHaveProperty('youtubeVideoId');
    expect(game).not.toHaveProperty('streamEmbedUrl');
    expect(game).not.toHaveProperty('youtubeEmbedUrl');
    expect(firebaseMocks.getPublicGameProjection).not.toHaveBeenCalled();
  });

  it('preserves an unmarked canonical team live transport while scrubbing automated aliases', async () => {
    firebaseMocks.getDoc.mockResolvedValue({
      id: 'game-2',
      exists: () => true,
      data: () => ({
        type: 'game',
        status: 'scheduled',
        liveStatus: 'live',
        videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
        youtubeVideoId: 'PK1HyC37doc',
        streamEmbedUrl: 'https://www.youtube.com/embed/PK1HyC37doc'
      })
    });

    const game = await getGame('team-1', 'game-2');
    expect(game.videoUrl).toBe('https://www.youtube.com/watch?v=PK1HyC37doc');
    expect(game).not.toHaveProperty('youtubeVideoId');
    expect(game).not.toHaveProperty('streamEmbedUrl');
  });

  it('strips stale replay capabilities from completed canonical game reads and keeps only safe markers', async () => {
    firebaseMocks.getDoc.mockResolvedValue({
      id: 'game-2',
      exists: () => true,
      data: () => ({
        type: 'game',
        status: 'completed',
        liveStatus: 'scheduled',
        replayVideo: {
          provider: 'youtube',
          videoId: 'PK1HyC37doc',
          publicUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc'
        },
        recordedVideoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
        videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
        highlightClips: [
          { id: 'protected-copy', publicUrl: 'https://youtu.be/PK1HyC37doc', startMs: 1_000 },
          { id: 'standalone', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }
        ],
        hasRecordedReplay: true,
        replayArchiveRevision: 'r:opaque-1',
        isPublicProjection: true
      })
    });

    const game = await getGame('team-1', 'game-2');
    expect(game).toMatchObject({
      id: 'game-2',
      status: 'completed',
      liveStatus: 'scheduled',
      hasRecordedReplay: true,
      replayArchiveRevision: 'r:opaque-1',
      isPublicProjection: false
    });
    expect(game).not.toHaveProperty('replayVideo');
    expect(game).not.toHaveProperty('recordedVideoUrl');
    expect(game).not.toHaveProperty('videoUrl');
    expect(game.highlightClips).toEqual([
      { id: 'protected-copy', startMs: 1_000 },
      { id: 'standalone', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }
    ]);
  });

  it('derives only a capability-free marker for a valid unmigrated YouTube replay', async () => {
    firebaseMocks.getDoc.mockResolvedValue({
      id: 'game-2',
      exists: () => true,
      data: () => ({
        type: 'game',
        status: 'completed',
        replayVideoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc'
      })
    });

    const game = await getGame('team-1', 'game-2');
    expect(game).toMatchObject({
      id: 'game-2',
      hasRecordedReplay: true,
      replayArchiveRevision: 'legacy:unmigrated'
    });
    expect(game).not.toHaveProperty('replayVideoUrl');
    expect(JSON.stringify(game)).not.toContain('PK1HyC37doc');
  });

  it.each([
    ['blocked status', { replayStatus: 'processing', replayVideoUrl: 'https://youtu.be/PK1HyC37doc' }],
    ['generic replay URL', { archivedVideoUrl: 'https://cdn.example.test/replay.mp4' }],
    ['conflicting identities', {
      replayVideoUrl: 'https://youtu.be/PK1HyC37doc',
      recordedVideoUrl: 'https://youtu.be/dQw4w9WgXcQ'
    }],
    ['overlong YouTube URL', {
      replayVideoUrl: `https://youtu.be/PK1HyC37doc?padding=${'x'.repeat(2048)}`
    }],
    ['explicit marker-free state', {
      hasRecordedReplay: false,
      replayVideoUrl: 'https://youtu.be/PK1HyC37doc'
    }]
  ])('does not derive an unmigrated marker for %s', async (_label, replayState) => {
    firebaseMocks.getDoc.mockResolvedValue({
      id: 'game-2',
      exists: () => true,
      data: () => ({
        type: 'game',
        status: 'completed',
        ...replayState
      })
    });

    const game = await getGame('team-1', 'game-2');
    expect(game).toMatchObject({
      id: 'game-2',
      hasRecordedReplay: false,
      replayArchiveRevision: null
    });
    expect(JSON.stringify(game)).not.toContain('PK1HyC37doc');
    expect(JSON.stringify(game)).not.toContain('cdn.example.test');
  });

  it.each(['complete', 'finished'])(
    'treats the exact historical %s status as completed for readable videoUrl scrubbing',
    async (status) => {
      firebaseMocks.getDoc.mockResolvedValue({
        id: 'game-2',
        exists: () => true,
        data: () => ({
          type: 'game',
          status,
          liveStatus: 'scheduled',
          videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc'
        })
      });

      const game = await getGame('team-1', 'game-2');
      expect(game).toMatchObject({ id: 'game-2', status, liveStatus: 'scheduled' });
      expect(game).not.toHaveProperty('videoUrl');
    }
  );

  it.each([
    ['videoUrl', (url) => ({ videoUrl: url }), 'https://youtu.be/PK1HyC37doc'],
    ['url', (url) => ({ url }), 'https://youtu.be/PK1HyC37doc'],
    ['publicUrl', (url) => ({ publicUrl: url }), 'https://youtu.be/PK1HyC37doc'],
    ['sourceUrl', (url) => ({ sourceUrl: url }), 'https://youtu.be/PK1HyC37doc'],
    ['downloadUrl', (url) => ({ downloadUrl: url }), 'https://youtu.be/PK1HyC37doc'],
    ['href', (url) => ({ href: url }), 'https://youtu.be/PK1HyC37doc'],
    ['embedUrl', (url) => ({ embedUrl: url }), 'https://youtu.be/PK1HyC37doc'],
    ['src', (url) => ({ src: url }), 'https://youtu.be/PK1HyC37doc'],
    ['mediaUrl', (url) => ({ mediaUrl: url }), 'https://youtu.be/PK1HyC37doc'],
    ['videoId', (videoId) => ({ videoId }), ' PK1HyC37doc '],
    ['video.url', (url) => ({ video: { url, posterUrl: 'https://cdn.example/poster.jpg' } }), 'https://youtu.be/PK1HyC37doc'],
    ['video.publicUrl', (url) => ({ video: { publicUrl: url, posterUrl: 'https://cdn.example/poster.jpg' } }), 'https://youtu.be/PK1HyC37doc'],
    ['video.sourceUrl', (url) => ({ video: { sourceUrl: url, posterUrl: 'https://cdn.example/poster.jpg' } }), 'https://youtu.be/PK1HyC37doc'],
    ['video.videoId', (videoId) => ({ video: { videoId, posterUrl: 'https://cdn.example/poster.jpg' } }), ' PK1HyC37doc ']
  ])('strips a protected replay copy from the live clip reader field %s', async (_field, makeClipPatch, protectedValue) => {
    firebaseMocks.getDoc.mockResolvedValue({
      id: 'game-2',
      exists: () => true,
      data: () => ({
        type: 'game',
        status: 'completed',
        liveStatus: 'scheduled',
        replayVideoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
        gameClips: [{
          id: 'protected-copy',
          title: 'Keep metadata',
          ...makeClipPatch(protectedValue)
        }]
      })
    });

    const game = await getGame('team-1', 'game-2');
    expect(game.gameClips).toEqual([{
      id: 'protected-copy',
      title: 'Keep metadata',
      ...(_field.startsWith('video.')
        ? { video: { posterUrl: 'https://cdn.example/poster.jpg' } }
        : {})
    }]);
  });

  it('matches canonical URL variants when stripping a generic protected replay copy', async () => {
    firebaseMocks.getDoc.mockResolvedValue({
      id: 'game-2',
      exists: () => true,
      data: () => ({
        type: 'game',
        status: 'completed',
        liveStatus: 'scheduled',
        archivedVideoUrl: 'https://private.example',
        gameClips: [{ id: 'protected-copy', downloadUrl: 'https://private.example/#watch' }]
      })
    });

    const game = await getGame('team-1', 'game-2');
    expect(game).not.toHaveProperty('archivedVideoUrl');
    expect(game.gameClips).toEqual([{ id: 'protected-copy' }]);
  });

  it('recursively strips protected replay copies from nested clip maps and arrays', async () => {
    firebaseMocks.getDoc.mockResolvedValue({
      id: 'game-2',
      exists: () => true,
      data: () => ({
        type: 'game',
        status: 'completed',
        liveStatus: 'scheduled',
        replayVideoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
        gameClips: [{
          id: 'protected-copy',
          asset: {
            sources: [
              { url: 'https://youtu.be/PK1HyC37doc', label: 'protected' },
              { url: 'https://cdn.example/clip.mp4', label: 'standalone' }
            ]
          }
        }]
      })
    });

    const game = await getGame('team-1', 'game-2');
    expect(game.gameClips).toEqual([{
      id: 'protected-copy',
      asset: {
        sources: [
          { label: 'protected' },
          { url: 'https://cdn.example/clip.mp4', label: 'standalone' }
        ]
      }
    }]);
  });

  it('withholds a protected clip collection when bounded recursive sanitization cannot complete', async () => {
    let nested = 'https://youtu.be/PK1HyC37doc';
    for (let index = 0; index < 21; index += 1) nested = { child: nested };
    firebaseMocks.getDoc.mockResolvedValue({
      id: 'game-2',
      exists: () => true,
      data: () => ({
        type: 'game',
        status: 'completed',
        liveStatus: 'scheduled',
        replayVideoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
        gameClips: [nested]
      })
    });

    const game = await getGame('team-1', 'game-2');
    expect(game.gameClips).toEqual([]);
  });

  it('withholds completed projection URLs while preserving an active-live projection URL', async () => {
    firebaseMocks.getDoc.mockRejectedValue(Object.assign(new Error('denied'), {
      code: 'permission-denied'
    }));
    firebaseMocks.getPublicGameProjection
      .mockResolvedValueOnce({
        data: {
          item: {
            id: 'completed-game',
            status: 'completed',
            sourceStatus: 'completed',
            liveStatus: 'scheduled',
            videoLifecycle: 'completed',
            videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
            hasRecordedReplay: true,
            replayArchiveRevision: 'r:opaque-1'
          }
        }
      })
      .mockResolvedValueOnce({
        data: {
          item: {
            id: 'live-game',
            status: 'live',
            sourceStatus: 'scheduled',
            liveStatus: 'live',
            videoLifecycle: 'live',
            videoUrl: 'https://www.youtube.com/embed/live_stream?channel=UC123'
          }
        }
      });

    const completed = await getGame('team-1', 'completed-game');
    const live = await getGame('team-1', 'live-game');
    expect(completed).toMatchObject({
      hasRecordedReplay: true,
      hasReplayVideo: true,
      replayArchiveRevision: 'r:opaque-1',
      videoUrl: null,
      isPublicProjection: true
    });
    expect(live.videoUrl).toBe('https://www.youtube.com/embed/live_stream?channel=UC123');
  });

  it('does not trust a stored public-projection marker in the shared-game fallback', async () => {
    const gameId = `shared_${encodeURIComponent('leagues/league-1/sharedGames/shared-1')}`;
    firebaseMocks.getDoc.mockResolvedValue({
      id: 'shared-1',
      exists: () => true,
      data: () => ({
        homeTeamId: 'team-other-home',
        awayTeamId: 'team-other-away',
        sourceNote: 'preserved fallback field',
        status: 'scheduled',
        liveStatus: 'live',
        videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
        youtubeVideoId: 'PK1HyC37doc',
        streamEmbedUrl: 'https://www.youtube.com/embed/PK1HyC37doc',
        youtubeEmbedUrl: 'https://youtu.be/PK1HyC37doc',
        broadcastSession: {
          status: 'ready',
          provider: {
            type: 'external_provider',
            videoId: 'PK1HyC37doc',
            embedUrl: 'https://www.youtube.com/embed/PK1HyC37doc'
          }
        },
        isPublicProjection: true
      })
    });

    await expect(getGame('team-1', gameId)).resolves.toEqual(expect.objectContaining({
      id: gameId,
      sharedGameId: 'shared-1',
      isSharedGame: true,
      sourceNote: 'preserved fallback field',
      videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
      youtubeVideoId: 'PK1HyC37doc',
      streamEmbedUrl: 'https://www.youtube.com/embed/PK1HyC37doc',
      youtubeEmbedUrl: 'https://youtu.be/PK1HyC37doc',
      broadcastSession: {
        status: 'ready',
        provider: {
          type: 'external_provider',
          videoId: 'PK1HyC37doc',
          embedUrl: 'https://www.youtube.com/embed/PK1HyC37doc'
        }
      },
      isPublicProjection: false
    }));
  });

  it('does not trust a stored public-projection marker on canonical subscription updates', () => {
    const callback = vi.fn();
    const onError = vi.fn();
    const detach = vi.fn();
    firebaseMocks.onSnapshot.mockImplementationOnce((_ref, onNext) => {
      onNext({
        id: 'game-2',
        exists: () => true,
        data: () => ({
          opponent: 'Rockets',
          status: 'scheduled',
          liveStatus: 'live',
          videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
          youtubeVideoId: 'PK1HyC37doc',
          streamEmbedUrl: 'https://www.youtube.com/embed/PK1HyC37doc',
          isPublicProjection: true
        })
      });
      return detach;
    });

    const unsubscribe = subscribeGame('team-1', 'game-2', callback, onError);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      id: 'game-2',
      opponent: 'Rockets',
      liveStatus: 'live',
      isPublicProjection: false
    }));
    const [canonicalUpdate] = callback.mock.calls[0];
    expect(canonicalUpdate).not.toHaveProperty('videoUrl');
    expect(canonicalUpdate).not.toHaveProperty('youtubeVideoId');
    expect(canonicalUpdate).not.toHaveProperty('streamEmbedUrl');
    expect(onError).not.toHaveBeenCalled();

    unsubscribe();
    expect(detach).toHaveBeenCalledOnce();
  });

  it('does not trust a stored public-projection marker on shared-game subscription updates', () => {
    const gameId = `shared_${encodeURIComponent('leagues/league-1/sharedGames/shared-1')}`;
    const callback = vi.fn();
    const detach = vi.fn();
    firebaseMocks.onSnapshot.mockImplementationOnce((_ref, onNext) => {
      onNext({
        id: 'shared-1',
        exists: () => true,
        data: () => ({
          homeTeamId: 'team-1',
          awayTeamId: 'team-2',
          awayTeamName: 'Falcons',
          sourceNote: 'preserved projection field',
          status: 'scheduled',
          liveStatus: 'live',
          videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
          youtubeVideoId: 'PK1HyC37doc',
          streamEmbedUrl: 'https://www.youtube.com/embed/PK1HyC37doc',
          isPublicProjection: true
        })
      });
      return detach;
    });

    const unsubscribe = subscribeGame('team-1', gameId, callback, vi.fn());
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      sharedGameId: 'shared-1',
      opponent: 'Falcons',
      sourceNote: 'preserved projection field',
      videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
      youtubeVideoId: 'PK1HyC37doc',
      streamEmbedUrl: 'https://www.youtube.com/embed/PK1HyC37doc',
      isPublicProjection: false
    }));

    unsubscribe();
    expect(detach).toHaveBeenCalledOnce();
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

  it('ignores an older public projection that resolves after a newer poll', async () => {
    vi.useFakeTimers();
    let resolveFirstProjection;
    let resolveSecondProjection;
    const firstProjection = new Promise((resolve) => {
      resolveFirstProjection = resolve;
    });
    const secondProjection = new Promise((resolve) => {
      resolveSecondProjection = resolve;
    });
    const callback = vi.fn();
    const onError = vi.fn();
    firebaseMocks.getPublicGameProjection
      .mockReturnValueOnce(firstProjection)
      .mockReturnValueOnce(secondProjection);

    const unsubscribe = subscribeGame(
      'team-1',
      'game-2',
      callback,
      onError,
      { publicProjection: true }
    );
    try {
      expect(firebaseMocks.getPublicGameProjection).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(firebaseMocks.getPublicGameProjection).toHaveBeenCalledTimes(2);

      resolveSecondProjection({
        data: {
          item: {
            id: 'game-2',
            startsAt: '2026-08-02T18:00:00.000Z',
            opponent: 'Rockets',
            status: 'live',
            liveResetEventId: 'reset-newer'
          }
        }
      });
      await secondProjection;
      await vi.advanceTimersByTimeAsync(0);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({
        liveResetEventId: 'reset-newer'
      }));

      resolveFirstProjection({
        data: {
          item: {
            id: 'game-2',
            startsAt: '2026-08-02T18:00:00.000Z',
            opponent: 'Rockets',
            status: 'live',
            liveResetEventId: 'reset-older'
          }
        }
      });
      await firstProjection;
      await vi.advanceTimersByTimeAsync(0);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({
        liveResetEventId: 'reset-newer'
      }));
      expect(onError).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
      vi.useRealTimers();
    }
  });

  it('ignores an older public projection error after a newer poll succeeds', async () => {
    vi.useFakeTimers();
    let rejectFirstProjection;
    let resolveSecondProjection;
    const firstProjection = new Promise((_resolve, reject) => {
      rejectFirstProjection = reject;
    });
    const secondProjection = new Promise((resolve) => {
      resolveSecondProjection = resolve;
    });
    const callback = vi.fn();
    const onError = vi.fn();
    firebaseMocks.getPublicGameProjection
      .mockReturnValueOnce(firstProjection)
      .mockReturnValueOnce(secondProjection);

    const unsubscribe = subscribeGame(
      'team-1',
      'game-2',
      callback,
      onError,
      { publicProjection: true }
    );
    try {
      await vi.advanceTimersByTimeAsync(15_000);
      expect(firebaseMocks.getPublicGameProjection).toHaveBeenCalledTimes(2);

      resolveSecondProjection({
        data: {
          item: {
            id: 'game-2',
            startsAt: '2026-08-02T18:00:00.000Z',
            opponent: 'Rockets',
            status: 'live',
            liveResetEventId: 'reset-newer'
          }
        }
      });
      await secondProjection;
      await vi.advanceTimersByTimeAsync(0);
      expect(callback).toHaveBeenCalledTimes(1);

      rejectFirstProjection(Object.assign(new Error('stale projection failed'), {
        code: 'unavailable'
      }));
      await expect(firstProjection).rejects.toThrow('stale projection failed');
      await vi.advanceTimersByTimeAsync(0);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
      vi.useRealTimers();
    }
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
