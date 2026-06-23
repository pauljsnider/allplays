import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildTrackerEventDocument } from './statTrackingEvent';
import { createStatTrackingService } from './statTrackingService';

function createDependencies() {
  return {
    db: { name: 'db' } as any,
    doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
    setDoc: vi.fn(async () => undefined),
    deleteDoc: vi.fn(async () => undefined),
    increment: vi.fn((value: number) => ({ __increment: value })),
    updateGameScore: vi.fn(async () => undefined)
  };
}

describe('statTrackingService', () => {
  it('keeps stat tracking helpers behind typed adapters and the extracted tracker event builder', () => {
    const statTrackingServiceSource = readFileSync('src/lib/statTrackingService.ts', 'utf8');

    expect(statTrackingServiceSource).not.toContain("../../../../js/");
    expect(statTrackingServiceSource).toContain("./adapters/legacyStatTrackingDb");
    expect(statTrackingServiceSource).toContain("./statTrackingEvent");
  });

  it('builds legacy-compatible tracker event documents', () => {
    const event = buildTrackerEventDocument({
      text: '#4 Alex PTS +2',
      clock: '01:20',
      period: 'Q1',
      timestamp: 1718150400000,
      undoData: {
        type: 'stat',
        playerId: 'player-1',
        statKey: 'PTS',
        value: 2,
        isOpponent: false
      }
    }, {
      uid: 'coach-1'
    });

    expect(event).toEqual({
      text: '#4 Alex PTS +2',
      gameTime: '01:20',
      period: 'Q1',
      timestamp: 1718150400000,
      type: 'stat',
      playerId: 'player-1',
      statKey: 'pts',
      value: 2,
      isOpponent: false,
      createdBy: 'coach-1'
    });
  });

  it('adds opponent player metadata to opponent tracker event documents', () => {
    const event = buildTrackerEventDocument({
      text: 'Opponent #9 Taylor GOALS +1',
      period: 'H1',
      timestamp: 1718150400000,
      playerName: 'Taylor Guard',
      playerNumber: '9',
      opponentPlayerPhoto: 'https://img.example/opp-9.png',
      undoData: {
        type: 'stat',
        playerId: 'opp-9',
        statKey: 'GOALS',
        value: 1,
        isOpponent: true
      }
    }, {
      uid: 'coach-1'
    });

    expect(event).toEqual({
      text: 'Opponent #9 Taylor GOALS +1',
      gameTime: '',
      period: 'H1',
      timestamp: 1718150400000,
      type: 'stat',
      playerId: 'opp-9',
      statKey: 'goals',
      value: 1,
      isOpponent: true,
      opponentPlayerName: 'Taylor Guard',
      opponentPlayerNumber: '9',
      opponentPlayerPhoto: 'https://img.example/opp-9.png',
      createdBy: 'coach-1'
    });
  });

  it('records stat events, updates aggregates, and keeps score in sync', async () => {
    const dependencies = createDependencies();
    const service = createStatTrackingService({
      statConfig: { columns: ['PTS', 'AST'] },
      initialScore: { homeScore: 10, awayScore: 8 },
      dependencies
    });

    const result = await service.recordEvent('team-1', 'game-1', {
      text: '#4 Alex PTS +2',
      clock: '01:20',
      period: 'Q1',
      timestamp: 1001,
      playerName: 'Alex',
      playerNumber: '4',
      teamSide: 'home',
      undoData: {
        type: 'stat',
        playerId: 'player-1',
        statKey: 'PTS',
        value: 2,
        isOpponent: false
      }
    }, {
      uid: 'coach-1',
      email: 'coach@example.com'
    });

    expect(result.eventId).toMatch(/^app-track-/);
    expect(dependencies.setDoc).toHaveBeenNthCalledWith(1, { path: expect.stringContaining('teams/team-1/games/game-1/events/app-track-') }, {
      text: '#4 Alex PTS +2',
      gameTime: '01:20',
      period: 'Q1',
      timestamp: 1001,
      type: 'stat',
      playerId: 'player-1',
      statKey: 'pts',
      value: 2,
      isOpponent: false,
      createdBy: 'coach-1'
    });
    expect(dependencies.setDoc).toHaveBeenNthCalledWith(2, { path: 'teams/team-1/games/game-1/aggregatedStats/player-1' }, {
      playerName: 'Alex',
      playerNumber: '4',
      participated: true,
      participationStatus: 'appeared',
      participationSource: 'app-stat-tracker',
      didNotPlay: false,
      stats: {
        pts: { __increment: 2 }
      }
    }, { merge: true });
    expect(dependencies.updateGameScore).toHaveBeenCalledWith('team-1', 'game-1', {
      homeScore: 12,
      awayScore: 8
    }, {
      uid: 'coach-1',
      email: 'coach@example.com'
    });
    expect(service.getCurrentScore()).toEqual({ homeScore: 12, awayScore: 8 });
    expect(service.getEventLog()).toHaveLength(1);
  });

  it('accepts legacy custom stat column keys with punctuation', async () => {
    const dependencies = createDependencies();
    const service = createStatTrackingService({
      statConfig: { columns: ['3-Pt', 'FG%'] },
      initialScore: { homeScore: 0, awayScore: 0 },
      dependencies
    });

    const result = await service.recordEvent('team-1', 'game-1', {
      text: '#4 Alex 3-Pt +1',
      playerName: 'Alex',
      playerNumber: '4',
      undoData: {
        type: 'stat',
        playerId: 'player-1',
        statKey: '3-Pt',
        value: 1,
        isOpponent: false
      }
    }, {
      uid: 'coach-1'
    });

    expect(result.aggregateStatKey).toBe('3-pt');
    expect(dependencies.setDoc).toHaveBeenCalledWith({ path: 'teams/team-1/games/game-1/aggregatedStats/player-1' }, expect.objectContaining({
      stats: {
        '3pt': { __increment: 1 }
      }
    }), { merge: true });
  });

  it('undoes the last event by reversing aggregates before deleting the event doc and restoring score', async () => {
    const dependencies = createDependencies();
    const service = createStatTrackingService({
      statConfig: { columns: ['PTS', 'AST'] },
      initialScore: { homeScore: 10, awayScore: 8 },
      dependencies
    });
    const user = { uid: 'coach-1', email: 'coach@example.com' };

    await service.recordEvent('team-1', 'game-1', {
      text: '#4 Alex PTS +2',
      clock: '01:20',
      period: 'Q1',
      playerName: 'Alex',
      playerNumber: '4',
      teamSide: 'home',
      undoData: {
        type: 'stat',
        playerId: 'player-1',
        statKey: 'PTS',
        value: 2,
        isOpponent: false
      }
    }, user);

    dependencies.setDoc.mockClear();
    dependencies.updateGameScore.mockClear();

    const undone = await service.undoLastEvent('team-1', 'game-1', user);

    expect(undone?.event.playerId).toBe('player-1');
    expect(dependencies.setDoc).toHaveBeenCalledWith({ path: 'teams/team-1/games/game-1/aggregatedStats/player-1' }, expect.objectContaining({
      stats: {
        pts: { __increment: -2 }
      }
    }), { merge: true });
    expect(dependencies.updateGameScore).toHaveBeenCalledWith('team-1', 'game-1', {
      homeScore: 10,
      awayScore: 8
    }, user);
    expect(dependencies.deleteDoc).toHaveBeenCalledWith({ path: expect.stringContaining('teams/team-1/games/game-1/events/app-track-') });
    expect(dependencies.setDoc.mock.invocationCallOrder[0]).toBeLessThan(dependencies.deleteDoc.mock.invocationCallOrder[0]);
    expect(dependencies.updateGameScore.mock.invocationCallOrder[0]).toBeLessThan(dependencies.deleteDoc.mock.invocationCallOrder[0]);
    expect(service.getCurrentScore()).toEqual({ homeScore: 10, awayScore: 8 });
    expect(service.getEventLog()).toHaveLength(0);
    expect(await service.undoLastEvent('team-1', 'game-1', user)).toBeNull();
  });

  it('steps backward through standard tracker scoring events one undo at a time', async () => {
    const dependencies = createDependencies();
    const service = createStatTrackingService({
      statConfig: { columns: ['PTS'] },
      initialScore: { homeScore: 0, awayScore: 0 },
      dependencies
    });
    const user = { uid: 'coach-1' };

    await service.recordEvent('team-1', 'game-1', {
      text: '#4 Alex PTS +2',
      playerName: 'Alex',
      playerNumber: '4',
      undoData: {
        type: 'stat',
        playerId: 'player-1',
        statKey: 'PTS',
        value: 2
      }
    }, user);
    await service.recordEvent('team-1', 'game-1', {
      text: '#12 Sam PTS +3',
      playerName: 'Sam',
      playerNumber: '12',
      undoData: {
        type: 'stat',
        playerId: 'player-2',
        statKey: 'PTS',
        value: 3
      }
    }, user);

    expect(service.getCurrentScore()).toEqual({ homeScore: 5, awayScore: 0 });
    expect(service.getEventLog().map((entry) => entry.playerName)).toEqual(['Alex', 'Sam']);

    const firstUndo = await service.undoLastEvent('team-1', 'game-1', user);
    expect(firstUndo?.playerName).toBe('Sam');
    expect(service.getCurrentScore()).toEqual({ homeScore: 2, awayScore: 0 });
    expect(service.getEventLog().map((entry) => entry.playerName)).toEqual(['Alex']);

    const secondUndo = await service.undoLastEvent('team-1', 'game-1', user);
    expect(secondUndo?.playerName).toBe('Alex');
    expect(service.getCurrentScore()).toEqual({ homeScore: 0, awayScore: 0 });
    expect(service.getEventLog()).toEqual([]);
  });

  it('hydrates a restored tracker log so undo can revert the last app session event', async () => {
    const dependencies = createDependencies();
    const user = { uid: 'coach-1' };
    const service = createStatTrackingService({
      statConfig: { columns: ['GOALS'] },
      initialScore: { homeScore: 2, awayScore: 0 },
      initialEventLog: [{
        eventId: 'restored-event-1',
        event: {
          text: '#4 Alex GOALS +1',
          gameTime: '',
          period: 'H1',
          timestamp: 2001,
          type: 'stat',
          playerId: 'player-1',
          statKey: 'goals',
          value: 1,
          isOpponent: false,
          createdBy: 'coach-1'
        },
        scoreBefore: { homeScore: 1, awayScore: 0 },
        scoreAfter: { homeScore: 2, awayScore: 0 },
        aggregateStatKey: 'GOALS',
        aggregateDelta: 1,
        aggregatePlayerId: 'player-1',
        isOpponent: false,
        opponentStatsEntryId: null,
        opponentStatsEntryBefore: null,
        opponentStatsEntryAfter: null,
        playerName: 'Alex',
        playerNumber: '4'
      }],
      dependencies
    });

    expect(service.getCurrentScore()).toEqual({ homeScore: 2, awayScore: 0 });
    expect(service.getEventLog()).toHaveLength(1);

    const undone = await service.undoLastEvent('team-1', 'game-1', user);

    expect(undone?.eventId).toBe('restored-event-1');
    expect(dependencies.setDoc).toHaveBeenCalledWith({ path: 'teams/team-1/games/game-1/aggregatedStats/player-1' }, expect.objectContaining({
      stats: {
        goals: { __increment: -1 }
      }
    }), { merge: true });
    expect(dependencies.updateGameScore).toHaveBeenCalledWith('team-1', 'game-1', {
      homeScore: 1,
      awayScore: 0
    }, user);
    expect(dependencies.deleteDoc).toHaveBeenCalledWith({ path: 'teams/team-1/games/game-1/events/restored-event-1' });
    expect(service.getCurrentScore()).toEqual({ homeScore: 1, awayScore: 0 });
    expect(service.getEventLog()).toEqual([]);
  });

  it('rejects unknown stat columns before writing', async () => {
    const dependencies = createDependencies();
    const service = createStatTrackingService({
      statConfig: { columns: ['PTS', 'AST'] },
      dependencies
    });

    await expect(service.recordEvent('team-1', 'game-1', {
      text: '#4 Alex BLK +1',
      clock: '01:20',
      period: 'Q1',
      playerName: 'Alex',
      playerNumber: '4',
      undoData: {
        type: 'stat',
        playerId: 'player-1',
        statKey: 'BLK',
        value: 1,
        isOpponent: false
      }
    }, {
      uid: 'coach-1'
    })).rejects.toThrow('Unknown stat column key: blk');

    expect(dependencies.setDoc).not.toHaveBeenCalled();
    expect(dependencies.updateGameScore).not.toHaveBeenCalled();
  });

  it('routes private stat definitions to privatePlayerStats while preserving participation', async () => {
    const dependencies = createDependencies();
    const service = createStatTrackingService({
      statConfig: {
        columns: ['PTS'],
        statDefinitions: [
          { id: 'notes', scope: 'player', visibility: 'private' }
        ]
      },
      dependencies
    });

    await service.recordEvent('team-1', 'game-1', {
      text: '#4 Alex NOTES +1',
      clock: '01:20',
      period: 'Q1',
      playerName: 'Alex',
      playerNumber: '4',
      undoData: {
        type: 'stat',
        playerId: 'player-1',
        statKey: 'notes',
        value: 1,
        isOpponent: false
      }
    }, {
      uid: 'coach-1'
    });

    expect(dependencies.setDoc).toHaveBeenNthCalledWith(1, { path: expect.stringContaining('/events/app-track-') }, expect.any(Object));
    expect(dependencies.setDoc).toHaveBeenNthCalledWith(2, { path: 'teams/team-1/games/game-1/aggregatedStats/player-1' }, {
      playerName: 'Alex',
      playerNumber: '4',
      participated: true,
      participationStatus: 'appeared',
      participationSource: 'app-stat-tracker',
      didNotPlay: false
    }, { merge: true });
    expect(dependencies.setDoc).toHaveBeenNthCalledWith(3, { path: 'teams/team-1/games/game-1/privatePlayerStats/player-1' }, expect.objectContaining({
      stats: {
        notes: { __increment: 1 }
      }
    }), { merge: true });
  });

  it('cleans up the event document when aggregate writes fail during record', async () => {
    const dependencies = createDependencies();
    dependencies.setDoc
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('aggregate failed'));
    const service = createStatTrackingService({
      statConfig: { columns: ['PTS'] },
      dependencies
    });

    await expect(service.recordEvent('team-1', 'game-1', {
      text: '#4 Alex PTS +2',
      clock: '01:20',
      period: 'Q1',
      playerName: 'Alex',
      playerNumber: '4',
      undoData: {
        type: 'stat',
        playerId: 'player-1',
        statKey: 'PTS',
        value: 2,
        isOpponent: false
      }
    }, {
      uid: 'coach-1'
    })).rejects.toThrow('aggregate failed');

    expect(dependencies.deleteDoc).toHaveBeenCalledWith({ path: expect.stringContaining('teams/team-1/games/game-1/events/app-track-') });
    expect(dependencies.updateGameScore).not.toHaveBeenCalled();
    expect(service.getEventLog()).toHaveLength(0);
  });

  it('restores aggregate and score state if undo fails to delete the event document', async () => {
    const dependencies = createDependencies();
    const service = createStatTrackingService({
      statConfig: { columns: ['PTS'] },
      initialScore: { homeScore: 10, awayScore: 8 },
      dependencies
    });
    const user = { uid: 'coach-1' };

    await service.recordEvent('team-1', 'game-1', {
      text: '#4 Alex PTS +2',
      clock: '01:20',
      period: 'Q1',
      playerName: 'Alex',
      playerNumber: '4',
      undoData: {
        type: 'stat',
        playerId: 'player-1',
        statKey: 'PTS',
        value: 2,
        isOpponent: false
      }
    }, user);

    dependencies.setDoc.mockClear();
    dependencies.updateGameScore.mockClear();
    dependencies.deleteDoc.mockRejectedValueOnce(new Error('delete failed'));

    await expect(service.undoLastEvent('team-1', 'game-1', user)).rejects.toThrow('delete failed');

    expect(dependencies.setDoc).toHaveBeenNthCalledWith(1, { path: 'teams/team-1/games/game-1/aggregatedStats/player-1' }, expect.objectContaining({
      stats: {
        pts: { __increment: -2 }
      }
    }), { merge: true });
    expect(dependencies.setDoc).toHaveBeenNthCalledWith(2, { path: 'teams/team-1/games/game-1/aggregatedStats/player-1' }, expect.objectContaining({
      stats: {
        pts: { __increment: 2 }
      }
    }), { merge: true });
    expect(dependencies.updateGameScore).toHaveBeenNthCalledWith(1, 'team-1', 'game-1', {
      homeScore: 10,
      awayScore: 8
    }, user);
    expect(dependencies.updateGameScore).toHaveBeenNthCalledWith(2, 'team-1', 'game-1', {
      homeScore: 12,
      awayScore: 8
    }, user);
    expect(service.getCurrentScore()).toEqual({ homeScore: 12, awayScore: 8 });
    expect(service.getEventLog()).toHaveLength(1);
  });

  it('records linked opponent stat entries and updates the requested opponent score side', async () => {
    const dependencies = createDependencies();
    const service = createStatTrackingService({
      statConfig: { columns: ['PTS', 'AST'] },
      initialScore: { homeScore: 10, awayScore: 8 },
      dependencies
    });

    const result = await service.recordEvent('team-1', 'game-1', {
      text: 'Opponent #9 Taylor PTS +3',
      clock: '01:20',
      period: 'Q1',
      playerName: 'Taylor Guard',
      playerNumber: '9',
      opponentPlayerPhoto: 'https://img.example/opp-9.png',
      opponentStatsEntryId: 'opp-9',
      opponentStatsEntryBefore: {
        name: 'Taylor Guard',
        number: '9',
        playerId: 'opp-9',
        photoUrl: 'https://img.example/opp-9.png',
        pts: 0,
        ast: 0,
        fouls: 0
      },
      opponentStatsEntryAfter: {
        name: 'Taylor Guard',
        number: '9',
        playerId: 'opp-9',
        photoUrl: 'https://img.example/opp-9.png',
        pts: 3,
        ast: 0,
        fouls: 0
      },
      teamSide: 'away',
      undoData: {
        type: 'stat',
        playerId: 'opp-9',
        statKey: 'PTS',
        value: 3,
        isOpponent: true
      }
    }, {
      uid: 'coach-1'
    });

    expect(result.opponentStatsEntryId).toBe('opp-9');
    expect(result.opponentStatsEntryAfter).toEqual({
      name: 'Taylor Guard',
      number: '9',
      playerId: 'opp-9',
      photoUrl: 'https://img.example/opp-9.png',
      pts: 3,
      ast: 0,
      fouls: 0
    });
    expect(dependencies.setDoc).toHaveBeenNthCalledWith(1, { path: expect.stringContaining('teams/team-1/games/game-1/events/app-track-') }, expect.objectContaining({
      isOpponent: true,
      opponentPlayerName: 'Taylor Guard',
      opponentPlayerNumber: '9',
      opponentPlayerPhoto: 'https://img.example/opp-9.png'
    }));
    expect(dependencies.setDoc).toHaveBeenNthCalledWith(2, { path: 'teams/team-1/games/game-1' }, {
      opponentStats: {
        'opp-9': {
          name: 'Taylor Guard',
          number: '9',
          playerId: 'opp-9',
          photoUrl: 'https://img.example/opp-9.png',
          pts: 3,
          ast: 0,
          fouls: 0
        }
      }
    }, { merge: true });
    expect(dependencies.updateGameScore).toHaveBeenCalledWith('team-1', 'game-1', {
      homeScore: 10,
      awayScore: 11
    }, {
      uid: 'coach-1'
    });
    expect(service.getCurrentScore()).toEqual({ homeScore: 10, awayScore: 11 });
  });

  it('records unlinked opponent stat entries with anonymous player metadata', async () => {
    const dependencies = createDependencies();
    const service = createStatTrackingService({
      statConfig: { columns: ['GOALS'] },
      initialScore: { homeScore: 0, awayScore: 0 },
      dependencies
    });

    await service.recordEvent('team-1', 'game-1', {
      text: 'Opponent Wolves GOALS +1',
      playerName: 'Wolves',
      opponentStatsEntryId: 'opponent',
      teamSide: 'home',
      undoData: {
        type: 'stat',
        playerId: 'opponent',
        statKey: 'GOALS',
        value: 1,
        isOpponent: true
      }
    }, {
      uid: 'coach-1'
    });

    expect(dependencies.setDoc).toHaveBeenNthCalledWith(2, { path: 'teams/team-1/games/game-1' }, {
      opponentStats: {
        opponent: {
          name: 'Wolves',
          number: '',
          playerId: null,
          photoUrl: '',
          goals: 1,
          fouls: 0
        }
      }
    }, { merge: true });
    expect(dependencies.updateGameScore).toHaveBeenCalledWith('team-1', 'game-1', {
      homeScore: 1,
      awayScore: 0
    }, {
      uid: 'coach-1'
    });
  });

  it('undoes opponent scoring by restoring opponentStats without writing player aggregates', async () => {
    const dependencies = createDependencies();
    const service = createStatTrackingService({
      statConfig: { columns: ['PTS'] },
      initialScore: { homeScore: 10, awayScore: 8 },
      dependencies
    });
    const user = { uid: 'coach-1' };

    await service.recordEvent('team-1', 'game-1', {
      text: 'Opponent PTS +2',
      clock: '00:45',
      period: 'Q2',
      playerName: 'Opponent',
      opponentStatsEntryId: 'opponent',
      opponentStatsEntryBefore: {
        name: 'Opponent',
        number: '',
        playerId: null,
        photoUrl: '',
        pts: 0,
        fouls: 0
      },
      opponentStatsEntryAfter: {
        name: 'Opponent',
        number: '',
        playerId: null,
        photoUrl: '',
        pts: 2,
        fouls: 0
      },
      teamSide: 'away',
      undoData: {
        type: 'stat',
        playerId: 'opponent',
        statKey: 'PTS',
        value: 2,
        isOpponent: true
      }
    }, user);

    expect(dependencies.setDoc).toHaveBeenCalledTimes(2);
    expect(dependencies.setDoc).not.toHaveBeenCalledWith(expect.objectContaining({
      path: expect.stringContaining('/aggregatedStats/')
    }), expect.anything(), expect.anything());
    expect(service.getCurrentScore()).toEqual({ homeScore: 10, awayScore: 10 });

    dependencies.setDoc.mockClear();
    dependencies.updateGameScore.mockClear();
    const undone = await service.undoLastEvent('team-1', 'game-1', user);

    expect(undone?.isOpponent).toBe(true);
    expect(dependencies.setDoc).toHaveBeenCalledWith({ path: 'teams/team-1/games/game-1' }, {
      opponentStats: {
        opponent: {
          name: 'Opponent',
          number: '',
          playerId: null,
          photoUrl: '',
          pts: 0,
          fouls: 0
        }
      }
    }, { merge: true });
    expect(dependencies.updateGameScore).toHaveBeenCalledWith('team-1', 'game-1', {
      homeScore: 10,
      awayScore: 8
    }, user);
    expect(service.getCurrentScore()).toEqual({ homeScore: 10, awayScore: 8 });
  });

  it('reconciles interleaved own and opponent scoring through sequential undos', async () => {
    const dependencies = createDependencies();
    const service = createStatTrackingService({
      statConfig: { columns: ['PTS'] },
      initialScore: { homeScore: 0, awayScore: 0 },
      dependencies
    });
    const user = { uid: 'coach-1' };

    await service.recordEvent('team-1', 'game-1', {
      text: '#4 Alex PTS +2',
      playerName: 'Alex',
      playerNumber: '4',
      teamSide: 'home',
      undoData: {
        type: 'stat',
        playerId: 'player-1',
        statKey: 'PTS',
        value: 2,
        isOpponent: false
      }
    }, user);
    await service.recordEvent('team-1', 'game-1', {
      text: 'Opponent PTS +3',
      playerName: 'Opponent',
      opponentStatsEntryId: 'opponent',
      opponentStatsEntryBefore: {
        name: 'Opponent',
        number: '',
        playerId: null,
        photoUrl: '',
        pts: 0,
        fouls: 0
      },
      opponentStatsEntryAfter: {
        name: 'Opponent',
        number: '',
        playerId: null,
        photoUrl: '',
        pts: 3,
        fouls: 0
      },
      teamSide: 'away',
      undoData: {
        type: 'stat',
        playerId: 'opponent',
        statKey: 'PTS',
        value: 3,
        isOpponent: true
      }
    }, user);
    await service.recordEvent('team-1', 'game-1', {
      text: '#4 Alex PTS +1',
      playerName: 'Alex',
      playerNumber: '4',
      teamSide: 'home',
      undoData: {
        type: 'stat',
        playerId: 'player-1',
        statKey: 'PTS',
        value: 1,
        isOpponent: false
      }
    }, user);

    expect(service.getCurrentScore()).toEqual({ homeScore: 3, awayScore: 3 });

    await service.undoLastEvent('team-1', 'game-1', user);
    expect(service.getCurrentScore()).toEqual({ homeScore: 2, awayScore: 3 });

    await service.undoLastEvent('team-1', 'game-1', user);
    expect(service.getCurrentScore()).toEqual({ homeScore: 2, awayScore: 0 });

    await service.undoLastEvent('team-1', 'game-1', user);
    expect(service.getCurrentScore()).toEqual({ homeScore: 0, awayScore: 0 });
  });
});
