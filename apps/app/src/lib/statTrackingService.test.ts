import { describe, expect, it, vi } from 'vitest';
import { buildTrackerEventDocument, createStatTrackingService } from './statTrackingService';

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

  it('undoes the last event by deleting the event doc, reversing aggregates, and restoring score', async () => {
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
    expect(dependencies.deleteDoc).toHaveBeenCalledWith({ path: expect.stringContaining('teams/team-1/games/game-1/events/app-track-') });
    expect(dependencies.setDoc).toHaveBeenCalledWith({ path: 'teams/team-1/games/game-1/aggregatedStats/player-1' }, expect.objectContaining({
      stats: {
        pts: { __increment: -2 }
      }
    }), { merge: true });
    expect(dependencies.updateGameScore).toHaveBeenCalledWith('team-1', 'game-1', {
      homeScore: 10,
      awayScore: 8
    }, user);
    expect(service.getCurrentScore()).toEqual({ homeScore: 10, awayScore: 8 });
    expect(service.getEventLog()).toHaveLength(0);
    expect(await service.undoLastEvent('team-1', 'game-1', user)).toBeNull();
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
    expect(dependencies.setDoc).toHaveBeenNthCalledWith(2, { path: 'teams/team-1/games/game-1/aggregatedStats/player-1' }, expect.objectContaining({
      stats: {}
    }), { merge: true });
    expect(dependencies.setDoc).toHaveBeenNthCalledWith(3, { path: 'teams/team-1/games/game-1/privatePlayerStats/player-1' }, expect.objectContaining({
      stats: {
        notes: { __increment: 1 }
      }
    }), { merge: true });
  });
});
