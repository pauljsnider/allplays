import { describe, it, expect } from 'vitest';
import { resolveOpponentDisplayName, normalizeLiveStatColumns, resolveLiveStatConfig, resolvePreferredStatConfigId, resolveLiveStatColumns, resolveGoalSportTrackerProfile, renderOpponentStatsCards, applyResetEventState, applyViewerEventToState, shouldResetViewerFromGameDoc, isLiveEventVisibleForResetBoundary, collectVisibleLiveEventsSequentially } from '../../js/live-game-state.js';

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

  it('uses goal columns for supported goal sports without a custom config', () => {
    expect(resolveLiveStatColumns({
      configs: [],
      team: { sport: 'Soccer' }
    })).toEqual(['GOALS']);
  });

  it('uses goal columns for assigned definitions-only goal sport configs', () => {
    expect(resolveLiveStatColumns({
      configs: [
        {
          id: 'cfg-manager-only',
          baseType: 'Soccer',
          columns: [],
          statDefinitions: [
            { id: 'deflections', scope: 'team', visibility: 'private', type: 'base' }
          ]
        }
      ],
      game: { statTrackerConfigId: 'cfg-manager-only', sport: 'Soccer' },
      team: { sport: 'Soccer' }
    })).toEqual(['GOALS']);
  });

  it('keeps basketball stat fallback for unsupported sports without a custom config', () => {
    expect(resolveLiveStatColumns({
      configs: [],
      team: { sport: 'Volleyball' }
    })).toEqual(['PTS', 'REB', 'AST', 'STL', 'TO']);
  });

  it('returns the matched config object for sport fallback', () => {
    expect(resolveLiveStatConfig({
      configs: [
        { id: 'cfg-basketball', baseType: 'Basketball', columns: ['PTS'] },
        { id: 'cfg-soccer', baseType: 'Soccer', columns: ['GOALS'] }
      ],
      team: { sport: 'Soccer' }
    })?.id).toBe('cfg-soccer');
  });

  it('returns an explicitly assigned config even when it has definitions but no public columns', () => {
    const assignedConfig = {
      id: 'cfg-manager-only',
      baseType: 'Basketball',
      columns: [],
      statDefinitions: [
        { id: 'deflections', scope: 'team', visibility: 'private', type: 'base' }
      ]
    };

    expect(resolveLiveStatConfig({
      configs: [
        { id: 'cfg-public', baseType: 'Basketball', columns: ['PTS'] },
        assignedConfig
      ],
      game: { statTrackerConfigId: 'cfg-manager-only', sport: 'Basketball' },
      team: { sport: 'Basketball' }
    })).toBe(assignedConfig);
  });

  it('returns the preferred config id for schedule defaults', () => {
    expect(resolvePreferredStatConfigId({
      configs: [
        { id: 'cfg-only', baseType: 'Soccer', columns: ['GOALS'] }
      ],
      team: { sport: 'Soccer' }
    })).toBe('cfg-only');
  });

  it('keeps full live tracker mode out of goal-only scoring even without a stat config id', () => {
    expect(resolveGoalSportTrackerProfile({
      game: { sport: 'Soccer' },
      team: { sport: 'Soccer' },
      config: { id: 'cfg-soccer', baseType: 'Soccer', columns: ['GOALS', 'SHOTS'] }
    })).toBeNull();

    expect(resolveGoalSportTrackerProfile({
      game: { sport: 'Soccer' },
      team: { sport: 'Soccer' },
      config: { id: 'cfg-basketball', baseType: 'Basketball', columns: ['PTS', 'REB'] }
    })).toBeNull();

    expect(resolveGoalSportTrackerProfile({
      game: {},
      team: { sport: 'Basketball' },
      config: { id: 'cfg-soccer', baseType: 'Soccer', columns: ['GOALS', 'SHOTS'] }
    })).toBeNull();

    expect(resolveGoalSportTrackerProfile({
      game: { sport: 'Soccer', statTrackerConfigId: 'cfg-soccer' },
      team: { sport: 'Soccer' },
      config: { baseType: 'Soccer', columns: ['GOALS', 'SHOTS'] }
    })).toBeNull();

    expect(resolveGoalSportTrackerProfile({
      game: { sport: 'Soccer' },
      team: { sport: 'Soccer' },
      config: { name: 'Default', baseType: 'Soccer', columns: ['GOALS'] }
    })).toBeNull();
  });

  it('lets trackerMode=simple force goal-sport scoring without affecting non-goal sports', () => {
    expect(resolveGoalSportTrackerProfile({
      trackerMode: 'simple',
      game: { sport: 'Soccer' },
      team: { sport: 'Soccer' },
      config: { id: 'cfg-soccer', baseType: 'Soccer', columns: ['GOALS', 'SHOTS'] }
    })).toMatchObject({ sport: 'soccer', statColumns: ['GOALS'] });

    expect(resolveGoalSportTrackerProfile({
      trackerMode: ' SIMPLE ',
      game: { sport: 'Hockey' },
      team: { sport: 'Hockey' },
      config: { id: 'cfg-hockey', baseType: 'Hockey', columns: ['GOALS', 'SAVES'] }
    })).toMatchObject({ sport: 'hockey' });

    expect(resolveGoalSportTrackerProfile({
      trackerMode: 'simple',
      game: { sport: 'Basketball' },
      team: { sport: 'Basketball' },
      config: { id: 'cfg-basketball', baseType: 'Basketball', columns: ['PTS'] }
    })).toBeNull();

    expect(resolveGoalSportTrackerProfile({
      trackerMode: 'simple',
      game: {},
      team: { sport: 'Soccer' },
      config: { id: 'cfg-baseball', baseType: 'Baseball', columns: ['RUNS'] }
    })).toBeNull();
  });

  it('renders persisted opponent identity and injects FLS when config omits fouls', () => {
    const html = renderOpponentStatsCards({
      opponentStats: {
        opp1: {
          name: 'Jordan Lee',
          number: '21',
          photoUrl: 'https://img.test/opp1.png',
          pts: 12,
          ast: 3,
          fouls: 4
        }
      },
      statColumns: ['PTS', 'AST']
    });

    expect(html).toContain('Jordan Lee');
    expect(html).toContain('#21');
    expect(html).toContain('https://img.test/opp1.png');
    expect(html).toContain('12 PTS');
    expect(html).toContain('3 AST');
    expect(html).toContain('4 FLS');
  });

  it('maps foul aliases to persisted opponent fouls without zeroing the value', () => {
    const foulsHtml = renderOpponentStatsCards({
      opponentStats: {
        opp1: {
          name: 'Jordan Lee',
          fouls: 5
        }
      },
      statColumns: ['PTS', 'FOULS']
    });

    const flsHtml = renderOpponentStatsCards({
      opponentStats: {
        opp1: {
          name: 'Jordan Lee',
          fouls: 5
        }
      },
      statColumns: ['PTS', 'FLS']
    });

    expect(foulsHtml).toContain('5 FOULS');
    expect(flsHtml).toContain('5 FLS');
    expect(flsHtml).not.toContain('0 FLS');
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

  it('uses a sport-specific reset period when no explicit period is provided', () => {
    const next = applyResetEventState({
      sport: 'Soccer',
      period: '',
      eventIds: new Set()
    }, {});

    expect(next.period).toBe('H1');
  });

  it('detects scheduled reset from game doc when tracked state exists', () => {
    const shouldReset = shouldResetViewerFromGameDoc(
      { liveStatus: 'scheduled', liveHasData: false, homeScore: 0, awayScore: 0 },
      { events: [{ id: 'e1' }], stats: {}, opponentStats: {}, homeScore: 2, awayScore: 0 }
    );
    expect(shouldReset).toBe(true);
  });

  it('applies score_update events to the scoreboard and play-by-play without stats mutation', () => {
    const currentState = {
      events: [],
      stats: { p1: { pts: 2 } },
      opponentStats: {},
      homeScore: 4,
      awayScore: 2
    };

    const result = applyViewerEventToState(currentState, {
      id: 'score-update-1',
      type: 'score_update',
      description: 'Score update: Home 5, Away 2.',
      homeScore: 5,
      awayScore: 2
    });

    expect(result.state.homeScore).toBe(5);
    expect(result.state.awayScore).toBe(2);
    expect(result.state.events).toHaveLength(1);
    expect(result.state.stats).toEqual({ p1: { pts: 2 } });
    expect(result.shouldRenderScoreboard).toBe(true);
    expect(result.shouldRenderPlayByPlay).toBe(true);
    expect(result.animateScoreboard).toBe(true);
    expect(result.shouldCelebrateScore).toBe(true);
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

  it('recomputes the reset boundary while scanning replay batches', () => {
    const events = [
      {
        id: 'reset-1',
        type: 'reset',
        gameClockMs: 10000,
        createdAt: { toMillis: () => 5000 }
      },
      {
        id: 'stale-pre-reset',
        type: 'stat',
        gameClockMs: 30000,
        createdAt: { toMillis: () => 4000 }
      },
      {
        id: 'fresh-post-reset',
        type: 'stat',
        gameClockMs: 35000,
        createdAt: { toMillis: () => 6000 }
      }
    ];

    expect(collectVisibleLiveEventsSequentially(events)).toEqual([
      events[0],
      events[2]
    ]);
  });

  it('applies goal events to live viewer scoreboard and scorer stats', () => {
    const goalEvent = {
      id: 'goal-1',
      type: 'goal',
      playerId: 'p1',
      statKey: 'goals',
      value: 1,
      teamSide: 'home',
      isOpponent: false,
      period: 'H1',
      gameClockMs: 45000,
      homeScore: 1,
      awayScore: 0,
      description: 'Home goal by Alex (H1)'
    };
    const result = applyViewerEventToState({
      events: [],
      stats: {},
      opponentStats: {},
      homeScore: 0,
      awayScore: 0,
      period: 'H1',
      gameClockMs: 0
    }, goalEvent);

    expect(result.state.homeScore).toBe(1);
    expect(result.state.awayScore).toBe(0);
    expect(result.state.period).toBe('H1');
    expect(result.state.events).toEqual([goalEvent]);
    expect(result.state.stats).toEqual({ p1: { goals: 1 } });
    expect(result.state.lastStatChange).toEqual({
      playerId: 'p1',
      statKey: 'goals',
      isOpponent: false
    });
    expect(result.shouldRenderLineup).toBe(true);
    expect(result.shouldRenderPlayByPlay).toBe(true);
    expect(result.shouldCelebrateScore).toBe(true);
  });

  it('preserves seeded opponent goal totals during initial live event replay', () => {
    const goalEvent = {
      id: 'away-goal-1',
      type: 'goal',
      playerId: 'opp1',
      statKey: 'goals',
      value: 1,
      teamSide: 'away',
      isOpponent: true,
      opponentPlayerName: 'Away Striker',
      opponentPlayerNumber: '9',
      period: 'H1',
      homeScore: 0,
      awayScore: 1
    };

    const result = applyViewerEventToState({
      events: [],
      stats: {},
      opponentStats: {
        opp1: {
          name: 'Away Striker',
          number: '9',
          goals: 1
        }
      },
      homeScore: 0,
      awayScore: 1
    }, goalEvent, { preserveSeededOpponentGoalStats: true });

    expect(result.state.opponentStats.opp1.goals).toBe(1);
    expect(result.state.events).toEqual([goalEvent]);
    expect(result.state.lastStatChange).toEqual({
      playerId: 'opp1',
      statKey: 'goals',
      isOpponent: true
    });
    expect(result.shouldRenderLineup).toBe(true);
    expect(result.shouldCelebrateScore).toBe(true);

    const unseeded = applyViewerEventToState({
      events: [],
      stats: {},
      opponentStats: {}
    }, goalEvent, { preserveSeededOpponentGoalStats: true });
    expect(unseeded.state.opponentStats.opp1.goals).toBe(1);
  });

  it('treats football scoring events as scoreboard-changing play-by-play', () => {
    const scoreEvent = {
      id: 'football-score-1',
      type: 'football_score',
      footballScoringAction: 'touchdown',
      points: 6,
      teamSide: 'away',
      isOpponent: true,
      period: 'Q2',
      gameClockMs: 90000,
      homeScore: 7,
      awayScore: 6,
      description: 'Touchdown (6) | Wildcats | Q2'
    };
    const result = applyViewerEventToState({
      events: [],
      stats: {},
      opponentStats: {},
      homeScore: 7,
      awayScore: 0,
      period: 'Q2',
      gameClockMs: 0
    }, scoreEvent);

    expect(result.state.homeScore).toBe(7);
    expect(result.state.awayScore).toBe(6);
    expect(result.state.events).toEqual([scoreEvent]);
    expect(result.shouldRenderPlayByPlay).toBe(true);
    expect(result.shouldRenderScoreboard).toBe(true);
    expect(result.shouldCelebrateScore).toBe(true);
  });
});
