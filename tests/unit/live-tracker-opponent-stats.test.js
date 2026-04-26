import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { hydrateOpponentStats } from '../../js/live-tracker-opponent-stats.js';
import {
  readPersistedLiveTrackerPendingFinish,
  readPersistedLiveTrackerQueue,
  writePersistedLiveTrackerPendingFinish,
  writePersistedLiveTrackerQueue
} from '../../js/live-tracker-queue.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

class MockClassList {
  constructor() {
    this.tokens = new Set();
  }

  toggle(token, force) {
    if (force) {
      this.tokens.add(token);
      return true;
    }
    this.tokens.delete(token);
    return false;
  }
}

class MockElement {
  constructor(id = '') {
    this.id = id;
    this.dataset = {};
    this.listeners = new Map();
    this.classList = new MockClassList();
    this._innerHTML = '';
    this.queryGroups = {
      '[data-opp-edit]': [],
      '[data-opp-del]': [],
      '[data-opp-stat]': []
    };
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  click() {
    (this.listeners.get('click') || []).forEach(handler => handler());
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.queryGroups = {
      '[data-opp-edit]': [...this._innerHTML.matchAll(/data-opp-edit="([^"]+)"/g)].map(([, id]) => {
        const element = new MockElement();
        element.dataset.oppEdit = id;
        element.value = '';
        return element;
      }),
      '[data-opp-del]': [...this._innerHTML.matchAll(/data-opp-del="([^"]+)"/g)].map(([, id]) => {
        const element = new MockElement();
        element.dataset.oppDel = id;
        return element;
      }),
      '[data-opp-stat]': []
    };
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelectorAll(selector) {
    return this.queryGroups[selector] || [];
  }
}

function createEnvironment() {
  const elements = new Map();

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
    'const { canApplySubstitution, applySubstitution, resolveFinalScoreForCompletion, acquireSingleFlightLock, releaseSingleFlightLock } = deps.liveTrackerIntegrity;'
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
    'const { resolveFinalScore, resolveSummaryRecipient } = deps.liveTrackerEmail;'
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
    'const { buildOpponentStatsSnapshotFromEntries, buildFinishCompletionPlan, executeFinishNavigationPlan } = deps.liveTrackerFinish;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './live-tracker-queue.js',
    'const { readPersistedLiveTrackerQueue, writePersistedLiveTrackerQueue, readPersistedLiveTrackerPendingFinish, writePersistedLiveTrackerPendingFinish } = deps.liveTrackerQueue;'
  );
  rewritten = replaceNamedImportByModulePath(
    rewritten,
    './live-tracker-save-complete.js',
    'const { commitFinishPlan, runSaveAndCompleteWorkflow } = deps.liveTrackerSaveComplete;'
  );

  return rewritten
    .replace(authHook, '')
    .concat(`
return {
  state,
  els,
  renderOpponents,
  addSelectedOpponentRoster,
  setContext(context = {}) {
    currentTeamId = context.teamId || null;
    currentGameId = context.gameId || null;
    currentConfig = context.config || null;
    currentGame = context.game || null;
  },
  setOpponentRoster(players = [], selectedIds = []) {
    opponentRoster = players;
    opponentRosterSelected = new Set(selectedIds);
  }
};`);
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

