// Regression fixtures promoted from the read-only investigation; original red artifact is preserved in its checkout.
// No Firebase, network, credentials, or production writes. Includes badge master integration.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createOverlayState, reconcileOverlayLiveEvents, replaceOverlayChat,
    formatOverlayChatMessageHtml } from '../../js/live-game-overlay-model.js';
import { createOverlayEventHistory, createOverlayFeedController } from '../../js/live-game-overlay-feed.js';
import * as stateTools from '../../js/live-game-state.js';

const oldSource = readFileSync(new URL('../../js/live-game.js', import.meta.url), 'utf8');
const overlaySource = readFileSync(new URL('../../js/live-game-overlay.js', import.meta.url), 'utf8');

// Extract actual page functions, replacing only their DOM/announcement dependencies.
// Function boundaries are top-level declarations, not a reimplementation of their logic.
function pageFunction(source, name) {
    const sentinel = `function ${name}(`;
    const start = source.indexOf(sentinel);
    if (start < 0 || source.indexOf(sentinel, start + 1) !== -1 ||
        (start > 0 && source[start - 1] !== '\n')) {
        throw new Error(`Missing, duplicate, or non-top-level function ${name}`);
    }
    const end = source.indexOf('\n}', start);
    if (end < start || !/^\r?\n/.test(source.slice(end + 2))) {
        throw new Error(`Missing top-level end for ${name}`);
    }
    const extracted = source.slice(start, end + 2);
    // Fail closed if formatting drift makes the sentinel terminate inside a body.
    const compiled = new Function(`${extracted}\nreturn ${name};`)();
    if (typeof compiled !== 'function' || compiled.name !== name) {
        throw new Error(`Invalid extracted function ${name}`);
    }
    return extracted;
}

function oldViewer() {
    const state = createOverlayState({ game: { liveStatus: 'live' } });
    const noop = () => {};
    const dependencies = {
        state, ...stateTools, ACTIVE_LIVE_EVENTS_LIMIT: 20, els: {},
        getTimestampMs: value => value || 0,
        renderScoreboard: noop, renderStats: noop, renderLineup: noop,
        renderPlayByPlay: noop, announcePlayEvent: noop, showScoreCelebration: noop,
        updateMomentum: noop, showEventCelebration: noop, rerenderPlayFeed: noop, syncViewerClock: noop
    };
    const deliver = new Function(...Object.keys(dependencies), `
        ${pageFunction(oldSource, 'processNewEvents')}
        ${pageFunction(oldSource, 'retainActiveLiveEventWindow')}
        return events => { processNewEvents(events); retainActiveLiveEventWindow(); };
    `)(...Object.values(dependencies));
    return { state, deliver };
}

function overlayViewer() {
    const state = createOverlayState({ game: { liveStatus: 'live' } });
    const history = createOverlayEventHistory();
    return { state, deliver: events => reconcileOverlayLiveEvents(state, history.window(events), stateTools) };
}

const event = n => ({ id: `play-${n}`, type: 'stat', playerId: 'fixture-player',
    statKey: 'pts', value: 1, homeScore: n, awayScore: 0,
    createdAt: 1000 + n, description: `Fixture play ${n}` });
const firstWindow = Array.from({ length: 20 }, (_, i) => event(i + 1));
const nextWindow = [...firstWindow.slice(1), event(21)];

