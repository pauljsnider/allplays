import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { summarizePersistedTrackingState, buildTrackLiveResetUpdate, resolveTrackLiveClockResume, buildTrackLiveResumeState } from '../../js/track-live-state.js';

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

  it('rebuilds resumed game log, live notes, and summary text from live events', () => {
    const resumed = buildTrackLiveResumeState({
      liveEvents: [
        {
          type: 'clock_start',
          description: 'Game started',
          period: 'Q1',
          gameClockMs: 0,
          createdAt: { seconds: 10, nanoseconds: 0 }
        },
        {
          type: 'stat',
          description: '#30 Alex +2 PTS',
          period: 'Q1',
          gameClockMs: 15000,
          createdAt: { seconds: 11, nanoseconds: 0 }
        },
        {
          type: 'note',
          description: 'Note: Strong defensive stretch',
          note: 'Strong defensive stretch',
          noteType: 'text',
          liveNoteId: 'note-1',
          period: 'Q1',
          gameClockMs: 20000,
          createdAt: { seconds: 12, nanoseconds: 0 }
        },
        {
          type: 'goal',
          description: 'Ava scored for the home team',
          note: 'Left-footed finish',
          liveNoteId: 'goal-note-1',
          teamSide: 'home',
          period: 'H2',
          gameClockMs: 61000,
          createdAt: { seconds: 13, nanoseconds: 0 }
        },
        {
          type: 'clock_pause',
          description: 'Game paused',
          period: 'H2',
          gameClockMs: 62000,
          createdAt: { seconds: 14, nanoseconds: 0 }
        }
      ],
      buildGoalNoteText: (event) => `Home goal: ${event.note}`
    });

    expect(resumed.gameLog).toEqual([
      { text: 'Game stopped', period: 'H2', time: '1:02', timestamp: 14000 },
      { text: 'Ava scored for the home team', period: 'H2', time: '1:01', timestamp: 13000 },
      { text: 'Note: Strong defensive stretch', period: 'Q1', time: '0:20', timestamp: 12000 },
      { text: '#30 Alex +2 PTS', period: 'Q1', time: '0:15', timestamp: 11000 },
      { text: 'Game started', period: 'Q1', time: '0:00', timestamp: 10000 }
    ]);
    expect(resumed.liveNotes).toEqual([
      { id: 'goal-note-1', text: 'Home goal: Left-footed finish', type: 'goal', period: 'H2', time: '1:01', timestamp: 13000 },
      { id: 'note-1', text: 'Strong defensive stretch', type: 'text', period: 'Q1', time: '0:20', timestamp: 12000 }
    ]);
    expect(resumed.summaryText).toBe('Strong defensive stretch\nHome goal: Left-footed finish');
  });

  it('applies reset and undo events when rebuilding resumed tracker state', () => {
    const resumed = buildTrackLiveResumeState({
      liveEvents: [
        {
          type: 'stat',
          description: '#12 Maya +1 AST',
          period: 'Q1',
          gameClockMs: 5000,
          createdAt: { seconds: 10, nanoseconds: 0 }
        },
        {
          type: 'note',
          description: 'Note: Hot start',
          note: 'Hot start',
          noteType: 'text',
          liveNoteId: 'note-hot-start',
          period: 'Q1',
          gameClockMs: 10000,
          createdAt: { seconds: 11, nanoseconds: 0 }
        },
        {
          type: 'undo',
          description: 'Undo: Note: Hot start',
          removedNote: 'Hot start',
          period: 'Q1',
          gameClockMs: 12000,
          createdAt: { seconds: 12, nanoseconds: 0 }
        },
        {
          type: 'reset',
          description: 'Tracker restarted from zero',
          period: 'Q1',
          gameClockMs: 0,
          createdAt: { seconds: 13, nanoseconds: 0 }
        },
        {
          type: 'stat',
          description: '#5 Eli +3 PTS',
          period: 'Q2',
          gameClockMs: 15000,
          createdAt: { seconds: 14, nanoseconds: 0 }
        },
        {
          type: 'undo',
          description: 'Corrected: PTS adjusted',
          period: 'Q2',
          gameClockMs: 16000,
          createdAt: { seconds: 15, nanoseconds: 0 }
        }
      ]
    });

    expect(resumed.gameLog).toEqual([
      { text: 'Corrected: PTS adjusted', period: 'Q2', time: '0:16', timestamp: 15000 },
      { text: '#5 Eli +3 PTS', period: 'Q2', time: '0:15', timestamp: 14000 }
    ]);
    expect(resumed.liveNotes).toEqual([]);
    expect(resumed.summaryText).toBe('');
  });

  it('hydrates track-live from ordered live events on init', () => {
    const trackLiveHtml = readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');

    expect(trackLiveHtml).toContain('buildTrackLiveResumeState');
    expect(trackLiveHtml).toContain("orderBy('createdAt', 'asc')");
    expect(trackLiveHtml).toContain('gameState.gameLog = resumedTrackingState.gameLog;');
    expect(trackLiveHtml).toContain('gameState.liveNotes = resumedTrackingState.liveNotes;');
    expect(trackLiveHtml).toContain('summaryField.value = resumedTrackingState.summaryText;');
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