async function bootLiveTracker({ updateGame }) {
  const { document } = createEnvironment();
  const scheduledTimeouts = new Map();
  let nextTimeoutId = 1;
  const deps = {
    db: {
      getTeam: async () => ({}),
      getTeams: async () => [],
      getGame: async () => ({}),
      getPlayers: async () => [],
      getConfigs: async () => [],
      updateGame,
      collection: () => ({}),
      getDocs: async () => ({ docs: [], size: 0, forEach() {} }),
      deleteDoc: async () => {},
      query: () => ({}),
      broadcastLiveEvent: async () => {},
      subscribeLiveChat: () => () => {},
      postLiveChatMessage: async () => {},
      setGameLiveStatus: async () => {}
    },
    firebase: {
      db: {},
      writeBatch: () => ({ set() {}, update() {}, commit: async () => {} }),
      doc: () => ({}),
      setDoc: async () => {},
      addDoc: async () => {},
      onSnapshot: () => () => {}
    },
    utils: {
      getUrlParams: () => ({}),
      escapeHtml: value => String(value ?? '')
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
      normalizeGameNoteText: text => text,
      appendGameSummaryLine: (summary, line) => `${summary}\n${line}`.trim(),
      buildGameNoteLogText: text => text
    },
    liveTrackerIntegrity: {
      canApplySubstitution: () => true,
      applySubstitution: ({ onCourt = [], bench = [] } = {}) => ({ applied: false, onCourt, bench }),
      resolveFinalScoreForCompletion: () => ({}),
      acquireSingleFlightLock: () => true,
      releaseSingleFlightLock: () => {}
    },
    liveTrackerOpponentStats: {
      hydrateOpponentStats
    },
    liveTrackerResume: {
      buildPersistedResumeClockState: () => ({}),
      deriveResumeClockState: () => ({ restored: false, period: 'Q1', clock: 0 })
    },
    liveTrackerLineup: {
      restoreLiveLineup: () => ({ onCourt: [], bench: [] })
    },
    liveTrackerEmail: {
      resolveFinalScore: value => Number(value || 0),
      resolveSummaryRecipient: () => ''
    },
    liveTrackerReset: {
      buildLiveResetEvent: () => ({})
    },
    liveTrackerChatUnread: {
      advanceLiveChatUnreadState: state => state
    },
    liveGameState: {
      resolveLiveStatConfig: () => null,
      resolveLiveStatColumns: () => []
    },
    liveSportConfig: {
      getDefaultLivePeriod: () => 'Q1',
      getSportPeriodLabels: () => []
    },
    liveTrackerFinish: {
      buildOpponentStatsSnapshotFromEntries: ({ opponentEntries = [], columns = [] } = {}) => {
        const opponentStats = {};
        opponentEntries.forEach((opp) => {
          opponentStats[opp.id] = {
            name: opp.name || '',
            number: opp.number || '',
            playerId: opp.playerId || null,
            photoUrl: opp.photoUrl || ''
          };
          columns.forEach((col) => {
            const key = col.toLowerCase();
            opponentStats[opp.id][key] = opp.stats?.[key] || 0;
          });
          opponentStats[opp.id].fouls = opp.stats?.fouls || 0;
        });
        return opponentStats;
      },
      buildFinishCompletionPlan: () => ({}),
      executeFinishNavigationPlan: () => {}
    },
    liveTrackerQueue: {
      readPersistedLiveTrackerQueue,
      writePersistedLiveTrackerQueue,
      readPersistedLiveTrackerPendingFinish,
      writePersistedLiveTrackerPendingFinish
    },
    liveTrackerSaveComplete: {
      commitFinishPlan: async () => {},
      runSaveAndCompleteWorkflow: async () => ({})
    }
  };
  const window = {
    location: { href: '' },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    navigator: { onLine: true },
    addEventListener: () => {}
  };
  const setTimeoutStub = (callback) => {
    const timeoutId = nextTimeoutId++;
    scheduledTimeouts.set(timeoutId, callback);
    return timeoutId;
  };
  const clearTimeoutStub = (timeoutId) => {
    scheduledTimeouts.delete(timeoutId);
  };
  const flushTimers = async () => {
    while (scheduledTimeouts.size) {
      const pending = [...scheduledTimeouts.entries()];
      scheduledTimeouts.clear();
      for (const [, callback] of pending) {
        await callback();
      }
      await Promise.resolve();
    }
  };

  const page = await runModule(
    deps,
    window,
    document,
    console,
    setTimeoutStub,
    clearTimeoutStub,
    () => {}
  );

  return {
    ...page,
    flushTimers
  };
}

describe('live tracker opponent stats harness', () => {
  it('rewrites module imports when cache-buster versions and formatting change', () => {
    const source = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8')
      .replace(
        "import { getTeam, getTeams, getGame, getPlayers, getConfigs, updateGame, collection, getDocs, deleteDoc, query, broadcastLiveEvent, subscribeLiveChat, postLiveChatMessage, setGameLiveStatus } from './db.js?v=16';",
        "import {\n  getTeam,\n  getTeams,\n  getGame,\n  getPlayers,\n  getConfigs,\n  updateGame,\n  collection,\n  getDocs,\n  deleteDoc,\n  query,\n  broadcastLiveEvent,\n  subscribeLiveChat,\n  postLiveChatMessage,\n  setGameLiveStatus\n} from './db.js?v=999';"
      )
      .replace('./firebase.js?v=10', './firebase.js?v=77')
      .replace('./utils.js?v=9', './utils.js?v=123')
      .replace('./auth.js?v=12', './auth.js?v=456');

    const rewritten = buildModuleSource(source);

    expect(rewritten).toContain('const { getTeam, getTeams, getGame, getPlayers, getConfigs, updateGame, collection, getDocs, deleteDoc, query, broadcastLiveEvent, subscribeLiveChat, postLiveChatMessage, setGameLiveStatus } = deps.db;');
    expect(rewritten).toContain('const { db, writeBatch, doc, setDoc, addDoc, onSnapshot } = deps.firebase;');
    expect(rewritten).not.toMatch(/import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/(?:db|firebase|utils|auth)\.js\?v=/);
  });
});