describe.each([['old viewer', oldViewer], ['overlay', overlayViewer]])('%s realtime parity', (_, factory) => {
    it('updates latest play and score independently when the limited window advances', () => {
        const viewer = factory();
        viewer.deliver(firstWindow);
        viewer.deliver(nextWindow);
        const ids = viewer.state.events.map(row => row.id);
        const chronological = nextWindow.map(row => row.id);
        expect(ids).toEqual(factory === overlayViewer ? [...firstWindow, event(21)].reverse().map(row => row.id) : chronological);
        if (factory === overlayViewer) expect(viewer.state.latestEvent.id).toBe('play-21');
        else expect(ids.at(-1)).toBe('play-21');
        expect(viewer.state.homeScore).toBe(21);
        expect(viewer.state.awayScore).toBe(0);
    });

    it('preserves accumulated player totals when an event leaves the query window, not the game', () => {
        const viewer = factory();
        viewer.deliver(firstWindow);
        expect(viewer.state.stats['fixture-player'].pts).toBe(20);
        // Synthetic newest-20 snapshot: play-1 still exists, merely outside the query.
        viewer.deliver(nextWindow);
        expect(viewer.state.stats['fixture-player'].pts).toBe(21);
    });

    it('does not double-count an identical delivery', () => {
        const viewer = factory();
        viewer.deliver(firstWindow);
        viewer.deliver(firstWindow);
        expect(viewer.state.stats['fixture-player'].pts).toBe(20);
    });

    it('honors an explicit reset epoch instead of retaining every prior event', () => {
        const viewer = factory();
        viewer.deliver(firstWindow);
        viewer.deliver([{ id: 'reset-1', type: 'reset', createdAt: 2000,
            homeScore: 0, awayScore: 0 }, { ...event(22), createdAt: 2001, homeScore: 1 }]);
        expect(viewer.state.stats['fixture-player'].pts).toBe(1);
        expect(viewer.state.homeScore).toBe(1);
        expect(viewer.state.events.some(row => row.id === 'play-1')).toBe(false);
    });

    it('documents the shared history gap: joining with 20 records cannot expose record 1 of 21', () => {
        const viewer = factory();
        viewer.deliver(nextWindow);
        expect(viewer.state.events).toHaveLength(20);
        expect(viewer.state.events.some(row => row.id === 'play-1')).toBe(false);
        // Initial join totals cannot be inferred from unseen history, even in the old viewer.
        expect(viewer.state.stats['fixture-player'].pts).toBe(20);
    });
});

function chatSession(surface) {
    const dom = new JSDOM('<ul id="chat"></ul>');
    const document = dom.window.document;
    const container = document.querySelector('#chat');
    const state = createOverlayState({});
    const dependencies = {
        document, state, uiState: { game: state },
        elements: { chatList: container }, els: { chatMessages: container },
        createTextElement: (tag, className, text) => {
            const element = document.createElement(tag);
            element.className = className;
            element.textContent = text;
            return element;
        },
        createSafeImageElement: () => null, resolveSafeProfilePhotoUrl: () => null,
        formatOverlayChatMessageHtml,
        // Plain fixture messages only; formatting parity is covered by the existing suites.
        formatChatMessage: text => text,
        updateChatUnread: () => {}, updateChatBadge: () => {}
    };
    const render = new Function(...Object.keys(dependencies), `
        ${pageFunction(surface === 'overlay' ? overlaySource : oldSource, 'renderChat')}
        return renderChat;
    `)(...Object.values(dependencies));
    return {
        state, container,
        update(rows) {
            if (surface === 'overlay') replaceOverlayChat(state, rows);
            else state.chatMessages = rows;
            render();
            return {
                text: container.textContent,
                ownCount: [...container.querySelectorAll('p')]
                    .filter(row => row.textContent === 'OWN-FIXTURE').length
            };
        },
        close: () => dom.window.close()
    };
}

function chatDom(surface, rows) {
    const session = chatSession(surface);
    try { return session.update(rows); } finally { session.close(); }
}

describe.each(['old viewer', 'overlay'])('%s chat DOM', surface => {
    const older = Array.from({ length: 24 }, (_, i) => ({
        id: `older-${i}`, text: `older ${i}`, createdAt: 1000 + i
    })).reverse();
    it('keeps a pending own message visible with 24 existing messages', () => {
        expect(chatDom(surface, [{ id: 'own', text: 'OWN-FIXTURE', createdAt: null }, ...older]).ownCount).toBe(1);
    });
    it('reconciles pending to acknowledged on the same state and DOM without duplicate echo', () => {
        const session = chatSession(surface);
        const initialState = session.state;
        const initialContainer = session.container;
        try {
            session.update([{ id: 'own', text: 'OWN-FIXTURE', createdAt: null }, ...older]);
            const acknowledged = [{ id: 'own', text: 'OWN-FIXTURE', createdAt: 2000 }, ...older];
            expect(session.update(acknowledged).ownCount).toBe(1);
            expect(session.update(acknowledged).ownCount).toBe(1);
            expect(session.state).toBe(initialState);
            expect(session.container).toBe(initialContainer);
            expect(session.state.chatMessages.filter(row => row.id === 'own')).toHaveLength(1);
        } finally { session.close(); }
    });
});

