import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    readPersistedLiveTrackerPendingFinish,
    readPersistedLiveTrackerQueue,
    writePersistedLiveTrackerPendingFinish,
    writePersistedLiveTrackerQueue
} from '../../js/live-tracker-queue.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

class MockClassList {
    add() {}
    remove() {}
    toggle() {
        return false;
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
        this.textContent = '';
        this.innerHTML = '';
    }

    addEventListener(type, handler) {
        const handlers = this.listeners.get(type) || [];
        handlers.push(handler);
        this.listeners.set(type, handlers);
    }

    querySelector() {
        return null;
    }

    querySelectorAll() {
        return [];
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
            querySelectorAll(selector) {
                if (selector === '.period-btn') return [];
                return [];
            },
            getElementById(id) {
                return ensureElement(id);
            }
        }
    };
}

function createStorage() {
    const state = {};
    return {
        state,
        getItem: vi.fn((key) => state[key] ?? null),
        setItem: vi.fn((key, value) => {
            state[key] = String(value);
        }),
        removeItem: vi.fn((key) => {
            delete state[key];
        })
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
    rewritten = replaceNamedImportByModulePath(rewritten, './utils.js', 'const { getUrlParams, escapeHtml } = deps.utils;');
    rewritten = replaceNamedImportByModulePath(rewritten, './auth.js', 'const { checkAuth } = deps.auth;');
    rewritten = replaceImport(
        rewritten,
        /import\s*\{(?=[\s\S]*\bwriteBatch\b)(?=[\s\S]*\bonSnapshot\b)[\s\S]*?\}\s*from\s*['"]\.\/firebase\.js(?:\?v=[^'"]+)?['"];?\s*/,
        ''
    );
    rewritten = replaceNamedImportByModulePath(rewritten, './vendor/firebase-ai.js', 'const { getAI, getGenerativeModel, GoogleAIBackend } = deps.firebaseAi;');
    rewritten = replaceNamedImportByModulePath(rewritten, './vendor/firebase-app.js', 'const { getApp } = deps.firebaseApp;');
    rewritten = replaceNamedImportByModulePath(rewritten, './live-tracker-notes.js', 'const { isVoiceRecognitionSupported, normalizeGameNoteText, appendGameSummaryLine, buildGameNoteLogText } = deps.liveTrackerNotes;');
    rewritten = replaceNamedImportByModulePath(rewritten, './live-tracker-integrity.js', 'const { canApplySubstitution, applySubstitution } = deps.liveTrackerIntegrity;');
    rewritten = replaceNamedImportByModulePath(rewritten, './live-tracker-opponent-stats.js', 'const { hydrateOpponentStats } = deps.liveTrackerOpponentStats;');
    rewritten = replaceNamedImportByModulePath(rewritten, './live-tracker-resume.js', 'const { buildPersistedResumeClockState, deriveResumeClockState } = deps.liveTrackerResume;');
    rewritten = replaceNamedImportByModulePath(rewritten, './live-tracker-lineup.js', 'const { restoreLiveLineup } = deps.liveTrackerLineup;');
    rewritten = replaceNamedImportByModulePath(rewritten, './live-tracker-email.js', 'const { resolveFinalScore } = deps.liveTrackerEmail;');
    rewritten = replaceNamedImportByModulePath(rewritten, './live-tracker-reset.js', 'const { buildLiveResetEvent } = deps.liveTrackerReset;');
    rewritten = replaceNamedImportByModulePath(rewritten, './live-tracker-chat-unread.js', 'const { advanceLiveChatUnreadState } = deps.liveTrackerChatUnread;');
    rewritten = replaceNamedImportByModulePath(rewritten, './live-game-state.js', 'const { resolveLiveStatConfig, resolveLiveStatColumns } = deps.liveGameState;');
    rewritten = replaceNamedImportByModulePath(rewritten, './live-sport-config.js', 'const { getDefaultLivePeriod, getSportPeriodLabels } = deps.liveSportConfig;');
    rewritten = replaceNamedImportByModulePath(rewritten, './live-tracker-finish.js', 'const { buildOpponentStatsSnapshotFromEntries } = deps.liveTrackerFinish;');
    rewritten = replaceNamedImportByModulePath(rewritten, './live-tracker-queue.js', 'const { readPersistedLiveTrackerQueue, writePersistedLiveTrackerQueue, readPersistedLiveTrackerPendingFinish, writePersistedLiveTrackerPendingFinish } = deps.liveTrackerQueue;');
    rewritten = replaceNamedImportByModulePath(rewritten, './live-tracker-save-complete.js', 'const { commitFinishPlan, runSaveAndCompleteWorkflow } = deps.liveTrackerSaveComplete;');

    return rewritten
        .replace(authHook, '')
        .concat(`
return {
  liveState,
  scheduleRetry,
  retryPendingFinalizationNow,
  persistPendingEventQueue,
  persistPendingFinalization,
  broadcastEvent,
  setContext(context = {}) {
    currentTeamId = context.teamId || null;
    currentGameId = context.gameId || null;
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

async function bootHarness({ broadcastImpl, commitImpl = async () => {}, setGameLiveStatusImpl = async () => {}, randomUUID = vi.fn() }) {
    const { document } = createEnvironment();
    const storage = createStorage();
    const scheduledTimeouts = new Map();
    let nextTimeoutId = 1;
    const deps = {
        db: {
            getTeam: async () => ({}),
            getTeams: async () => [],
            getGame: async () => ({}),
            getPlayers: async () => [],
            getConfigs: async () => [],
            updateGame: async () => {},
            collection: () => ({}),
            getDocs: async () => ({ docs: [], size: 0, forEach() {} }),
            deleteDoc: async () => {},
            query: (value) => value,
            broadcastLiveEvent: broadcastImpl,
            subscribeLiveChat: () => () => {},
            postLiveChatMessage: async () => {},
            setGameLiveStatus: setGameLiveStatusImpl
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
            hydrateOpponentStats: () => ({ fouls: 0, time: 0 })
        },
        liveTrackerResume: {
            buildPersistedResumeClockState: () => ({}),
            deriveResumeClockState: () => ({ restored: false, period: 'Q1', clock: 0 })
        },
        liveTrackerLineup: {
            restoreLiveLineup: () => ({ onCourt: [], bench: [] })
        },
        liveTrackerEmail: {
            resolveFinalScore: (value) => Number(value || 0)
        },
        liveTrackerReset: {
            buildLiveResetEvent: () => ({})
        },
        liveTrackerChatUnread: {
            advanceLiveChatUnreadState: (state) => state
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
            buildOpponentStatsSnapshotFromEntries: () => ({})
        },
        liveTrackerQueue: {
            readPersistedLiveTrackerQueue,
            writePersistedLiveTrackerQueue,
            readPersistedLiveTrackerPendingFinish,
            writePersistedLiveTrackerPendingFinish
        },
        liveTrackerSaveComplete: {
            commitFinishPlan: commitImpl,
            runSaveAndCompleteWorkflow: async () => ({})
        }
    };
    const window = {
        location: { href: '' },
        localStorage: storage,
        crypto: { randomUUID },
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
    const flushOneTimer = async () => {
        const nextEntry = scheduledTimeouts.entries().next();
        if (nextEntry.done) return false;
        const [timeoutId, callback] = nextEntry.value;
        scheduledTimeouts.delete(timeoutId);
        await callback();
        await Promise.resolve();
        return true;
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
        storage,
        flushOneTimer
    };
}

describe('live tracker retry queue persistence', () => {
    it('queues failed live events with stable client event IDs', async () => {
        const randomUUID = vi.fn(() => 'event-1');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const attempts = [];
        const page = await bootHarness({
            randomUUID,
            broadcastImpl: async (_teamId, _gameId, event) => {
                attempts.push(event);
                throw new Error('offline');
            }
        });

        page.setContext({ teamId: 'team-1', gameId: 'game-9' });
        await page.broadcastEvent({ type: 'stat', statKey: 'pts', value: 2 });

        const queuedEvent = {
            type: 'stat',
            statKey: 'pts',
            value: 2,
            eventId: 'live-event-1'
        };
        expect(attempts).toEqual([queuedEvent]);
        expect(page.liveState.eventQueue).toEqual([queuedEvent]);
        expect(readPersistedLiveTrackerQueue(page.storage, 'team-1', 'game-9')).toEqual([queuedEvent]);
        errorSpy.mockRestore();
    });

    it('keeps remaining pending events persisted until each replay succeeds', async () => {
        const firstEvent = { type: 'stat', statKey: 'pts', value: 2 };
        const secondEvent = { type: 'lineup', onCourt: ['p1', 'p2', 'p3', 'p4', 'p5'] };
        const randomUUID = vi.fn()
            .mockReturnValueOnce('event-1')
            .mockReturnValueOnce('event-2');
        const attempts = [];
        let secondEventAttempt = 0;

        const page = await bootHarness({
            randomUUID,
            broadcastImpl: async (_teamId, _gameId, event) => {
                attempts.push(event);
                if (event.type === 'lineup' && secondEventAttempt++ === 0) {
                    throw new Error('temporary network failure');
                }
            }
        });

        page.setContext({ teamId: 'team-1', gameId: 'game-9' });
        page.liveState.eventQueue = [firstEvent, secondEvent];
        page.persistPendingEventQueue();

        page.scheduleRetry({ resetBackoff: true });
        await page.flushOneTimer();

        const queuedSecondEvent = {
            ...secondEvent,
            eventId: 'live-event-2'
        };
        expect(attempts).toEqual([
            { ...firstEvent, eventId: 'live-event-1' },
            queuedSecondEvent
        ]);
        expect(page.liveState.eventQueue).toEqual([queuedSecondEvent]);
        expect(readPersistedLiveTrackerQueue(page.storage, 'team-1', 'game-9')).toEqual([queuedSecondEvent]);

        await page.flushOneTimer();

        expect(attempts).toEqual([
            { ...firstEvent, eventId: 'live-event-1' },
            queuedSecondEvent,
            queuedSecondEvent
        ]);
        expect(randomUUID).toHaveBeenCalledTimes(2);
        expect(page.liveState.eventQueue).toEqual([]);
        expect(readPersistedLiveTrackerQueue(page.storage, 'team-1', 'game-9')).toEqual([]);
    });

    it('drains queued scoring events before replaying a pending finalization', async () => {
        const operations = [];
        const pendingFinish = {
            version: 1,
            queuedAt: 123,
            finishPlan: {
                finalHome: 9,
                finalAway: 7,
                eventWrites: [],
                aggregatedStatsWrites: [],
                gameUpdate: { homeScore: 9, awayScore: 7, status: 'completed' }
            }
        };
        const page = await bootHarness({
            randomUUID: vi.fn(() => 'event-1'),
            broadcastImpl: async (_teamId, _gameId, event) => {
                operations.push({ type: 'live-event', event });
            },
            commitImpl: async ({ finishPlan }) => {
                operations.push({ type: 'finalization', finishPlan });
            },
            setGameLiveStatusImpl: async (_teamId, _gameId, status) => {
                operations.push({ type: 'live-status', status });
            }
        });

        page.setContext({ teamId: 'team-1', gameId: 'game-9' });
        page.liveState.eventQueue = [{ type: 'stat', statKey: 'pts', value: 2 }];
        page.persistPendingEventQueue();
        page.liveState.pendingFinish = pendingFinish;
        page.persistPendingFinalization();

        await page.retryPendingFinalizationNow({ resetBackoff: true });

        expect(operations).toEqual([
            {
                type: 'live-event',
                event: { type: 'stat', statKey: 'pts', value: 2, eventId: 'live-event-1' }
            },
            {
                type: 'finalization',
                finishPlan: pendingFinish.finishPlan
            },
            {
                type: 'live-status',
                status: 'completed'
            }
        ]);
        expect(page.liveState.eventQueue).toEqual([]);
        expect(page.liveState.pendingFinish).toBeNull();
        expect(readPersistedLiveTrackerQueue(page.storage, 'team-1', 'game-9')).toEqual([]);
        expect(readPersistedLiveTrackerPendingFinish(page.storage, 'team-1', 'game-9')).toBeNull();
    });

    it('keeps a failed pending finalization visible and retryable', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const pendingFinish = {
            version: 1,
            queuedAt: 123,
            finishPlan: {
                finalHome: 9,
                finalAway: 7,
                eventWrites: [],
                aggregatedStatsWrites: [],
                gameUpdate: { homeScore: 9, awayScore: 7, status: 'completed' }
            }
        };
        const page = await bootHarness({
            broadcastImpl: async () => {},
            commitImpl: async () => {
                throw new Error('still offline');
            }
        });

        page.setContext({ teamId: 'team-1', gameId: 'game-9' });
        page.liveState.pendingFinish = pendingFinish;
        page.persistPendingFinalization();

        await page.retryPendingFinalizationNow({ resetBackoff: true });

        expect(page.liveState.pendingFinish).toMatchObject({
            ...pendingFinish,
            lastError: 'still offline'
        });
        expect(page.liveState.finishRetryAttempt).toBe(1);
        expect(page.liveState.finishRetryTimeout).not.toBeNull();
        expect(readPersistedLiveTrackerPendingFinish(page.storage, 'team-1', 'game-9')).toMatchObject({
            ...pendingFinish,
            lastError: 'still offline'
        });
        warnSpy.mockRestore();
    });
});
