import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { applyGoalSportScore, buildGoalSportEvent, resolveGoalSportScorer } from '../../js/live-scorekeeping-goal-sports.js';
import { appendGameSummaryLine, buildGoalSportNoteText, buildGameNoteLogText, isVoiceRecognitionSupported, normalizeGameNoteText, removeGameSummaryLine } from '../../js/live-tracker-notes.js';

function readTrackLiveScript() {
  const html = readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');
  const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  expect(match).toBeTruthy();
  return match[1].replace(/^\s*import .+;\n/gm, '');
}

function createGoalSportDomHarness() {
  vi.useFakeTimers();

  const dom = new JSDOM(`
    <body>
      <div id="footer-container"></div>
      <div id="header-container"></div>
      <button id="shareLiveBtn"></button>
      <button id="shareLiveShareBtn"></button>
      <button id="addOpponentBtn"></button>
      <button id="startBtn"></button>
      <button id="stopBtn"></button>
      <button id="resetBtn"></button>
      <button id="undoLastBtn"></button>
      <button id="cancelBtn"></button>
      <button id="finish-btn"></button>
      <button id="cancel-finish"></button>
      <button id="generateAISummary"></button>
      <span id="home-score">0</span>
      <span id="away-score">0</span>
      <span id="volleyball-home-score">0</span>
      <span id="volleyball-away-score">0</span>
      <span id="volleyball-set-label"></span>
      <span id="volleyball-serving-team"></span>
      <span id="timer"></span>
      <div id="liveBadge" class="hidden"></div>
      <div id="finish-modal" class="hidden"></div>
      <form id="finish-form"></form>
      <input id="finalHomeScore">
      <input id="finalAwayScore">
      <input id="sendEmailCheckbox" type="checkbox">
      <div id="emailPreview"></div>
      <div id="aiSummaryLoading"></div>
      <input id="goal-scorer-input">
      <input id="goal-note-input">
      <button id="record-home-goal">Home Goal</button>
      <button id="record-away-goal">Away Goal</button>
      <textarea id="gameSummary"></textarea>
      <div id="live-notes-list"></div>
      <div id="gameLog"></div>
      <span id="stat-p9-goals">0</span>
      <span id="stat-opp7-goals">0</span>
    </body>
  `, {
    url: 'https://example.test/track-live.html#teamId=team-1&gameId=game-1&trackerMode=simple',
    runScripts: 'outside-only'
  });

  const updateGame = vi.fn().mockResolvedValue(undefined);
  const setDoc = vi.fn().mockResolvedValue(undefined);
  const broadcastLiveEvent = vi.fn().mockResolvedValue(undefined);
  const alert = vi.fn();

  Object.assign(dom.window, {
    __goalSportHelpers: { applyGoalSportScore, buildGoalSportEvent, resolveGoalSportScorer },
    __noteHelpers: {
      appendGameSummaryLine,
      buildGameNoteLogText,
      buildGoalSportNoteText,
      isVoiceRecognitionSupported,
      normalizeGameNoteText,
      removeGameSummaryLine
    },
    __dbCalls: { updateGame, setDoc, broadcastLiveEvent },
    alert,
    confirm: vi.fn(() => true),
    scrollTo: vi.fn(),
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  });

  const prelude = `
    const getTeam = async () => ({});
    const getGame = async () => ({});
    const getPlayers = async () => [];
    const getConfigs = async () => [];
    const logStatEvent = async () => {};
    const updatePlayerStats = async () => {};
    const updateGame = window.__dbCalls.updateGame;
    const collection = () => ({});
    const getDocs = async () => ({ docs: [] });
    const deleteDoc = async () => {};
    const query = () => ({});
    const broadcastLiveEvent = window.__dbCalls.broadcastLiveEvent;
    const setGameLiveStatus = async () => {};
    const subscribeLiveChat = () => () => {};
    const postLiveChatMessage = async () => {};
    const db = {};
    const writeBatch = () => ({ set() {}, update() {}, delete() {}, commit: async () => {} });
    const doc = (...parts) => ({ path: parts.join('/') });
    const setDoc = window.__dbCalls.setDoc;
    const addDoc = async () => ({ id: 'doc-1' });
    const onSnapshot = () => () => {};
    const orderBy = () => ({});
    const renderHeader = () => {};
    const renderFooter = () => {};
    const getUrlParams = () => ({ teamId: 'team-1', gameId: 'game-1', trackerMode: 'simple' });
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const resolveOpponentDisplayName = (game) => game?.opponentName || game?.opponentTeamName || 'Away';
    const resolveLiveStatConfig = () => ({});
    const resolveLiveStatColumns = () => [];
    const resolveGoalSportTrackerProfile = () => ({ sport: 'soccer' });
    const createFieldState = () => ({});
    const setPlayerFieldStatus = () => {};
    const startFieldClock = () => {};
    const pauseFieldClock = () => {};
    const getPlayerFieldElapsedMs = () => 0;
    const getLiveLineup = () => [];
    const summarizePersistedTrackingState = () => ({});
    const buildTrackLiveResetUpdate = () => ({});
    const resolveTrackLiveClockResume = () => ({});
    const buildTrackLiveResumeState = () => ({});
    const runTrackLiveResetPersistence = () => ({});
    const getDefaultLivePeriod = () => 'H1';
    const getSportPeriodLabels = () => ['H1', 'H2'];
    const resolveLiveSport = () => 'soccer';
    const isFootballSport = () => false;
    const { applyGoalSportScore, buildGoalSportEvent, resolveGoalSportScorer } = window.__goalSportHelpers;
    const applyVolleyballServeOutcome = () => ({});
    const createVolleyballUndoState = () => ({});
    const restoreVolleyballUndoState = () => ({});
    const isVolleyballSport = () => false;
    const applyBaseballScorekeepingAction = () => ({});
    const createBaseballLiveState = () => ({});
    const getBaseballPeriodLabel = () => 'I1';
    const getBaseballSituationSummary = () => '';
    const isBaseballScorekeepingSport = () => false;
    const parseBaseballPeriodLabel = () => ({});
    const checkAuth = () => {};
    const getApp = () => ({});
    const { isVoiceRecognitionSupported, normalizeGameNoteText, appendGameSummaryLine, removeGameSummaryLine, buildGameNoteLogText, buildGoalSportNoteText } = window.__noteHelpers;
    const collectTournamentAdvancementPatches = () => [];
  `;

  const harnessExports = `
    window.__setGoalSportHarnessState = (state = {}) => {
      currentTeamId = state.currentTeamId || 'team-1';
      currentGameId = state.currentGameId || 'game-1';
      currentUser = state.currentUser || { uid: 'user-1' };
      currentTeam = state.currentTeam || { name: 'Home FC' };
      currentGame = state.currentGame || { opponentName: 'Away FC', homeScore: 0, awayScore: 0 };
      currentConfig = state.currentConfig || { columns: ['Goals'] };
      currentGoalSportProfile = state.currentGoalSportProfile || { sport: 'soccer' };
      homeScore = Number(state.homeScore || 0);
      awayScore = Number(state.awayScore || 0);
      players = state.players || [];
      opponentPlayers = state.opponentPlayers || [];
      gameState.elapsed = Number(state.elapsed || 0);
      gameState.currentPeriod = state.currentPeriod || 'H2';
      gameState.isRunning = Boolean(state.isRunning);
      gameState.playerStats = state.playerStats || {};
      gameState.opponentStats = state.opponentStats || {};
      gameState.gameLog = [];
      gameState.liveNotes = [];
      liveState.isLive = false;
      liveSync.scoreSyncTimeout = null;
      liveSync.opponentTimeout = null;
      liveSync.playerTimeouts = new Map();
      updateScoreDisplay();
      renderGameLog();
      renderLiveNotes();
    };
    window.__getGoalSportHarnessState = () => ({
      homeScore,
      awayScore,
      currentGame,
      gameState,
      liveSync
    });
  `;

  dom.window.eval(`${prelude}\n${readTrackLiveScript()}\n${harnessExports}`);

  const setup = (overrides = {}) => {
    dom.window.__setGoalSportHarnessState({
      players: [{ id: 'p9', name: 'Mia Stone', number: '9' }],
      opponentPlayers: [{ id: 'opp7', name: 'Rival Forward', number: '7' }],
      elapsed: 185000,
      currentPeriod: 'H2',
      homeScore: 0,
      awayScore: 0,
      ...overrides
    });
  };

  return {
    dom,
    updateGame,
    setDoc,
    broadcastLiveEvent,
    alert,
    setup,
    getState: () => dom.window.__getGoalSportHarnessState(),
    async clickGoal(buttonId) {
      dom.window.document.getElementById(buttonId).click();
      await Promise.resolve();
      await Promise.resolve();
    },
    async runScheduledSyncs() {
      await vi.runOnlyPendingTimersAsync();
    }
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('track-live Simple goal-sport DOM recording', () => {
  it('records a home goal from DOM inputs and emits synced score, scorer stat, note, and live event data', async () => {
    const harness = createGoalSportDomHarness();
    harness.setup();

    const { document } = harness.dom.window;
    document.getElementById('goal-scorer-input').value = '#9';
    document.getElementById('goal-note-input').value = 'Header off corner';

    await harness.clickGoal('record-home-goal');
    const state = harness.getState();

    expect(document.getElementById('home-score').textContent).toBe('1');
    expect(document.getElementById('away-score').textContent).toBe('0');
    expect(state.currentGame).toMatchObject({ homeScore: 1, awayScore: 0 });
    expect(state.gameState.playerStats.p9.goals).toBe(1);
    expect(document.getElementById('stat-p9-goals').textContent).toBe('1');
    expect(harness.broadcastLiveEvent).toHaveBeenCalledWith('team-1', 'game-1', expect.objectContaining({
      period: 'H2',
      gameClockMs: 185000,
      playerId: 'p9',
      playerName: 'Mia Stone',
      playerNumber: '9',
      homeScore: 1,
      awayScore: 0,
      liveNoteId: expect.stringMatching(/^note-/),
      liveNoteText: 'Home FC goal: Header off corner'
    }));
    expect(state.gameState.gameLog[0].undoData).toMatchObject({
      type: 'goal',
      teamSide: 'home',
      playerId: 'p9',
      liveNoteId: expect.stringMatching(/^note-/)
    });
    expect(document.getElementById('live-notes-list').textContent).toContain('Home FC goal: Header off corner');

    await harness.runScheduledSyncs();
    expect(harness.updateGame).toHaveBeenCalledWith('team-1', 'game-1', { homeScore: 1, awayScore: 0 });
    expect(harness.setDoc).toHaveBeenCalledWith(expect.objectContaining({
      path: expect.stringContaining('aggregatedStats/p9')
    }), expect.objectContaining({
      playerName: 'Mia Stone',
      playerNumber: '9',
      stats: { goals: 1 },
      timeMs: 0
    }), { merge: true });
  });

  it('records an away goal with opponent stat sync and resolved opponent display name in the live note', async () => {
    const harness = createGoalSportDomHarness();
    harness.setup({
      currentGame: { opponentName: 'Rivals', homeScore: 2, awayScore: 1 },
      homeScore: 2,
      awayScore: 1
    });

    const { document } = harness.dom.window;
    document.getElementById('goal-scorer-input').value = '#7';
    document.getElementById('goal-note-input').value = 'Power play';

    await harness.clickGoal('record-away-goal');
    const state = harness.getState();

    expect(document.getElementById('home-score').textContent).toBe('2');
    expect(document.getElementById('away-score').textContent).toBe('2');
    expect(state.currentGame).toMatchObject({ homeScore: 2, awayScore: 2 });
    expect(state.gameState.opponentStats.opp7.goals).toBe(1);
    expect(document.getElementById('stat-opp7-goals').textContent).toBe('1');
    expect(harness.broadcastLiveEvent).toHaveBeenCalledWith('team-1', 'game-1', expect.objectContaining({
      isOpponent: true,
      opponentPlayerName: 'Rival Forward',
      opponentPlayerNumber: '7',
      homeScore: 2,
      awayScore: 2,
      liveNoteId: expect.stringMatching(/^note-/),
      liveNoteText: 'Rivals goal: Power play'
    }));
    expect(document.getElementById('gameSummary').value).toContain('Rivals goal: Power play');

    await harness.runScheduledSyncs();
    expect(harness.updateGame).toHaveBeenCalledWith('team-1', 'game-1', { homeScore: 2, awayScore: 2 });
    expect(harness.updateGame).toHaveBeenCalledWith('team-1', 'game-1', {
      opponentStats: {
        opp7: {
          name: 'Rival Forward',
          number: '7',
          goals: 1
        }
      }
    });
    expect(harness.setDoc).not.toHaveBeenCalled();
  });

  it('rejects unmatched scorer text before mutating score, stats, notes, or sync state', async () => {
    const harness = createGoalSportDomHarness();
    harness.setup();

    const { document } = harness.dom.window;
    const scorerInput = document.getElementById('goal-scorer-input');
    const focusSpy = vi.spyOn(scorerInput, 'focus');
    scorerInput.value = 'Unknown Scorer';
    document.getElementById('goal-note-input').value = 'Should not save';

    await harness.clickGoal('record-home-goal');
    const state = harness.getState();

    expect(harness.alert).toHaveBeenCalledWith('Enter an exact roster/opponent player name or jersey number, or leave scorer blank for a team goal.');
    expect(focusSpy).toHaveBeenCalled();
    expect(state.homeScore).toBe(0);
    expect(state.awayScore).toBe(0);
    expect(state.gameState.playerStats).toEqual({});
    expect(state.gameState.opponentStats).toEqual({});
    expect(state.gameState.liveNotes).toEqual([]);
    expect(state.gameState.gameLog).toEqual([]);
    expect(state.liveSync.scoreSyncTimeout).toBeNull();
    expect(state.liveSync.playerTimeouts.size).toBe(0);
    expect(state.liveSync.opponentTimeout).toBeNull();
    expect(harness.broadcastLiveEvent).not.toHaveBeenCalled();

    await harness.runScheduledSyncs();
    expect(harness.updateGame).not.toHaveBeenCalled();
    expect(harness.setDoc).not.toHaveBeenCalled();
  });
});
