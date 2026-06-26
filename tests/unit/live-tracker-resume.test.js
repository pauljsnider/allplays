import { describe, it, expect } from 'vitest';
import { buildPersistedResumeClockState, buildResumeLogFromLiveEvents, deriveResumeClockState } from '../../js/live-tracker-resume.js';

describe('live tracker resume clock state', () => {
  it('restores period and clock from latest persisted live event by createdAt', () => {
    const result = deriveResumeClockState([
      { period: 'Q3', gameClockMs: 120000, createdAt: { toMillis: () => 1000 } },
      { period: 'Q2', gameClockMs: 45000, createdAt: { toMillis: () => 900 } },
      { period: 'Q3', gameClockMs: 150000, createdAt: { toMillis: () => 1100 } }
    ]);

    expect(result.restored).toBe(true);
    expect(result.period).toBe('Q3');
    expect(result.clock).toBe(150000);
  });

  it('falls back to defaults when no valid period/clock exists', () => {
    const result = deriveResumeClockState([
      { type: 'chat', message: 'hello' },
      { period: null, gameClockMs: undefined }
    ]);

    expect(result.restored).toBe(false);
    expect(result.period).toBe('Q1');
    expect(result.clock).toBe(0);
  });

  it('falls back to persisted game clock state when live events do not include a usable clock', () => {
    const result = deriveResumeClockState(
      [
        { type: 'stat', playerId: 'p1', statKey: 'pts', value: 2 },
        { type: 'chat', message: 'timeout' }
      ],
      { period: 'Q1', clock: 0 },
      { liveClockPeriod: 'Q3', liveClockMs: 187000 }
    );

    expect(result.restored).toBe(true);
    expect(result.period).toBe('Q3');
    expect(result.clock).toBe(187000);
  });

  it('falls back to legacy persisted game clock fields when liveClock fields are absent', () => {
    const result = deriveResumeClockState(
      [
        { type: 'stat', playerId: 'p1', statKey: 'pts', value: 2 },
        { type: 'chat', message: 'timeout' }
      ],
      { period: 'Q1', clock: 0 },
      { period: 'Q3', gameClockMs: 187000 }
    );

    expect(result.restored).toBe(true);
    expect(result.period).toBe('Q3');
    expect(result.clock).toBe(187000);
  });

  it('passes legacy persisted clock fields through the production game-doc mapping', () => {
    const result = deriveResumeClockState(
      [
        { type: 'stat', playerId: 'p1', statKey: 'pts', value: 2 },
        { type: 'chat', message: 'timeout' }
      ],
      { period: 'Q1', clock: 0 },
      buildPersistedResumeClockState({ period: 'Q3', gameClockMs: 187000 })
    );

    expect(result.restored).toBe(true);
    expect(result.period).toBe('Q3');
    expect(result.clock).toBe(187000);
  });

  it('restores a running persisted game clock with elapsed wall-clock time', () => {
    const result = deriveResumeClockState(
      [
        { period: 'Q2', gameClockMs: 61000, createdAt: { toMillis: () => 1000 } }
      ],
      { period: 'Q1', clock: 0 },
      buildPersistedResumeClockState({
        liveClockPeriod: 'Q2',
        liveClockMs: 65000,
        liveClockRunning: true,
        liveClockUpdatedAt: { toMillis: () => 10000 }
      }),
      { now: () => 25000 }
    );

    expect(result.restored).toBe(true);
    expect(result.running).toBe(true);
    expect(result.period).toBe('Q2');
    expect(result.clock).toBe(80000);
    expect(result.elapsedWhileRunningMs).toBe(15000);
  });

  it('does not add elapsed wall-clock time for a paused persisted game clock', () => {
    const result = deriveResumeClockState(
      [],
      { period: 'Q1', clock: 0 },
      buildPersistedResumeClockState({
        liveClockPeriod: 'Q2',
        liveClockMs: 65000,
        liveClockRunning: false,
        liveClockUpdatedAt: { toMillis: () => 10000 }
      }),
      { now: () => 25000 }
    );

    expect(result.restored).toBe(true);
    expect(result.running).toBe(false);
    expect(result.period).toBe('Q2');
    expect(result.clock).toBe(65000);
    expect(result.elapsedWhileRunningMs).toBe(0);
  });

  it('restores using period/clock progression when timestamps are unavailable', () => {
    const result = deriveResumeClockState([
      { period: 'Q1', gameClockMs: 30000 },
      { period: 'Q2', gameClockMs: 10000 },
      { period: 'Q1', gameClockMs: 45000 }
    ]);

    expect(result.restored).toBe(true);
    expect(result.period).toBe('Q2');
    expect(result.clock).toBe(10000);
  });

  it('prefers untimestamped progress over stale timestamped state in mixed datasets', () => {
    const result = deriveResumeClockState([
      { period: 'Q2', gameClockMs: 20000, createdAt: { toMillis: () => 1000 } },
      { period: 'Q2', gameClockMs: 25000, createdAt: { toMillis: () => 1100 } },
      { period: 'Q3', gameClockMs: 5000, createdAt: null }
    ]);

    expect(result.restored).toBe(true);
    expect(result.period).toBe('Q3');
    expect(result.clock).toBe(5000);
  });

  it('prefers newer untimestamped events that follow the latest timestamped event', () => {
    const result = deriveResumeClockState([
      { period: 'Q2', gameClockMs: 20000, createdAt: { toMillis: () => 1000 } },
      { period: 'Q2', gameClockMs: 25000, createdAt: { toMillis: () => 1100 } },
      { period: 'Q2', gameClockMs: 24000, createdAt: null }
    ]);

    expect(result.restored).toBe(true);
    expect(result.period).toBe('Q2');
    expect(result.clock).toBe(24000);
  });

  it('uses latest event order for mixed timestamp datasets', () => {
    const result = deriveResumeClockState([
      { period: 'Q3', gameClockMs: 150000, createdAt: { toMillis: () => 2000 } },
      { period: 'Q3', gameClockMs: 160000, createdAt: null },
      { period: 'Q4', gameClockMs: 10000, createdAt: null }
    ]);

    expect(result.restored).toBe(true);
    expect(result.period).toBe('Q4');
    expect(result.clock).toBe(10000);
  });
});

