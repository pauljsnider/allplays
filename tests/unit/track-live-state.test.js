import { describe, it, expect } from 'vitest';
import { summarizePersistedTrackingState, buildTrackLiveResetUpdate } from '../../js/track-live-state.js';

describe('track live state helpers', () => {
  it('summarizes when persisted data exists', () => {
    const result = summarizePersistedTrackingState({
      eventsCount: 2,
      statsCount: 5,
      liveEventsCount: 3,
      hasScores: true,
      hasOpponentStats: true,
      hasLiveFlag: true
    });

    expect(result.hasPersistedData).toBe(true);
    expect(result.parts).toEqual([
      '2 event(s)',
      '5 player stat record(s)',
      '3 live event(s)',
      'saved score',
      'opponent stats',
      'live status'
    ]);
  });

  it('returns no persisted data for empty inputs', () => {
    const result = summarizePersistedTrackingState({});

    expect(result.hasPersistedData).toBe(false);
    expect(result.summary).toBe('tracked data');
    expect(result.parts).toEqual([]);
  });

  it('builds reset update payload with preserved opponent identity fields', () => {
    const payload = buildTrackLiveResetUpdate({
      currentGame: {
        opponent: 'Lions',
        opponentTeamId: 'opp-team-1',
        opponentTeamName: 'Lions Academy',
        opponentTeamPhoto: 'https://example.com/lions.png'
      },
      period: 'H2',
      liveLineup: {
        onCourt: ['p1'],
        bench: ['p2', 'p3']
      },
      liveResetAt: 1700000000000
    });

    expect(payload).toEqual({
      homeScore: 0,
      awayScore: 0,
      period: 'H2',
      liveLineup: { onCourt: ['p1'], bench: ['p2', 'p3'] },
      opponentStats: {},
      liveStatus: 'scheduled',
      liveHasData: false,
      liveResetAt: 1700000000000,
      opponent: 'Lions',
      opponentTeamId: 'opp-team-1',
      opponentTeamName: 'Lions Academy',
      opponentTeamPhoto: 'https://example.com/lions.png'
    });
  });

  it('normalizes reset payload defaults and clones lineup arrays', () => {
    const input = {
      onCourt: ['p1'],
      bench: ['p2']
    };
    const payload = buildTrackLiveResetUpdate({
      currentGame: {},
      liveLineup: input
    });

    expect(payload.period).toBe('Q1');
    expect(payload.opponentTeamId).toBe('');
    expect(payload.opponentTeamName).toBe('');
    expect(payload.opponentTeamPhoto).toBe('');
    expect(payload.liveResetAt).toEqual(expect.any(Number));
    expect(payload.liveLineup).toEqual({ onCourt: ['p1'], bench: ['p2'] });

    input.onCourt.push('p3');
    expect(payload.liveLineup.onCourt).toEqual(['p1']);
  });

  it('uses sport-specific default periods for non-basketball resets', () => {
    expect(buildTrackLiveResetUpdate({
      currentGame: { sport: 'Soccer' }
    }).period).toBe('H1');

    expect(buildTrackLiveResetUpdate({
      currentGame: { sport: 'Baseball' }
    }).period).toBe('T1');
  });
});
