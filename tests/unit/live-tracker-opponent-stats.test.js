import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { hydrateOpponentStats } from '../../js/live-tracker-opponent-stats.js';

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

function buildModuleSource() {
  const source = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');
  const authHook = `checkAuth(async (user) => {\n  if (!user) {\n    window.location.href = 'login.html';\n    return;\n  }\n  currentUser = user;\n  await init();\n});`;

  return source
    .replace(
      "import { getTeam, getTeams, getGame, getPlayers, getConfigs, updateGame, collection, getDocs, deleteDoc, query, broadcastLiveEvent, subscribeLiveChat, postLiveChatMessage, setGameLiveStatus } from './db.js?v=15';",
      'const { getTeam, getTeams, getGame, getPlayers, getConfigs, updateGame, collection, getDocs, deleteDoc, query, broadcastLiveEvent, subscribeLiveChat, postLiveChatMessage, setGameLiveStatus } = deps.db;'
    )
    .replace(
      "import { db } from './firebase.js?v=10';",
      'const { db, writeBatch, doc, setDoc, addDoc, onSnapshot } = deps.firebase;'
    )
    .replace(
      "import { getUrlParams, escapeHtml } from './utils.js?v=9';",
      'const { getUrlParams, escapeHtml } = deps.utils;'
    )
    .replace(
      "import { checkAuth } from './auth.js?v=11';",
      'const { checkAuth } = deps.auth;'
    )
    .replace(
      "import { writeBatch, doc, setDoc, addDoc, onSnapshot } from './firebase.js?v=10';",
      ''
    )
    .replace(
      "import { getAI, getGenerativeModel, GoogleAIBackend } from './vendor/firebase-ai.js';",
      'const { getAI, getGenerativeModel, GoogleAIBackend } = deps.firebaseAi;'
    )
    .replace(
      "import { getApp } from './vendor/firebase-app.js';",
      'const { getApp } = deps.firebaseApp;'
    )
    .replace(
      "import { isVoiceRecognitionSupported, normalizeGameNoteText, appendGameSummaryLine, buildGameNoteLogText } from './live-tracker-notes.js?v=1';",
      'const { isVoiceRecognitionSupported, normalizeGameNoteText, appendGameSummaryLine, buildGameNoteLogText } = deps.liveTrackerNotes;'
    )
    .replace(
      "import { canApplySubstitution, applySubstitution, resolveFinalScoreForCompletion, acquireSingleFlightLock, releaseSingleFlightLock } from './live-tracker-integrity.js?v=2';",
      'const { canApplySubstitution, applySubstitution, resolveFinalScoreForCompletion, acquireSingleFlightLock, releaseSingleFlightLock } = deps.liveTrackerIntegrity;'
    )
    .replace(
      "import { hydrateOpponentStats } from './live-tracker-opponent-stats.js?v=1';",
      'const { hydrateOpponentStats } = deps.liveTrackerOpponentStats;'
    )
    .replace(
      "import { buildPersistedResumeClockState, deriveResumeClockState } from './live-tracker-resume.js?v=3';",
      'const { buildPersistedResumeClockState, deriveResumeClockState } = deps.liveTrackerResume;'
    )
    .replace(
      "import { restoreLiveLineup } from './live-tracker-lineup.js?v=1';",
      'const { restoreLiveLineup } = deps.liveTrackerLineup;'
    )
    .replace(
      "import { resolveFinalScore, resolveSummaryRecipient } from './live-tracker-email.js?v=2';",
      'const { resolveFinalScore, resolveSummaryRecipient } = deps.liveTrackerEmail;'
    )
    .replace(
      "import { buildLiveResetEvent } from './live-tracker-reset.js?v=1';",
      'const { buildLiveResetEvent } = deps.liveTrackerReset;'
    )
    .replace(
      "import { advanceLiveChatUnreadState } from './live-tracker-chat-unread.js?v=2';",
      'const { advanceLiveChatUnreadState } = deps.liveTrackerChatUnread;'
    )
    .replace(
      "import { resolveLiveStatConfig, resolveLiveStatColumns } from './live-game-state.js?v=3';",
      'const { resolveLiveStatConfig, resolveLiveStatColumns } = deps.liveGameState;'
    )
    .replace(
      "import { getDefaultLivePeriod, getSportPeriodLabels } from './live-sport-config.js?v=1';",
      'const { getDefaultLivePeriod, getSportPeriodLabels } = deps.liveSportConfig;'
    )
    .replace(
      "import { buildOpponentStatsSnapshotFromEntries, buildFinishCompletionPlan, executeFinishNavigationPlan } from './live-tracker-finish.js?v=1';",
      'const { buildOpponentStatsSnapshotFromEntries, buildFinishCompletionPlan, executeFinishNavigationPlan } = deps.liveTrackerFinish;'
    )
    .replace(authHook, '')
    .concat(`
return {
  state,
  els,
  renderOpponents,
  setContext(context = {}) {
    currentTeamId = context.teamId || null;
    currentGameId = context.gameId || null;
    currentConfig = context.config || null;
    currentGame = context.game || null;
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
    }
  };
  const window = { location: { href: '' } };

  return runModule(
    deps,
    window,
    document,
    console,
    (callback) => {
      callback();
      return 1;
    },
    () => {},
    () => {}
  );
}

describe('live tracker opponent stats hydration', () => {
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
    await Promise.resolve();
    await Promise.resolve();

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