describe('live tracker resume game log', () => {
  it('reconstructs persisted live stat events into final-report log entries', () => {
    const result = buildResumeLogFromLiveEvents([
      {
        type: 'stat',
        description: '#4 Alex PTS +2',
        period: 'Q1',
        gameClockMs: 80000,
        createdAt: { toMillis: () => 1000 },
        playerId: 'p1',
        statKey: 'PTS',
        value: 2,
        isOpponent: false,
        streamRelativeTimestampMs: 45000,
        videoTimestampCaptureActive: true
      },
      {
        type: 'stat',
        description: 'Opponent #12 PTS +3',
        period: 'Q1',
        gameClockMs: 20000,
        createdAt: { toMillis: () => 2000 },
        playerId: 'opp-12',
        statKey: 'PTS',
        value: 3,
        isOpponent: true
      }
    ]);

    expect(result).toEqual([
      {
        text: 'Opponent #12 PTS +3',
        ts: 2000,
        period: 'Q1',
        clock: '00:20',
        undoData: {
          type: 'stat',
          playerId: 'opp-12',
          statKey: 'PTS',
          value: 3,
          isOpponent: true
        }
      },
      {
        text: '#4 Alex PTS +2',
        ts: 1000,
        period: 'Q1',
        clock: '01:20',
        undoData: {
          type: 'stat',
          playerId: 'p1',
          statKey: 'PTS',
          value: 2,
          isOpponent: false,
          videoTimestampCaptureActive: true,
          streamRelativeTimestampMs: 45000,
          videoTimestampUnavailableReason: undefined
        }
      }
    ]);
  });

  it('keeps notes but skips non-log live broadcast noise', () => {
    const result = buildResumeLogFromLiveEvents([
      { type: 'chat', description: 'Go team', createdAt: { toMillis: () => 1000 } },
      { type: 'note', description: 'Note: Great defensive possession', period: 'Q2', gameClockMs: 61000, createdAt: { toMillis: () => 2000 } },
      { type: 'score_reset', description: 'Tracker reset', createdAt: { toMillis: () => 3000 } }
    ]);

    expect(result).toEqual([
      {
        text: 'Note: Great defensive possession',
        ts: 2000,
        period: 'Q2',
        clock: '01:01'
      }
    ]);
  });

  it('drops resumed stat log entries that were later reversed by undo or remove broadcasts', () => {
    const result = buildResumeLogFromLiveEvents([
      {
        type: 'stat',
        description: '#4 Alex PTS +2',
        period: 'Q1',
        gameClockMs: 80000,
        createdAt: { toMillis: () => 1000 },
        playerId: 'p1',
        statKey: 'PTS',
        value: 2,
        isOpponent: false
      },
      {
        type: 'stat',
        description: 'Opp Rival Guard FOULS +1',
        period: 'Q1',
        gameClockMs: 2000,
        createdAt: { toMillis: () => 1500 },
        playerId: 'opp1',
        statKey: 'fouls',
        value: 1,
        isOpponent: true
      },
      {
        type: 'stat',
        description: 'UNDO #4 Alex PTS +2',
        period: 'Q1',
        gameClockMs: 78000,
        createdAt: { toMillis: () => 2000 },
        playerId: 'p1',
        statKey: 'PTS',
        value: -2,
        isOpponent: false
      },
      {
        type: 'stat',
        description: 'REMOVE Opp Rival Guard FOULS +1',
        period: 'Q1',
        gameClockMs: 1000,
        createdAt: { toMillis: () => 3000 },
        playerId: 'opp1',
        statKey: 'fouls',
        value: -1,
        isOpponent: true
      }
    ]);

    expect(result).toEqual([]);
  });
});