describe('live tracker opponent stats hydration', () => {
  it('preserves linked opponent roster additions so resume restores selected players', async () => {
    const updateCalls = [];
    const page = await bootLiveTracker({
      updateGame: async (_teamId, _gameId, payload) => {
        updateCalls.push(payload);
      }
    });

    page.setContext({
      teamId: 'team-1',
      gameId: 'game-1',
      config: { columns: ['PTS'] },
      game: { liveHasData: false }
    });
    page.state.opp = [];
    page.setOpponentRoster([
      { id: 'opp10', name: 'Taylor Guard', number: '10', photoUrl: 'https://img/10.png' },
      { id: 'opp22', name: 'Jordan Wing', number: '22', photoUrl: '' }
    ], ['opp10', 'opp22']);

    page.addSelectedOpponentRoster();
    await page.flushTimers();

    expect(page.state.opp).toEqual([
      {
        id: 'opp10',
        playerId: 'opp10',
        name: 'Taylor Guard',
        number: '10',
        photoUrl: 'https://img/10.png',
        stats: { pts: 0, fouls: 0, time: 0 }
      },
      {
        id: 'opp22',
        playerId: 'opp22',
        name: 'Jordan Wing',
        number: '22',
        photoUrl: '',
        stats: { pts: 0, fouls: 0, time: 0 }
      }
    ]);
    expect(updateCalls).toContainEqual({
      opponentStats: {
        opp10: {
          name: 'Taylor Guard',
          number: '10',
          playerId: 'opp10',
          photoUrl: 'https://img/10.png',
          pts: 0,
          fouls: 0
        },
        opp22: {
          name: 'Jordan Wing',
          number: '22',
          playerId: 'opp22',
          photoUrl: '',
          pts: 0,
          fouls: 0
        }
      }
    });
    expect(updateCalls).toContainEqual({ liveHasData: true });
  });

  it('preserves persisted fouls when resuming opponent stats', () => {
    const hydrated = hydrateOpponentStats({ pts: 8, ast: 2, fouls: 3 }, ['PTS', 'AST']);
    expect(hydrated.pts).toBe(8);
    expect(hydrated.ast).toBe(2);
    expect(hydrated.fouls).toBe(3);
  });

  it('defaults fouls to zero when persisted fouls are missing', () => {
    const hydrated = hydrateOpponentStats({ pts: 4 }, ['PTS']);
    expect(hydrated.pts).toBe(4);
    expect(hydrated.fouls).toBe(0);
  });

  it('persists opponent removals so resume does not restore deleted cards', async () => {
    const updateCalls = [];
    const page = await bootLiveTracker({
      updateGame: async (_teamId, _gameId, payload) => {
        updateCalls.push(payload);
      }
    });

    page.setContext({
      teamId: 'team-1',
      gameId: 'game-1',
      config: { columns: ['PTS'] },
      game: { liveHasData: false }
    });
    page.state.opp = [
      {
        id: 'opp1',
        name: 'Removed Player',
        number: '10',
        playerId: null,
        photoUrl: '',
        stats: { pts: 4, fouls: 1, time: 0 }
      },
      {
        id: 'opp2',
        name: 'Remaining Player',
        number: '12',
        playerId: null,
        photoUrl: '',
        stats: { pts: 7, fouls: 0, time: 0 }
      }
    ];

    page.renderOpponents();
    page.els.oppCards.querySelectorAll('[data-opp-del]')[0].click();
    await page.flushTimers();

    expect(page.state.opp.map((opp) => opp.id)).toEqual(['opp2']);
    expect(updateCalls).toContainEqual({
      opponentStats: {
        opp2: {
          name: 'Remaining Player',
          number: '12',
          playerId: null,
          photoUrl: '',
          pts: 7,
          fouls: 0
        }
      }
    });
    expect(updateCalls).toContainEqual({ liveHasData: true });
  });
});
