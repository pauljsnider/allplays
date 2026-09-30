import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  shouldPromptWrapupOnCompletion,
  getWrapupFormState,
  getWrapupScore,
  buildFinishGamePayload,
  buildMatchReportUrl,
  buildPracticeFeedPrompt,
  buildGameSummaryPrompt
} from '../../js/game-day-wrapup.js';

const gameDayPageSource = readFileSync(resolve(process.cwd(), 'game-day.html'), 'utf8');

function createGameDaySubscriptionHarness(overrides = {}) {
  const subscriptionStart = gameDayPageSource.indexOf('        function subscribeGameDayData()');
  const subscriptionEnd = gameDayPageSource.indexOf('        // ==================== SUBBANNER', subscriptionStart);
  const setModeStart = gameDayPageSource.indexOf('        window.setMode = function(mode)');
  const setModeEnd = gameDayPageSource.indexOf('        function renderCurrentMode()', setModeStart);
  const pageFunctions = [
    gameDayPageSource.slice(subscriptionStart, subscriptionEnd),
    gameDayPageSource.slice(setModeStart, setModeEnd)
  ].join('\n');
  const state = {
    teamId: 'team-1',
    gameId: 'game-1',
    mode: 'wrapup',
    gameViewTab: 'field',
    liveEvents: [{ id: 'bounded-event' }],
    boundedLiveEvents: [{ id: 'bounded-event' }],
    completedLiveEvents: [],
    liveEventsSubscriptionActive: false,
    completedLiveEventsLoaded: false,
    completedLiveEventsLoadInFlight: false,
    unsubscribers: [],
    ...overrides.state
  };
  const dependencies = {
    state,
    subscribeAggregatedStats: vi.fn(() => vi.fn()),
    subscribeLiveEvents: vi.fn(() => vi.fn()),
    getLiveEvents: vi.fn(async () => []),
    markAiChatContextDirty: vi.fn(),
    renderStatsView: vi.fn(),
    renderLiveEventLog: vi.fn(),
    renderWrapup: vi.fn(),
    updateModeSwitcherUI: vi.fn(),
    renderCurrentMode: vi.fn(),
    console,
    ...overrides
  };
  dependencies.state = state;

  const createHarness = new Function('deps', `
    const {
      state, subscribeAggregatedStats, subscribeLiveEvents, getLiveEvents,
      markAiChatContextDirty, renderStatsView, renderLiveEventLog, renderWrapup,
      updateModeSwitcherUI, renderCurrentMode, console
    } = deps;
    const window = {};
    ${pageFunctions}
    return { subscribeGameDayData, loadCompletedGameEvents, setMode: window.setMode };
  `);

  return { state, dependencies, ...createHarness(dependencies) };
}

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

  it('reads the edited wrap-up score values for AI prompts and completion', () => {
    expect(getWrapupScore({
      homeScoreValue: '3',
      awayScoreValue: '2'
    })).toEqual({
      home: 3,
      away: 2
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

  it('builds a basketball-specific practice feed prompt', () => {
    const prompt = buildPracticeFeedPrompt({
      team: { name: 'Falcons', sport: 'Basketball' },
      game: { opponent: 'Tigers' },
      score: { home: 48, away: 42 },
      coachingNotes: [{ text: 'Need better weak-side help.' }],
      notes: 'Rotations improved late.',
      events: [{ playerName: 'Ava', stat: '3PT Made' }]
    });

    expect(prompt).toContain('Analyze this basketball game');
    expect(prompt).not.toContain('Analyze this soccer game');
  });

  it('builds a soccer-specific practice feed prompt', () => {
    const prompt = buildPracticeFeedPrompt({
      team: { name: 'United', sport: 'Soccer' },
      game: { opponent: 'Rovers' },
      score: { home: 3, away: 1 },
      coachingNotes: [],
      notes: '',
      events: []
    });

    expect(prompt).toContain('Analyze this soccer game');
  });

  it('builds a basketball-specific summary prompt', () => {
    const prompt = buildGameSummaryPrompt({
      team: { name: 'Falcons', sport: 'Basketball' },
      game: { opponent: 'Tigers' },
      score: { home: 48, away: 42 },
      coachingNotes: [{ text: 'Strong rebounding finish.' }],
      notes: 'Bench energy changed the game.'
    });

    expect(prompt).toContain('youth basketball team');
    expect(prompt).not.toContain('youth soccer team');
  });

  it('builds a soccer-specific summary prompt', () => {
    const prompt = buildGameSummaryPrompt({
      team: { name: 'United', sport: 'Soccer' },
      game: { opponent: 'Rovers' },
      score: { home: 3, away: 1 },
      coachingNotes: [],
      notes: ''
    });

    expect(prompt).toContain('youth soccer team');
  });
});

describe('game-day wrap-up page wiring', () => {
  it('rerenders wrap-up after the complete event history finishes loading', async () => {
    let resolveEvents;
    const getLiveEvents = vi.fn(() => new Promise((resolve) => {
      resolveEvents = resolve;
    }));
    const harness = createGameDaySubscriptionHarness({ getLiveEvents });
    const fullHistory = [{ id: 'event-1' }, { id: 'event-2' }];

    const loading = harness.loadCompletedGameEvents();
    expect(harness.dependencies.renderWrapup).not.toHaveBeenCalled();

    resolveEvents(fullHistory);
    await loading;

    expect(harness.state.liveEvents).toBe(fullHistory);
    expect(harness.dependencies.renderWrapup).toHaveBeenCalledOnce();
  });

  it('subscribes only to missing live events when switching an initial wrap-up view to Game Day', () => {
    const harness = createGameDaySubscriptionHarness({
      getLiveEvents: vi.fn(async () => [{ id: 'completed-event' }])
    });

    harness.subscribeGameDayData();
    expect(harness.dependencies.subscribeAggregatedStats).toHaveBeenCalledOnce();
    expect(harness.dependencies.subscribeLiveEvents).not.toHaveBeenCalled();

    harness.setMode('gameday');

    expect(harness.dependencies.subscribeAggregatedStats).toHaveBeenCalledOnce();
    expect(harness.dependencies.subscribeLiveEvents).toHaveBeenCalledOnce();
  });

  it('uses the bounded live subscription only for active games and preserves full completed replay loading', () => {
    const source = gameDayPageSource;

    expect(source).toContain('broadcastLiveEvent, subscribeLiveEvents, getLiveEvents, subscribeAggregatedStats,');
    expect(source).toContain("if (state.mode === 'gameday') {");
    expect(source).toContain('subscribeLiveEvents(state.teamId, state.gameId');
    expect(source).toContain('state.completedLiveEvents = await getLiveEvents(state.teamId, state.gameId);');
    expect(source).toContain('completedLiveEventsLoaded');
    expect(source).toContain("if (state.mode !== 'gameday') return;");
    expect(source).toContain('state.liveEvents = state.boundedLiveEvents;');
    expect(source).toContain('state.liveEvents = state.completedLiveEvents;');

    const subscriptionBlock = source.slice(
      source.indexOf("if (state.mode === 'gameday') {"),
      source.indexOf('async function loadCompletedGameEvents()')
    );
    expect(subscriptionBlock).toContain('subscribeLiveEvents(state.teamId, state.gameId');
    expect(subscriptionBlock).not.toContain('getLiveEvents(');
  });

  it('routes the completion transition, wrap-up prefill, and finish flow through the helper module', () => {
    const source = readFileSync(resolve(process.cwd(), 'game-day.html'), 'utf8');

    expect(source).toContain("from './js/game-day-wrapup.js?v=2'");
    expect(source).toContain('shouldPromptWrapupOnCompletion({');
    expect(source).toContain('const wrapupFormState = getWrapupFormState({');
    const wrapupActions = source.slice(
      source.indexOf('window.analyzeGame = async function()'),
      source.indexOf('window.finishGame = async function()')
    );

    expect(wrapupActions).toContain('const wrapupScore = getWrapupScore({');
    expect(wrapupActions).toContain('const prompt = buildPracticeFeedPrompt({');
    expect(wrapupActions).toContain('const prompt = buildGameSummaryPrompt({');
    expect(wrapupActions).toContain('score: wrapupScore,');
    expect(wrapupActions).not.toContain('score: state.score,');
    expect(source).toContain('const completionPayload = buildFinishGamePayload({');
    expect(source).toContain('window.location.href = buildMatchReportUrl({');
  });
});
