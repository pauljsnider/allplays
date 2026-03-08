import { describe, it, expect } from 'vitest';
import { resolveOpponentDisplayName, normalizeLiveStatColumns, resolveLiveStatColumns, applyResetEventState, shouldResetViewerFromGameDoc, isLiveEventVisibleForResetBoundary } from '../../js/live-game-state.js';

describe('live game state helpers', () => {
  it('prefers linked opponent team name when opponent is missing', () => {
    expect(resolveOpponentDisplayName({ opponent: '', opponentTeamName: 'Riverside FC' })).toBe('Riverside FC');
    expect(resolveOpponentDisplayName({ opponent: 'Lions', opponentTeamName: 'Riverside FC' })).toBe('Lions');
  });

  it('does not force foul column into generic stat columns', () => {
    expect(normalizeLiveStatColumns(['PTS', 'REB', 'AST'])).toEqual(['PTS', 'REB', 'AST']);
  });

  it('resolves stat columns from matching sport config when game config id is missing', () => {
    expect(resolveLiveStatColumns({
      configs: [
        { id: 'cfg-basketball', baseType: 'Basketball', columns: ['PTS', 'REB', 'AST'] },
        { id: 'cfg-soccer', baseType: 'Soccer', columns: ['G', 'A', 'SOG', 'YC'] }
      ],
      team: { sport: 'Soccer' }
    })).toEqual(['G', 'A', 'SOG', 'YC']);
  });

  it('prefers direct game config id over sport matching', () => {
    expect(resolveLiveStatColumns({
      configs: [
        { id: 'cfg-basketball', baseType: 'Basketball', columns: ['PTS', 'REB', 'AST'] },
        { id: 'cfg-custom', baseType: 'Soccer', columns: ['SHOT', 'SAVE'] }
      ],
      game: { statTrackerConfigId: 'cfg-custom', sport: 'Soccer' },
      team: { sport: 'Soccer' }
    })).toEqual(['SHOT', 'SAVE']);
  });

  it('falls back to the only available config before basketball defaults', () => {
    expect(resolveLiveStatColumns({
      configs: [
        { id: 'cfg-only', baseType: 'Custom', columns: ['A', 'B', 'C', 'D'] }
      ],
      team: { sport: 'Unknown' }
    })).toEqual(['A', 'B', 'C', 'D']);
  });

  it('resets live viewer state from reset event payload', () => {
    const next = applyResetEventState({
      period: 'Q4',
      homeScore: 33,
      awayScore: 21,
      gameClockMs: 123000,
      events: [{ id: 'e1' }],
      eventIds: new Set(['e1']),
      stats: { p1: { pts: 2 } },
      opponentStats: { o1: { pts: 4 } },
      onCourt: ['p1'],
      bench: ['p2']
    }, {
      period: 'Q1',
      homeScore: 0,
      awayScore: 0,
      gameClockMs: 0,
      onCourt: [],
      bench: ['p1', 'p2']
    });

    expect(next.period).toBe('Q1');
    expect(next.homeScore).toBe(0);
    expect(next.awayScore).toBe(0);
    expect(next.gameClockMs).toBe(0);
    expect(next.events).toEqual([]);
    expect(Array.from(next.eventIds)).toEqual(['e1']);
    expect(next.stats).toEqual({});
    expect(next.opponentStats).toEqual({});
    expect(next.onCourt).toEqual([]);
    expect(next.bench).toEqual(['p1', 'p2']);
  });

  it('clones prior event ids during reset to avoid mutating source state', () => {
    const current = {
      eventIds: new Set(['e1'])
    };

    const next = applyResetEventState(current, { homeScore: 0, awayScore: 0 });
    next.eventIds.add('e2');

    expect(Array.from(current.eventIds)).toEqual(['e1']);
    expect(Array.from(next.eventIds)).toEqual(['e1', 'e2']);
  });

  it('detects scheduled reset from game doc when tracked state exists', () => {
    const shouldReset = shouldResetViewerFromGameDoc(
      { liveStatus: 'scheduled', liveHasData: false, homeScore: 0, awayScore: 0 },
      { events: [{ id: 'e1' }], stats: {}, opponentStats: {}, homeScore: 2, awayScore: 0 }
    );
    expect(shouldReset).toBe(true);
  });

  it('does not force reset from game doc when no tracked state exists', () => {
    const shouldReset = shouldResetViewerFromGameDoc(
      { liveStatus: 'scheduled', liveHasData: false, homeScore: 0, awayScore: 0 },
      { events: [], stats: {}, opponentStats: {}, homeScore: 0, awayScore: 0 }
    );
    expect(shouldReset).toBe(false);
  });

  it('filters non-reset events older than the live reset boundary', () => {
    const oldEvent = {
      type: 'stat',
      createdAt: { toMillis: () => 1000 }
    };
    const newEvent = {
      type: 'stat',
      createdAt: { toMillis: () => 3000 }
    };

    expect(isLiveEventVisibleForResetBoundary(oldEvent, 2000)).toBe(false);
    expect(isLiveEventVisibleForResetBoundary(newEvent, 2000)).toBe(true);
  });

  it('always keeps reset events and unknown timestamps', () => {
    expect(isLiveEventVisibleForResetBoundary({ type: 'reset', createdAt: { toMillis: () => 1000 } }, 2000)).toBe(true);
    expect(isLiveEventVisibleForResetBoundary({ type: 'stat' }, 2000)).toBe(true);
  });
});
