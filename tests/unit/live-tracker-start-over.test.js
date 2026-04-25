import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { hydrateOpponentStats } from '../../js/live-tracker-opponent-stats.js';
import { buildPersistedResumeClockState, deriveResumeClockState } from '../../js/live-tracker-resume.js';
import { restoreLiveLineup } from '../../js/live-tracker-lineup.js';
import { buildLiveResetEvent } from '../../js/live-tracker-reset.js';
import { getDefaultLivePeriod, getSportPeriodLabels } from '../../js/live-sport-config.js';
import { readPersistedLiveTrackerQueue, writePersistedLiveTrackerQueue } from '../../js/live-tracker-queue.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

class MockClassList {
  constructor() {
    this.tokens = new Set();
  }

  add(...tokens) {
    tokens.forEach((token) => this.tokens.add(token));
  }

  remove(...tokens) {
    tokens.forEach((token) => this.tokens.delete(token));
  }

  toggle(token, force) {
    if (force === undefined) {
      if (this.tokens.has(token)) {
        this.tokens.delete(token);
        return false;
      }
      this.tokens.add(token);
      return true;
    }

    if (force) {
      this.tokens.add(token);
      return true;
    }

    this.tokens.delete(token);
    return false;
  }

  contains(token) {
    return this.tokens.has(token);
  }
}

