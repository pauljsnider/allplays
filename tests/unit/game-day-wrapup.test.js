import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  shouldPromptWrapupOnCompletion,
  getWrapupFormState,
  buildFinishGamePayload,
  buildMatchReportUrl
} from '../../js/game-day-wrapup.js';

describe('game day wrap-up helpers', () => {
  it('opens wrap-up when a real-time update marks the game completed outside wrap-up mode', () => {
    expect(shouldPromptWrapupOnCompletion({
      prevLiveStatus: 'live',
      nextLiveStatus: 'completed',
      mode: 'gameday'
    })).toBe(true);
  });

  it('does not prompt when the game was already completed or wrap-up is already open', () => {
    expect(shouldPromptWrapupOnCompletion({
      prevLiveStatus: 'completed',
      nextLiveStatus: 'completed',
      mode: 'gameday'
    })).toBe(false);

    expect(shouldPromptWrapupOnCompletion({
      prevLiveStatus: 'live',
      nextLiveStatus: 'completed',
      mode: 'wrapup'
    })).toBe(false);
  });

  it('prefills wrap-up fields from current score state and saved notes', () => {
    expect(getWrapupFormState({
      score: { home: 4, away: 2 },
      game: { postGameNotes: 'Closed out strong.' }
    })).toEqual({
      homeScore: 4,
      awayScore: 2,
      postGameNotes: 'Closed out strong.'
    });
  });

  it('builds the completion payload with trimmed notes and completed statuses', () => {
    expect(buildFinishGamePayload({
      homeScoreValue: '5',
      awayScoreValue: '3',
      postGameNotesValue: '  Great defensive shape.  '
    })).toEqual({
      homeScore: 5,
      awayScore: 3,
      postGameNotes: 'Great defensive shape.',
      status: 'completed',
      liveStatus: 'completed'
    });
  });

  it('builds the match report redirect URL from the team and game ids', () => {
    expect(buildMatchReportUrl({
      teamId: 'team-42',
      gameId: 'game-7'
    })).toBe('game.html#teamId=team-42&gameId=game-7');
  });
});

describe('game-day wrap-up page wiring', () => {
  it('routes the completion transition, wrap-up prefill, and finish flow through the helper module', () => {
    const source = readFileSync(resolve(process.cwd(), 'game-day.html'), 'utf8');

    expect(source).toContain("from './js/game-day-wrapup.js?v=1'");
    expect(source).toContain('shouldPromptWrapupOnCompletion({');
    expect(source).toContain('const wrapupFormState = getWrapupFormState({');
    expect(source).toContain('const completionPayload = buildFinishGamePayload({');
    expect(source).toContain('window.location.href = buildMatchReportUrl({');
  });
});
