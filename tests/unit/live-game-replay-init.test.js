import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isViewerChatEnabled } from '../../js/live-game-chat.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

class MockClassList {
    constructor(initial = []) {
        this.tokens = new Set(initial);
    }

    add(...tokens) {
        tokens.forEach((token) => this.tokens.add(token));
    }

    remove(...tokens) {
        tokens.forEach((token) => this.tokens.delete(token));
    }

    contains(token) {
        return this.tokens.has(token);
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
}

class MockElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.dataset = {};
        this.style = {};
        this.attributes = new Map();
        this.listeners = new Map();
        this.classList = new MockClassList(id === 'chat-locked-notice' || id === 'replay-controls' || id === 'ended-overlay' ? ['hidden'] : []);
        this.textContent = '';
        this._innerHTML = '';
        this.value = '';
        this.disabled = false;
        this.href = '';
        this.src = '';
        this.currentSrc = '';
        this.currentTime = 0;
        this.duration = Number.NaN;
        this.paused = true;
        this.scrollTop = 0;
    }

    addEventListener(type, handler) {
        const handlers = this.listeners.get(type) || [];
        handlers.push(handler);
        this.listeners.set(type, handlers);
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        this.children = this.children.filter((candidate) => candidate !== child);
        child.parentNode = null;
        return child;
    }

    insertBefore(child, before) {
        child.parentNode = this;
        if (!before) {
            this.children.push(child);
            return child;
        }
        const index = this.children.indexOf(before);
        if (index === -1) {
            this.children.push(child);
            return child;
        }
        this.children.splice(index, 0, child);
        return child;
    }

    remove() {
        if (this.parentNode) {
            this.parentNode.removeChild(this);
        }
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name === 'disabled') {
            this.disabled = true;
        }
        if (name === 'href') {
            this.href = String(value);
        }
        if (name === 'src') {
            this.src = String(value);
            this.currentSrc = String(value);
        }
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    removeAttribute(name) {
        this.attributes.delete(name);
        if (name === 'disabled') {
            this.disabled = false;
        }
        if (name === 'href') {
            this.href = '';
        }
        if (name === 'src') {
            this.src = '';
            this.currentSrc = '';
        }
    }

    querySelector(selector) {
        if (selector === '[data-placeholder="plays"]') {
            return this.children.find((child) => child.dataset.placeholder === 'plays') || null;
        }
        return null;
    }

    querySelectorAll() {
        return [];
    }

    focus() {}

    setSelectionRange() {}

    play() {
        this.paused = false;
        return Promise.resolve();
    }

    pause() {
        this.paused = true;
    }

    load() {}

    set innerHTML(value) {
        this._innerHTML = String(value);
        this.textContent = this._innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        this.children = [];
        if (this._innerHTML.includes('data-placeholder="plays"')) {
            const placeholder = new MockElement('', 'div');
            placeholder.dataset.placeholder = 'plays';
            this.appendChild(placeholder);
        }
    }

    get innerHTML() {
        return this._innerHTML;
    }
}

function createEnvironment() {
    const elements = new Map();

    const document = {
        body: new MockElement('body', 'body'),
        createElement(tagName) {
            return new MockElement('', tagName);
        },
        addEventListener() {},
        removeEventListener() {},
        getElementById(id) {
            return ensureElement(id);
        },
        querySelector(selector) {
            if (selector.startsWith('#')) {
                return ensureElement(selector.slice(1));
            }
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '#mobile-tabs [data-tab]') {
                return [];
            }
            return [];
        }
    };

    function ensureElement(id) {
        if (!elements.has(id)) {
            elements.set(id, new MockElement(id));
        }
        return elements.get(id);
    }

    return { document, elements, ensureElement };
}

