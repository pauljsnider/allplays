import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { summarizePersistedTrackingState, buildTrackLiveResetUpdate, resolveTrackLiveClockResume } from '../../js/track-live-state.js';

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
      liveClockMs: 0,
      liveClockRunning: false,
      liveClockPeriod: 'H2',
      liveLineup: { onCourt: ['p1'], bench: ['p2', 'p3'] },
      opponentStats: {},
      liveStatus: 'scheduled',
      liveHasData: false,
      liveResetAt: 1700000000000,
      servingTeam: 'home',
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
    expect(payload.liveClockMs).toBe(0);
    expect(payload.liveClockRunning).toBe(false);
    expect(payload.liveClockPeriod).toBe('Q1');
    expect(payload.opponentTeamId).toBe('');
    expect(payload.opponentTeamName).toBe('');
    expect(payload.opponentTeamPhoto).toBe('');
    expect(payload.liveResetAt?._methodName).toBe('serverTimestamp');
    expect(payload.liveLineup).toEqual({ onCourt: ['p1'], bench: ['p2'] });

    input.onCourt.push('p3');
    expect(payload.liveLineup.onCourt).toEqual(['p1']);
  });

  it('preserves an explicit reset boundary when provided', () => {
    const payload = buildTrackLiveResetUpdate({
      currentGame: {},
      liveResetAt: 1700000000000
    });

    expect(payload.liveResetAt).toBe(1700000000000);
  });

  it('includes default football game state for football resets only', () => {
    expect(buildTrackLiveResetUpdate({
      currentGame: { sport: 'Football' }
    }).liveFootballState).toEqual({ possession: 'home', down: '1', distance: '10', yardLine: '' });

    expect(buildTrackLiveResetUpdate({
      currentGame: { sport: 'Soccer' }
    }).liveFootballState).toBeUndefined();
  });

  it('uses sport-specific default periods for non-basketball resets', () => {
    expect(buildTrackLiveResetUpdate({
      currentGame: { sport: 'Soccer' }
    }).period).toBe('H1');

    expect(buildTrackLiveResetUpdate({
      currentGame: { sport: 'Baseball' }
    }).period).toBe('T1');
  });

  it('restores persisted live clock and period from the game document', () => {
    const resumed = resolveTrackLiveClockResume({
      currentGame: {
        liveClockMs: 125000,
        liveClockRunning: false,
        liveClockPeriod: 'H2',
        period: 'H1'
      },
      currentPeriod: 'H1',
      now: 1700000000000
    });

    expect(resumed).toEqual({
      elapsed: 125000,
      currentPeriod: 'H2',
      wasRunning: false
    });
  });

  it('advances a persisted running live clock from its last sync time', () => {
    const resumed = resolveTrackLiveClockResume({
      currentGame: {
        liveClockMs: 60000,
        liveClockRunning: true,
        liveClockUpdatedAt: 1700000000000,
        liveClockPeriod: 'Q3'
      },
      currentPeriod: 'Q1',
      now: 1700000015000
    });

    expect(resumed).toEqual({
      elapsed: 75000,
      currentPeriod: 'Q3',
      wasRunning: true
    });
  });

  it('wires Cancel Game through reset persistence without deleting immutable live events', () => {
    const trackLiveHtml = readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');
    const cancelGameBody = trackLiveHtml.match(/async function cancelGame\(\) \{([\s\S]*?)\n        function updateTimer\(\)/)?.[1] || '';

    expect(cancelGameBody).toContain('runTrackLiveResetPersistence');
    expect(cancelGameBody).toContain('buildTrackLiveResetUpdate');
    expect(cancelGameBody).toContain("status: 'scheduled'");
    expect(cancelGameBody).toContain('currentGame.liveHasData = false');
    expect(cancelGameBody).toContain('currentGame.homeScore = 0');
    expect(cancelGameBody).toContain('currentGame.awayScore = 0');
    expect(cancelGameBody).toContain('getDocs(collection(db, `teams/${currentTeamId}/games/${currentGameId}/events`))');
    expect(cancelGameBody).toContain('getDocs(collection(db, `teams/${currentTeamId}/games/${currentGameId}/aggregatedStats`))');
    expect(cancelGameBody).not.toContain('games/${currentGameId}/liveEvents');
    expect(cancelGameBody).not.toContain('deleteLiveEventPromises');
    expect(cancelGameBody).not.toContain("currentGame.status !== 'scheduled'");
  });
});
