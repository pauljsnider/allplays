import { describe, expect, it } from 'vitest';
import { applyViewerEventToState } from '../../js/live-game-state.js';

function buildViewerState(overrides = {}) {
  return {
    events: [],
    eventIds: new Set(),
    stats: {},
    opponentStats: {},
    onCourt: [],
    bench: [],
    homeScore: 0,
    awayScore: 0,
    period: 'Q1',
    gameClockMs: 0,
    sport: 'Basketball',
    periods: null,
    lastStatChange: null,
    scoringRun: { team: null, points: 0 },
    lastRunAnnounced: 0,
    ...overrides
  };
}

describe('live game clock sync ingestion', () => {
  it('updates scoreboard fields without appending a fake play', () => {
    const current = buildViewerState({
      events: [{ id: 'play-1', type: 'stat', statKey: 'pts', value: 2, homeScore: 2, awayScore: 0 }],
      homeScore: 2,
      awayScore: 0,
      gameClockMs: 45_000
    });

    const result = applyViewerEventToState(current, {
      id: 'sync-1',
      type: 'clock_sync',
      homeScore: 8,
      awayScore: 5,
      period: 'Q2',
      gameClockMs: 123_000
    });

    expect(result.state.homeScore).toBe(8);
    expect(result.state.awayScore).toBe(5);
    expect(result.state.period).toBe('Q2');
    expect(result.state.gameClockMs).toBe(123_000);
    expect(result.state.events).toEqual(current.events);
    expect(result.state.events).toBe(current.events);
    expect(result.state.stats).toBe(current.stats);
    expect(result.state.opponentStats).toBe(current.opponentStats);
    expect(result.shouldRenderPlayByPlay).toBe(false);
  });

  it('keeps only real basketball events in the feed when clock sync heartbeats are interleaved', () => {
    const events = [
      {
        id: 'sync-open',
        type: 'clock_sync',
        homeScore: 0,
        awayScore: 0,
        period: 'Q1',
        gameClockMs: 600_000
      },
      {
        id: 'play-1',
        type: 'stat',
        playerId: 'p1',
        statKey: 'pts',
        value: 2,
        homeScore: 2,
        awayScore: 0,
        period: 'Q1',
        gameClockMs: 588_000
      },
      {
        id: 'sync-mid',
        type: 'clock_sync',
        homeScore: 2,
        awayScore: 0,
        period: 'Q1',
        gameClockMs: 580_000
      },
      {
        id: 'play-2',
        type: 'stat',
        playerId: 'o1',
        statKey: 'pts',
        value: 3,
        isOpponent: true,
        opponentPlayerName: 'Away Guard',
        opponentPlayerNumber: '4',
        homeScore: 2,
        awayScore: 3,
        period: 'Q1',
        gameClockMs: 560_000
      },
      {
        id: 'sync-late',
        type: 'clock_sync',
        homeScore: 4,
        awayScore: 3,
        period: 'Q2',
        gameClockMs: 300_000
      }
    ];

    let state = buildViewerState();
    const feedEvents = [];
    events.forEach((event) => {
      const result = applyViewerEventToState(state, event);
      state = result.state;
      if (result.shouldRenderPlayByPlay) {
        feedEvents.push(event.id);
      }
    });

    expect(feedEvents).toEqual(['play-1', 'play-2']);
    expect(state.events.map((event) => event.id)).toEqual(['play-1', 'play-2']);
    expect(state.homeScore).toBe(4);
    expect(state.awayScore).toBe(3);
    expect(state.period).toBe('Q2');
    expect(state.gameClockMs).toBe(300_000);
  });
});