function buildModuleSource() {
    return readFileSync(new URL('../../js/live-game.js', import.meta.url), 'utf8')
        .replace(
            "import {\n  getTeam,\n  getGame,\n  getPlayers,\n  subscribeLiveEvents,\n  subscribeLiveChat,\n  postLiveChatMessage,\n  subscribeReactions,\n  sendReaction,\n  trackViewerPresence,\n  getLiveEvents,\n  getLiveChatHistory,\n  getLiveReactions,\n  getConfigs,\n  subscribeGame,\n  updateGame\n} from './db.js?v=15';",
            'const { getTeam, getGame, getPlayers, subscribeLiveEvents, subscribeLiveChat, postLiveChatMessage, subscribeReactions, sendReaction, trackViewerPresence, getLiveEvents, getLiveChatHistory, getLiveReactions, getConfigs, subscribeGame, updateGame } = deps.db;'
        )
        .replace(
            "import { getUrlParams, escapeHtml, renderHeader, renderFooter, formatShortDate, formatTime, shareOrCopy } from './utils.js?v=9';",
            'const { getUrlParams, escapeHtml, renderHeader, renderFooter, formatShortDate, formatTime, shareOrCopy } = deps.utils;'
        )
        .replace(
            "import { computePanelVisibility } from './live-stream-utils.js?v=1';",
            'const { computePanelVisibility } = deps.liveStreamUtils;'
        )
        .replace(
            "import { checkAuth } from './auth.js?v=10';",
            'const { checkAuth } = deps.auth;'
        )
        .replace(
            "import { isViewerChatEnabled } from './live-game-chat.js?v=1';",
            'const { isViewerChatEnabled } = deps.liveGameChat;'
        )
        .replace(
            "import { getReplayElapsedMs, getReplayStartTimeAfterSpeedChange } from './live-game-replay.js?v=2';",
            'const { getReplayElapsedMs, getReplayStartTimeAfterSpeedChange } = deps.liveGameReplay;'
        )
        .replace(
            "import { MAX_HIGHLIGHT_CLIP_MS, buildHighlightShareUrl, createHighlightClipDraft, resolveReplayVideoOptions, shouldReloadVideoPlayback } from './live-game-video.js?v=2';",
            'const { MAX_HIGHLIGHT_CLIP_MS, buildHighlightShareUrl, createHighlightClipDraft, resolveReplayVideoOptions, shouldReloadVideoPlayback } = deps.liveGameVideo;'
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
            "import { resolveOpponentDisplayName, normalizeLiveStatColumns, resolveLiveStatColumns, renderViewerLineupSections, applyResetEventState, shouldResetViewerFromGameDoc, isLiveEventVisibleForResetBoundary } from './live-game-state.js?v=4';",
            'const { resolveOpponentDisplayName, normalizeLiveStatColumns, resolveLiveStatColumns, renderViewerLineupSections, applyResetEventState, shouldResetViewerFromGameDoc, isLiveEventVisibleForResetBoundary } = deps.liveGameState;'
        )
        .replace(
            "import { getDefaultLivePeriod } from './live-sport-config.js?v=1';",
            'const { getDefaultLivePeriod } = deps.liveSportConfig;'
        )
        .replace(
            "init().catch(error => {\n  console.error('Live game init failed:', error);\n  const feed = document.querySelector('#plays-feed');\n  if (feed) feed.innerHTML = '<div class=\"text-sand/60 text-center py-6\">Something went wrong loading the game. Try refreshing the page.</div>';\n});",
            "const __initPromise = init().catch(error => {\n  console.error('Live game init failed:', error);\n  const feed = document.querySelector('#plays-feed');\n  if (feed) feed.innerHTML = '<div class=\"text-sand/60 text-center py-6\">Something went wrong loading the game. Try refreshing the page.</div>';\n});\nreturn { state, els, initPromise: __initPromise };"
        );
}

const moduleSource = buildModuleSource();
const runModule = new AsyncFunction(
    'deps',
    'window',
    'document',
    'sessionStorage',
    'localStorage',
    'navigator',
    'URL',
    'URLSearchParams',
    'console',
    'setTimeout',
    'clearTimeout',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    moduleSource
);

