import { describe, it, expect } from 'vitest';
import { buildLiveResetEvent } from '../../js/live-tracker-reset.js';

describe('live tracker reset event helper', () => {
  it('builds a canonical reset payload that clears scores and stats', () => {
    const event = buildLiveResetEvent({
      period: 'Q3',
      gameClockMs: 84500,
      homeScore: 22,
      awayScore: 19,
      onCourt: ['p1'],
      bench: ['p2', 'p3'],
      createdBy: 'coach-1',
      description: 'Manual reset'
    });

    expect(event).toEqual({
      type: 'reset',
      description: 'Manual reset',
      period: 'Q3',
      gameClockMs: 84500,
      homeScore: 22,
      awayScore: 19,
      onCourt: ['p1'],
      bench: ['p2', 'p3'],
      stats: {},
      opponentStats: {},
      createdBy: 'coach-1'
    });
  });

  it('falls back to empty lineup arrays when invalid values are provided', () => {
    const event = buildLiveResetEvent({
      onCourt: null,
      bench: undefined
    });

    expect(event.onCourt).toEqual([]);
    expect(event.bench).toEqual([]);
  });
});
