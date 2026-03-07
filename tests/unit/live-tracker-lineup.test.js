import { describe, it, expect } from 'vitest';
import { restoreLiveLineup } from '../../js/live-tracker-lineup.js';

describe('live tracker lineup restore', () => {
  it('restores persisted liveLineup for resume flows', () => {
    const roster = [
      { id: 'p1' },
      { id: 'p2' },
      { id: 'p3' },
      { id: 'p4' },
      { id: 'p5' },
      { id: 'p6' },
      { id: 'p7' }
    ];

    expect(restoreLiveLineup({
      liveLineup: {
        onCourt: ['p3', 'p1', 'p5', 'p2', 'p4'],
        bench: ['p6', 'p7']
      },
      roster
    })).toEqual({
      onCourt: ['p1', 'p2', 'p3', 'p4', 'p5'],
      bench: ['p6', 'p7']
    });
  });

  it('filters invalid ids, de-duplicates players, and backfills remaining roster to bench', () => {
    const roster = [
      { id: 'p1' },
      { id: 'p2' },
      { id: 'p3' },
      { id: 'p4' }
    ];

    expect(restoreLiveLineup({
      liveLineup: {
        onCourt: ['p2', 'ghost', 'p2'],
        bench: ['p4', 'p3', 'ghost', 'p4']
      },
      roster
    })).toEqual({
      onCourt: ['p2'],
      bench: ['p1', 'p3', 'p4']
    });
  });

  it('falls back to empty on-court and full roster bench when persisted lineup is missing', () => {
    const roster = [
      { id: 'p1' },
      { id: 'p2' }
    ];

    expect(restoreLiveLineup({
      liveLineup: null,
      roster
    })).toEqual({
      onCourt: [],
      bench: ['p1', 'p2']
    });
  });
});
