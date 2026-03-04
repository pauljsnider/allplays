import { describe, it, expect } from 'vitest';
import { createFieldState, setPlayerFieldStatus, getPlayerFieldElapsedMs, getLiveLineup } from '../../js/live-tracker-field-status.js';

describe('live tracker field status helpers', () => {
  it('tracks elapsed time only while player is on field', () => {
    const state = createFieldState([{ id: 'p1' }]);

    setPlayerFieldStatus(state, 'p1', 'onField', 1000);
    expect(getPlayerFieldElapsedMs(state, 'p1', 5000)).toBe(4000);

    setPlayerFieldStatus(state, 'p1', 'bench', 5000);
    expect(getPlayerFieldElapsedMs(state, 'p1', 8000)).toBe(4000);
  });

  it('returns lineup arrays compatible with liveLineup shape', () => {
    const state = createFieldState([{ id: 'p1' }, { id: 'p2' }]);
    setPlayerFieldStatus(state, 'p1', 'onField', 0);
    const lineup = getLiveLineup(state, [{ id: 'p1' }, { id: 'p2' }]);
    expect(lineup.onCourt).toEqual(['p1']);
    expect(lineup.bench).toEqual(['p2']);
  });
});