async function bootReplayPage({ replayEvents }) {
    const { document, ensureElement } = createEnvironment();
    const storage = new Map();
    const sessionStorage = {
        getItem(key) {
            return storage.has(key) ? storage.get(key) : null;
        },
        setItem(key, value) {
            storage.set(key, String(value));
        }
    };
    const location = new URL('https://allplays.example/live-game.html?teamId=T1&gameId=G1&replay=true');
    const window = {
        document,
        location,
        history: { replaceState() {} },
        navigator: { share: undefined, clipboard: { writeText: async () => {} } },
        matchMedia() {
            return {
                matches: false,
                addEventListener() {},
                removeEventListener() {}
            };
        },
        addEventListener() {},
        removeEventListener() {}
    };
    const game = {
        id: 'G1',
        date: '2026-03-21',
        liveStatus: 'completed',
        homeScore: 63,
        awayScore: 58,
        period: 'Final',
        recordedVideo: null,
        streamUrl: '',
        sport: 'basketball'
    };
    const deps = {
        db: {
            getTeam: async () => ({ id: 'T1', name: 'Raptors', sport: 'basketball' }),
            getGame: async () => game,
            getPlayers: async () => [],
            subscribeLiveEvents: () => () => {},
            subscribeLiveChat: () => () => {},
            postLiveChatMessage: async () => {},
            subscribeReactions: () => () => {},
            sendReaction: async () => {},
            trackViewerPresence: () => () => {},
            getLiveEvents: async () => replayEvents,
            getLiveChatHistory: async () => [],
            getLiveReactions: async () => [],
            getConfigs: async () => [],
            subscribeGame: () => () => {},
            updateGame: async () => {}
        },
        utils: {
            getUrlParams: () => ({ teamId: 'T1', gameId: 'G1', replay: 'true' }),
            escapeHtml: (value) => String(value ?? ''),
            renderHeader() {},
            renderFooter() {},
            formatShortDate: () => 'Mar 21',
            formatTime: () => '8:25 PM',
            shareOrCopy: async () => ({ status: 'copied' })
        },
        liveStreamUtils: {
            computePanelVisibility: () => ({
                showVideoPanel: false,
                showVideoTab: false,
                showExternalLink: false
            })
        },
        auth: {
            checkAuth(callback) {
                callback(null);
            }
        },
        liveGameChat: { isViewerChatEnabled },
        liveGameReplay: {
            buildReplaySessionState: ({ teamId, gameId, game = {}, defaultPeriod = 'Q1', replayEvents = [], replayChat = [], replayReactions = [] } = {}) => ({
                hasReplayEvents: replayEvents.length > 0,
                showReplayControls: true,
                hideReactionsBar: true,
                hideEndedOverlay: true,
                replayGameHref: `game.html#teamId=${teamId}&gameId=${gameId}`,
                emptyStateMessage: 'No play-by-play data available for this game.',
                scoreboard: {
                    homeScore: replayEvents.length ? 0 : (game.homeScore ?? 0),
                    awayScore: replayEvents.length ? 0 : (game.awayScore ?? 0),
                    period: replayEvents.length ? defaultPeriod : (game.period || defaultPeriod),
                    gameClockMs: 0
                },
                replayEvents: [...replayEvents].sort((a, b) => (a?.gameClockMs || 0) - (b?.gameClockMs || 0)),
                replayChat: [...replayChat],
                replayReactions: [...replayReactions],
                replayStartAt: 0
            }),
            collectReplayEventWindow: ({ replayEvents = [], replayIndex = 0, elapsedMs = 0 } = {}) => {
                const events = [];
                let nextReplayIndex = replayIndex;
                while (nextReplayIndex < replayEvents.length && (replayEvents[nextReplayIndex]?.gameClockMs || 0) <= elapsedMs) {
                    events.push(replayEvents[nextReplayIndex]);
                    nextReplayIndex += 1;
                }
                return { events, nextReplayIndex };
            },
            collectReplayStreamWindow: ({ replayChat = [], replayReactions = [], replayChatIndex = 0, replayReactionIndex = 0, replayStartAt = 0 } = {}, elapsedMs = 0) => {
                const replayTime = replayStartAt + elapsedMs;
                const chatMessages = [];
                let nextReplayChatIndex = replayChatIndex;
                while (nextReplayChatIndex < replayChat.length) {
                    const message = replayChat[nextReplayChatIndex];
                    const timestamp = message?.createdAt?.toMillis?.() ?? message?.createdAt ?? null;
                    if (timestamp != null && timestamp > replayTime) break;
                    chatMessages.push(message);
                    nextReplayChatIndex += 1;
                }

                const reactions = [];
                let nextReplayReactionIndex = replayReactionIndex;
                while (nextReplayReactionIndex < replayReactions.length) {
                    const reaction = replayReactions[nextReplayReactionIndex];
                    const timestamp = reaction?.createdAt?.toMillis?.() ?? reaction?.createdAt ?? null;
                    if (timestamp != null && timestamp > replayTime) break;
                    reactions.push(reaction);
                    nextReplayReactionIndex += 1;
                }

                return { chatMessages, nextReplayChatIndex, reactions, nextReplayReactionIndex };
            },
            getReplayElapsedMs: () => 0,
            getReplayStartTimeAfterSpeedChange: () => 0,
            getReplayTimestampMs: (value) => value?.toMillis?.() ?? value ?? null
        },
        liveGameVideo: {
            MAX_HIGHLIGHT_CLIP_MS: 60000,
            buildHighlightShareUrl: () => '',
            createHighlightClipDraft: () => ({ startMs: 0, endMs: 0, title: '' }),
            resolveReplayVideoOptions: () => null,
            shouldReloadVideoPlayback: () => false
        },
        firebaseAi: {
            getAI: () => ({}),
            getGenerativeModel: () => ({ generateContent: async () => ({ response: { text: () => '' } }) }),
            GoogleAIBackend: {}
        },
        firebaseApp: { getApp: () => ({}) },
        liveGameState: {
            resolveOpponentDisplayName: () => 'Opponent',
            normalizeLiveStatColumns: (columns) => columns || [],
            resolveLiveStatColumns: () => [],
            renderViewerLineupSections: () => ({
                onCourtIds: [],
                benchIds: [],
                onCourtHtml: '',
                benchHtml: ''
            }),
            applyResetEventState() {},
            shouldResetViewerFromGameDoc: () => false,
            isLiveEventVisibleForResetBoundary: () => true
        },
        liveSportConfig: {
            getDefaultLivePeriod: () => 'Final'
        }
    };

    const moduleInstance = await runModule(
        deps,
        window,
        document,
        sessionStorage,
        sessionStorage,
        window.navigator,
        URL,
        URLSearchParams,
        console,
        setTimeout,
        clearTimeout,
        () => 1,
        () => {}
    );
    await moduleInstance.initPromise;

    return {
        finalScore: ensureElement('final-score'),
        homeScore: ensureElement('home-score'),
        awayScore: ensureElement('away-score'),
        chatInput: ensureElement('chat-input'),
        chatLockedNotice: ensureElement('chat-locked-notice'),
        replayControls: ensureElement('replay-controls')
    };
}