class MockElement {
  constructor(id = '') {
    this.id = id;
    this.dataset = {};
    this.listeners = new Map();
    this.classList = new MockClassList();
    this.style = {};
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.src = '';
    this._textContent = '';
    this._innerHTML = '';
    this.queryGroups = new Map();
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatchEvent(event) {
    (this.listeners.get(event?.type) || []).forEach((handler) => handler(event));
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }

  focus() {}

  set textContent(value) {
    this._textContent = String(value ?? '');
  }

  get textContent() {
    return this._textContent;
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? '');
    this.queryGroups = new Map();
    this.captureSelector('[data-opp-edit]', /data-opp-edit="([^"]+)"/g, 'oppEdit');
    this.captureSelector('[data-opp-del]', /data-opp-del="([^"]+)"/g, 'oppDel');
    this.captureSelector('[data-opp-stat]', /data-opp-stat="([^"]+)"/g, 'oppStat');
    this.captureSelector('[data-opp-team]', /data-opp-team="([^"]+)"/g, 'oppTeam');
    this.captureSelector('[data-opp-roster]', /data-opp-roster="([^"]+)"/g, 'oppRoster', (element, match) => {
      element.checked = /checked/.test(match[0]);
    });
    this.captureSelector('[data-player-time]', /data-player-time="([^"]+)"/g, 'playerTime');
  }

  get innerHTML() {
    return this._innerHTML;
  }

  captureSelector(selector, pattern, datasetKey, extraSetup = null) {
    const matches = [...this._innerHTML.matchAll(pattern)].map((match) => {
      const element = new MockElement();
      element.dataset[datasetKey] = match[1];
      if (typeof extraSetup === 'function') {
        extraSetup(element, match);
      }
      return element;
    });
    this.queryGroups.set(selector, matches);
  }

  querySelectorAll(selector) {
    return this.queryGroups.get(selector) || [];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function createEnvironment() {
  const elements = new Map();
  const periodButtons = [];

  function ensureElement(id) {
    if (!elements.has(id)) {
      elements.set(id, new MockElement(id));
    }
    return elements.get(id);
  }

  return {
    document: {
      querySelector(selector) {
        if (!selector.startsWith('#')) return null;
        return ensureElement(selector.slice(1));
      },
      querySelectorAll(selector) {
        if (selector === '.period-btn') return periodButtons;
        return [];
      },
      getElementById(id) {
        return ensureElement(id);
      }
    }
  };
}

function replaceImport(source, pattern, replacement) {
  const updated = source.replace(pattern, replacement);
  if (updated === source) {
    throw new Error(`Failed to rewrite import for pattern: ${pattern}`);
  }
  return updated;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceNamedImportByModulePath(source, modulePath, replacement) {
  const pattern = new RegExp(
    `import\\s*\\{[\\s\\S]*?\\}\\s*from\\s*['"]${escapeRegex(modulePath)}(?:\\?v=[^'"]+)?['"];?\\s*`
  );
  return replaceImport(source, pattern, replacement);
}

function buildModuleSource(source = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8')) {
  const authHook = `checkAuth(async (user) => {\n  if (!user) {\n    window.location.href = 'login.html';\n    return;\n  }\n  currentUser = user;\n  await init();\n});`;

  let rewritten = source;
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './db.js',
    'const { getTeam, getTeams, getGame, getPlayers, getConfigs, updateGame, collection, getDocs, deleteDoc, query, broadcastLiveEvent, subscribeLiveChat, postLiveChatMessage, setGameLiveStatus } = deps.db;'
  );
  rewritten = replaceImport(
    rewritten,
    /import\s*\{(?=[\s\S]*\bdb\b)[\s\S]*?\}\s*from\s*['"]\.\/firebase\.js(?:\?v=[^'"]+)?['"];?\s*/,
    'const { db, writeBatch, doc, setDoc, addDoc, onSnapshot } = deps.firebase;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './utils.js',
    'const { getUrlParams, escapeHtml } = deps.utils;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './auth.js',
    'const { checkAuth } = deps.auth;'
  );
  rewritten = replaceImport(
    rewritten,
    /import\s*\{(?=[\s\S]*\bwriteBatch\b)(?=[\s\S]*\bonSnapshot\b)[\s\S]*?\}\s*from\s*['"]\.\/firebase\.js(?:\?v=[^'"]+)?['"];?\s*/,
    ''
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './vendor/firebase-ai.js',
    'const { getAI, getGenerativeModel, GoogleAIBackend } = deps.firebaseAi;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './vendor/firebase-app.js',
    'const { getApp } = deps.firebaseApp;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './live-tracker-notes.js',
    'const { isVoiceRecognitionSupported, normalizeGameNoteText, appendGameSummaryLine, buildGameNoteLogText } = deps.liveTrackerNotes;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './live-tracker-integrity.js',
    'const { canApplySubstitution, applySubstitution } = deps.liveTrackerIntegrity;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './live-tracker-opponent-stats.js',
    'const { hydrateOpponentStats } = deps.liveTrackerOpponentStats;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './live-tracker-resume.js',
    'const { buildPersistedResumeClockState, deriveResumeClockState } = deps.liveTrackerResume;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './live-tracker-lineup.js',
    'const { restoreLiveLineup } = deps.liveTrackerLineup;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './live-tracker-email.js',
    'const { resolveFinalScore } = deps.liveTrackerEmail;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './live-tracker-reset.js',
    'const { buildLiveResetEvent } = deps.liveTrackerReset;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './live-tracker-chat-unread.js',
    'const { advanceLiveChatUnreadState } = deps.liveTrackerChatUnread;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './live-game-state.js',
    'const { resolveLiveStatConfig, resolveLiveStatColumns } = deps.liveGameState;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './live-sport-config.js',
    'const { getDefaultLivePeriod, getSportPeriodLabels } = deps.liveSportConfig;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './live-tracker-finish.js',
    'const { buildOpponentStatsSnapshotFromEntries } = deps.liveTrackerFinish;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './live-tracker-queue.js',
    'const { readPersistedLiveTrackerQueue, writePersistedLiveTrackerQueue } = deps.liveTrackerQueue;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './live-tracker-save-complete.js',
    'const { runSaveAndCompleteWorkflow } = deps.liveTrackerSaveComplete;'
  );

  return rewritten
    .replace(authHook, '')
    .concat(`
return {
  init,
  state,
  els,
  getCurrentGame() {
    return currentGame;
  }
};`);
}

function createSnapshot(entries = []) {
  return {
    docs: entries.map((entry) => ({
      id: entry.id,
      ref: { path: entry.path },
      data: () => entry.data || {}
    })),
    size: entries.length,
    forEach(callback) {
      this.docs.forEach(callback);
    }
  };
}

const moduleSource = buildModuleSource();
const runModule = new AsyncFunction(
  'deps',
  'window',
  'document',
  'console',
  'setTimeout',
  'clearTimeout',
  'alert',
  moduleSource
);

async function bootLiveTracker({ game, snapshots }) {
  const { document } = createEnvironment();
  const updateCalls = [];
  const deleteCalls = [];
  const broadcastCalls = [];
  const confirmMock = vi.fn(() => false);
  const originalConfirm = globalThis.confirm;
  const originalPerformance = globalThis.performance;
  const originalNavigator = globalThis.navigator;

  globalThis.confirm = confirmMock;
  Object.defineProperty(globalThis, 'performance', {
    configurable: true,
    writable: true,
    value: { now: () => 0 }
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async () => {} } }
  });

  const homeTeam = { id: 'team-1', name: 'Tigers', sport: 'Basketball' };
  const linkedOpponentTeam = {
    id: 'opp-team-1',
    name: 'Lions Academy',
    sport: 'Basketball',
    photoUrl: 'https://example.com/lions.png'
  };
  const roster = [
    { id: 'p1', name: 'Alex', number: '4' },
    { id: 'p2', name: 'Blake', number: '7' },
    { id: 'p3', name: 'Casey', number: '12' }
  ];
  const opponentRoster = [
    { id: 'opp-a', name: 'Morgan', number: '10' },
    { id: 'opp-b', name: 'Riley', number: '14' }
  ];
  const config = { baseType: 'Basketball', columns: ['PTS', 'AST'] };

  const deps = {
    db: {
      getTeam: async (teamId) => {
        if (teamId === 'team-1') return homeTeam;
        if (teamId === 'opp-team-1') return linkedOpponentTeam;
        return null;
      },
      getTeams: async () => [homeTeam, linkedOpponentTeam],
      getGame: async () => game,
      getPlayers: async (teamId) => (teamId === 'opp-team-1' ? opponentRoster : roster),
      getConfigs: async () => [config],
      updateGame: async (_teamId, _gameId, payload) => {
        updateCalls.push(payload);
        Object.assign(game, payload);
      },
      collection: (_db, path) => ({ path }),
      getDocs: async (ref) => snapshots[ref.path] || createSnapshot(),
      deleteDoc: async (ref) => {
        deleteCalls.push(ref.path);
      },
      query: (...args) => args[0],
      broadcastLiveEvent: async (_teamId, _gameId, payload) => {
        broadcastCalls.push(payload);
      },
      subscribeLiveChat: () => () => {},
      postLiveChatMessage: async () => {},
      setGameLiveStatus: async () => {}
    },
    firebase: {
      db: {},
      writeBatch: () => ({ set() {}, update() {}, commit: async () => {} }),
      doc: (...parts) => ({ path: parts.join('/') }),
      setDoc: async () => {},
      addDoc: async () => {},
      onSnapshot: () => () => {}
    },
    utils: {
      getUrlParams: () => ({ teamId: 'team-1', gameId: 'game-1' }),
      escapeHtml: (value) => String(value ?? '')
    },
    auth: {
      checkAuth: () => {}
    },
    firebaseAi: {
      getAI: () => ({}),
      getGenerativeModel: () => ({ generateContent: async () => ({ response: { text: () => '' } }) }),
      GoogleAIBackend: class {}
    },
    firebaseApp: {
      getApp: () => ({})
    },
    liveTrackerNotes: {
      isVoiceRecognitionSupported: () => false,
      normalizeGameNoteText: (text) => text,
      appendGameSummaryLine: (summary, line) => `${summary}\n${line}`.trim(),
      buildGameNoteLogText: (text) => text
    },
    liveTrackerIntegrity: {
      canApplySubstitution: () => true,
      applySubstitution: ({ onCourt = [], bench = [] } = {}) => ({ applied: false, onCourt, bench })
    },
    liveTrackerOpponentStats: {
      hydrateOpponentStats
    },
    liveTrackerResume: {
      buildPersistedResumeClockState,
      deriveResumeClockState
    },
    liveTrackerLineup: {
      restoreLiveLineup
    },
    liveTrackerEmail: {
      resolveFinalScore: (value) => Number(value || 0)
    },
    liveTrackerReset: {
      buildLiveResetEvent
    },
    liveTrackerChatUnread: {
      advanceLiveChatUnreadState: (state) => state
    },
    liveGameState: {
      resolveLiveStatConfig: () => config,
      resolveLiveStatColumns: () => config.columns
    },
    liveSportConfig: {
      getDefaultLivePeriod,
      getSportPeriodLabels
    },
    liveTrackerFinish: {
      buildOpponentStatsSnapshotFromEntries: () => ({})
    },
    liveTrackerQueue: {
      readPersistedLiveTrackerQueue,
      writePersistedLiveTrackerQueue
    },
    liveTrackerSaveComplete: {
      runSaveAndCompleteWorkflow: async () => ({})
    }
  };

  const window = {
    location: { href: '' },
    addEventListener: () => {}
  };

  const page = await runModule(
    deps,
    window,
    document,
    console,
    () => 1,
    () => {},
    () => {}
  );

  return {
    ...page,
    updateCalls,
    deleteCalls,
    broadcastCalls,
    confirmMock,
    restoreGlobals() {
      globalThis.confirm = originalConfirm;
      Object.defineProperty(globalThis, 'performance', {
        configurable: true,
        writable: true,
        value: originalPerformance
      });
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator
      });
    }
  };
}