describe('overlay identity protection and state initialization', () => {
    it('does not grant official AI identity from an arbitrary message ai flag', () => {
        const rendered = chatDom('overlay', [{ id: 'untrusted', senderName: 'Fixture Fan',
            text: 'fixture message', ai: true, createdAt: 2000 }]);
        expect(rendered.text).toContain('Fixture Fan');
        expect(rendered.text).not.toContain('ALL PLAYS');
    });

    it('initializes a separate viewer state without inherited data (not route-switch coverage)', () => {
        const previous = overlayViewer();
        previous.deliver(firstWindow);
        const next = overlayViewer();
        expect(next.state.events).toEqual([]);
        expect(next.state.stats).toEqual({});
        expect(next.state.homeScore).toBe(0);
    });

    // Snapshot absence is ambiguous: rows alone cannot distinguish query-limit
    // eviction from deletion. This is an acceptance constraint, not a behavioral
    // test. SDK/rules emulator and real boot/transport coverage remain unexecuted.

});

function leaderDom(state) {
    const dom = new JSDOM('<ul id="leaders"></ul>');
    const document = dom.window.document;
    const container = document.querySelector('#leaders');
    const dependencies = {
        document, uiState: { game: state }, elements: { leaderList: container },
        createTextElement: (tag, className, text) => {
            const element = document.createElement(tag);
            element.className = className;
            element.textContent = text;
            return element;
        }
    };
    new Function(...Object.keys(dependencies), `
        ${['getStatSummary', 'renderPlayerRow', 'renderLineupList', 'renderLeaders']
            .map(name => pageFunction(overlaySource, name)).join('\n')}
        renderLeaders();
    `)(...Object.values(dependencies));
    const rows = [...container.children].map(row => row.textContent);
    dom.window.close();
    return rows;
}

describe.each([['old viewer', oldViewer], ['overlay', overlayViewer]])('%s totals in real overlay leaderboard DOM', (_, factory) => {
    it('keeps the true leader after their plays leave both 20- and 60-event windows', () => {
        const viewer = factory();
        viewer.state.players = [
            { id: 'early', name: 'Early Leader', number: '1' },
            { id: 'recent', name: 'Recent Player', number: '2' }
        ];
        const all = Array.from({ length: 81 }, (_, index) => ({
            ...event(index + 1), playerId: index < 10 ? 'early' : 'recent',
            value: index < 10 ? 10 : 1,
            homeScore: index < 10 ? (index + 1) * 10 : 100 + index - 9
        }));
        // Every event was observed during this uninterrupted session.
        for (let count = 1; count <= all.length; count += 1) {
            viewer.deliver(all.slice(Math.max(0, count - 20), count));
        }
        expect(viewer.state.homeScore).toBe(171);
        expect(viewer.state.events.some(row => row.id === 'play-81')).toBe(true);
        const rows = leaderDom(viewer.state);
        expect(rows[0]).toContain('Early Leader');
        expect(rows[0]).toContain('100 PTS');
        expect(rows[1]).toContain('71 PTS');
    });
});