describe('live game replay initialization', () => {
    it('locks chat for replay pages with no saved events', async () => {
        const page = await bootReplayPage({ replayEvents: [] });

        expect(page.homeScore.textContent).toBe(63);
        expect(page.awayScore.textContent).toBe(58);
        expect(page.chatInput.disabled).toBe(true);
        expect(page.chatLockedNotice.classList.contains('hidden')).toBe(false);
        expect(page.replayControls.classList.contains('hidden')).toBe(false);
    });

    it('applies the same replay chat lockout whether replay events exist or not', async () => {
        const emptyReplayPage = await bootReplayPage({ replayEvents: [] });
        const populatedReplayPage = await bootReplayPage({
            replayEvents: [
                {
                    id: 'event-1',
                    type: 'stat',
                    statKey: 'pts',
                    value: 2,
                    period: 'Q1',
                    gameClockMs: 1000,
                    description: 'Basket',
                    createdAt: { toMillis: () => 1000 }
                }
            ]
        });

        expect(emptyReplayPage.chatInput.disabled).toBe(true);
        expect(populatedReplayPage.chatInput.disabled).toBe(true);
        expect(emptyReplayPage.chatLockedNotice.classList.contains('hidden')).toBe(false);
        expect(populatedReplayPage.chatLockedNotice.classList.contains('hidden')).toBe(false);
    });
});