describe('live tracker start over reset flow', () => {
  it('clears persisted live data, preserves opponent linkage, and resets the rendered score', async () => {
    const game = {
      id: 'game-1',
      type: 'game',
      opponent: 'Lions',
      opponentTeamId: 'opp-team-1',
      opponentTeamName: 'Lions Academy',
      opponentTeamPhoto: 'https://example.com/lions.png',
      opponentStats: {
        'opp-stale': {
          name: 'Stale Opponent',
          number: '10',
          playerId: 'opp-stale',
          photoUrl: 'https://example.com/stale.png',
          pts: 19,
          ast: 3,
          fouls: 2
        }
      },
      homeScore: 42,
      awayScore: 38,
      liveHasData: true,
      liveStatus: 'live',
      liveLineup: {
        onCourt: ['p1'],
        bench: ['p2', 'p3']
      }
    };
    const snapshots = {
      'teams/team-1/games/game-1/events': createSnapshot([
        { id: 'evt-1', path: 'teams/team-1/games/game-1/events/evt-1' },
        { id: 'evt-2', path: 'teams/team-1/games/game-1/events/evt-2' }
      ]),
      'teams/team-1/games/game-1/aggregatedStats': createSnapshot([
        { id: 'p1', path: 'teams/team-1/games/game-1/aggregatedStats/p1' }
      ]),
      'teams/team-1/games/game-1/liveEvents': createSnapshot([
        {
          id: 'live-1',
          path: 'teams/team-1/games/game-1/liveEvents/live-1',
          data: {
            type: 'stat',
            isOpponent: true,
            playerId: 'opp-stale',
            statKey: 'PTS',
            value: 2,
            opponentPlayerName: 'Stale Opponent',
            opponentPlayerNumber: '10'
          }
        }
      ])
    };

    const page = await bootLiveTracker({ game, snapshots });

    try {
      await page.init();

      expect(page.confirmMock).toHaveBeenCalledTimes(1);
      expect(page.deleteCalls).toEqual(expect.arrayContaining([
        'teams/team-1/games/game-1/events/evt-1',
        'teams/team-1/games/game-1/events/evt-2',
        'teams/team-1/games/game-1/aggregatedStats/p1',
        'teams/team-1/games/game-1/liveEvents/live-1'
      ]));

      const resetUpdate = page.updateCalls.find((payload) => (
        payload.homeScore === 0
        && payload.awayScore === 0
        && payload.liveStatus === 'scheduled'
        && payload.liveHasData === false
      ));

      expect(resetUpdate).toMatchObject({
        homeScore: 0,
        awayScore: 0,
        opponentStats: {},
        liveStatus: 'scheduled',
        liveHasData: false,
        liveClockMs: 0,
        liveClockRunning: false,
        liveClockPeriod: 'Q1',
        liveLineup: {
          onCourt: [],
          bench: ['p1', 'p2', 'p3']
        },
        opponent: 'Lions',
        opponentTeamId: 'opp-team-1',
        opponentTeamName: 'Lions Academy',
        opponentTeamPhoto: 'https://example.com/lions.png'
      });
      expect(resetUpdate.liveResetAt).toEqual(expect.any(Number));
      expect(resetUpdate.liveClockUpdatedAt).toEqual(expect.any(Number));

      expect(page.els.scoreLine.textContent).toBe('0 — 0');
      expect(page.state.home).toBe(0);
      expect(page.state.away).toBe(0);
      expect(page.getCurrentGame()).toMatchObject({
        opponent: 'Lions',
        opponentTeamId: 'opp-team-1',
        opponentTeamName: 'Lions Academy',
        opponentTeamPhoto: 'https://example.com/lions.png'
      });
      expect(page.state.opp.reduce((sum, opponent) => sum + (opponent.stats?.pts || 0), 0)).toBe(0);
      expect(page.broadcastCalls).toHaveLength(1);
      expect(page.broadcastCalls[0]).toMatchObject({
        type: 'reset',
        homeScore: 0,
        awayScore: 0,
        opponentStats: {},
        description: 'Tracker restarted from zero. Live viewer state cleared.'
      });
    } finally {
      page.restoreGlobals();
    }
  });
});