describe('overlay terminal listener/auth recovery contract (mock transport, not incident reproduction)', () => {
    it('reattaches failed feeds after an authenticated principal change', () => {
        const callbacks = {};
        const counts = { events: 0, chat: 0 };
        const active = { events: false, chat: false };
        let onAuth;
        const database = Object.fromEntries(['events', 'chat'].map(kind => [
            kind === 'events' ? 'subscribeLiveEvents' : 'subscribeLiveChat',
            (...args) => {
                counts[kind] += 1;
                active[kind] = true;
                callbacks[kind] = { error: args.at(-1), next: args.at(-2) };
                return () => { active[kind] = false; };
            }
        ]));
        const controller = createOverlayFeedController({
            subscribeEvents: (next, error) => database.subscribeLiveEvents('fixture-team', 'fixture-game', next, error),
            subscribeChat: (next, error) => database.subscribeLiveChat('fixture-team', 'fixture-game', {}, next, error),
            loadHistory: async () => [], onEvents: () => {}, onChat: () => {},
            onError: () => {}, onReady: () => {}, onInvalidate: () => {},
            schedule: () => 0, unschedule: () => {}
        });
        onAuth = uid => controller.authChanged(uid.uid);
        onAuth({ uid: 'fixture-before' });
        expect(counts).toEqual({ events: 1, chat: 1 });
        onAuth({ uid: 'fixture-before' });
        expect(counts).toEqual({ events: 1, chat: 1 });
        // Deliberately model terminal errors; this does not assert why Firebase
        // rejected any actual game, nor that ordinary transient reconnect needs this.
        for (const kind of ['events', 'chat']) {
            active[kind] = false;
            callbacks[kind].error(Object.assign(new Error('fixture denial'), { code: 'permission-denied' }));
        }
        onAuth({ uid: 'fixture-after' });
        expect(active).toEqual({ events: true, chat: true });
        expect(counts).toEqual({ events: 2, chat: 2 });
        controller.stop();
    });
});

it('preserves badge away-game orientation and clock anchors through retained history and deletion refresh', () => {
    const epoch = 1800000000000;
    const state = createOverlayState({ team: { name: 'Managed', photoUrl: 'managed.png' }, game: {
        isHome: false, scoreOrientation: 'venue', opponent: 'Opponent', opponentTeamPhoto: 'opponent.png',
        liveStatus: 'live', homeScore: 3, awayScore: 7, liveClockMs: 0,
        liveClockRunning: true, liveClockUpdatedAt: epoch
    } });
    const history = createOverlayEventHistory();
    const start = { id: 'badge-start', type: 'clock_start', source: 'badge-score-controller',
        homeScore: 3, awayScore: 7, gameClockMs: 0, createdAt: epoch };
    const early = { id: 'early-stat', type: 'stat', playerId: 'leader', statKey: 'pts', value: 10,
        scoreOrientation: 'venue', homeScore: 3, awayScore: 7, createdAt: epoch + 1 };
    const notes = Array.from({ length: 21 }, (_, i) => ({ id: `note-${i}`, type: 'note', createdAt: epoch + i + 2 }));
    const rows = [start, early, ...notes];
    for (let n = 1; n <= rows.length; n++) {
        reconcileOverlayLiveEvents(state, history.window(rows.slice(Math.max(0, n - 20), n)), stateTools);
    }
    expect([state.homeName, state.awayName]).toEqual(['Opponent', 'Managed']);
    expect([state.homePhoto, state.awayPhoto]).toEqual(['opponent.png', 'managed.png']);
    expect([state.homeScore, state.awayScore]).toEqual([3, 7]);
    expect(state.clockSnapshotAt).toBe(epoch);
    expect(state.clockRunning).toBe(true);
    expect(state.stats.leader.pts).toBe(10);
    const pause = { id: 'badge-pause', type: 'clock_pause', source: 'badge-score-controller',
        homeScore: 4, awayScore: 9, gameClockMs: 600000, createdAt: epoch + 600000 };
    reconcileOverlayLiveEvents(state, history.window([...notes.slice(-19), pause]), stateTools);
    expect([state.homeScore, state.awayScore]).toEqual([4, 9]);
    expect(state.gameClockMs).toBe(600000);
    expect(state.clockSnapshotAt).toBe(epoch + 600000);
    expect(state.clockRunning).toBe(false);
    reconcileOverlayLiveEvents(state, history.replace([start, ...notes, pause], history.revision), stateTools);
    expect(state.stats.leader?.pts || 0).toBe(0);
    expect([state.homeScore, state.awayScore, state.gameClockMs, state.clockRunning]).toEqual([4, 9, 600000, false]);
});
