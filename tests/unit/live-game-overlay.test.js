import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { completeAuthNavigation } from '../../apps/app/src/lib/authNextRoute.ts';

const html = readFileSync(new URL('../../live-game-overlay.html', import.meta.url), 'utf8');
const redirect = readFileSync(new URL('../../live-game-overlay-poc.html', import.meta.url), 'utf8');
const currentLiveGame = readFileSync(new URL('../../live-game.html', import.meta.url), 'utf8');
const currentLiveGameSource = readFileSync(new URL('../../js/live-game.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../../js/live-game-overlay.js', import.meta.url), 'utf8');
const modelSource = readFileSync(new URL('../../js/live-game-overlay-model.js', import.meta.url), 'utf8');
const videoSource = readFileSync(new URL('../../js/live-game-video.js', import.meta.url), 'utf8');
const chatSource = readFileSync(new URL('../../js/live-game-chat.js', import.meta.url), 'utf8');
const liveStateSource = readFileSync(new URL('../../js/live-game-state.js', import.meta.url), 'utf8');
const trackerSource = readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');
const legacyTrackerSource = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');
const appTrackerSource = readFileSync(new URL('../../apps/app/src/lib/scheduleService.ts', import.meta.url), 'utf8');

function extractFunction(sourceText, name) {
    const start = sourceText.indexOf(`function ${name}(`);
    const signatureEnd = sourceText.indexOf('\n', start);
    const bodyStart = sourceText.lastIndexOf('{', signatureEnd);
    let depth = 0;

    for (let index = bodyStart; index < sourceText.length; index += 1) {
        if (sourceText[index] === '{') depth += 1;
        if (sourceText[index] === '}') depth -= 1;
        if (depth === 0) return sourceText.slice(start, index + 1);
    }

    throw new Error(`Unable to extract ${name}`);
}

function processLiveEventSnapshots(snapshots) {
    const processNewEventsSource = extractFunction(currentLiveGameSource, 'processNewEvents');
    const retainActiveLiveEventWindowSource = extractFunction(currentLiveGameSource, 'retainActiveLiveEventWindow');
    const runSnapshots = new Function('collectVisibleLiveEventsSequentially', 'applyViewerEventToState', `
        return (snapshots) => {
            const state = { events: [], eventIds: new Set(), lastResetAt: 0 };
            const ACTIVE_LIVE_EVENTS_LIMIT = 20;
            const rerenderPlayFeed = () => {};
            const syncViewerClock = () => {};
            ${processNewEventsSource}
            ${retainActiveLiveEventWindowSource}
            snapshots.forEach((events) => {
                processNewEvents(events);
                retainActiveLiveEventWindow();
            });
            return state.events;
        };
    `)(
        (events, { seenIds }) => events.filter((event) => !seenIds.has(event.id)),
        (state, event) => ({
            state: { ...state, events: [...state.events, event] },
            shouldRenderLineup: false,
            shouldRenderScoreboard: false,
            shouldRenderPlayByPlay: false,
            shouldRenderStats: false,
            shouldCelebrateScore: false,
            shouldCelebrateEvent: false
        })
    );

    return runSnapshots(snapshots);
}

describe('live game overlay page', () => {
    it.each([
        [{ uid: 'viewer-1', displayName: 'Alexandra Long Account Name' }, 'Old nickname', 'Alexandra Long Account Name'],
        [{ uid: 'viewer-2', displayName: 'Taylor Account' }, 'Old nickname', 'Taylor Account'],
        [{ uid: 'viewer-3' }, 'Other account nickname', 'Fan'],
        [{ uid: 'viewer-4', displayName: 'ALL PLAYS' }, 'Old nickname', 'Fan'],
        [null, 'Guest Riley', 'Guest Riley']
    ])('uses the current account identity before guest names (%j)', (chatUser, anonName, expected) => {
        const resolveName = new Function('uiState', `
            ${extractFunction(source, 'isReservedChatDisplayName')}
            ${extractFunction(source, 'getChatSenderName')}
            return getChatSenderName();
        `);
        expect(resolveName({ chatUser, anonName })).toBe(expected);
    });

    it('keeps exactly the newest 20 events from overlapping live snapshots in chronological order', () => {
        const events = Array.from({ length: 25 }, (_, index) => ({
            id: `event-${index + 1}`,
            type: 'stat',
            createdAt: index + 1
        }));

        const retainedEvents = processLiveEventSnapshots([
            events.slice(0, 20),
            events.slice(5, 25)
        ]);

        expect(retainedEvents).toHaveLength(20);
        expect(retainedEvents.map((event) => event.id)).toEqual(
            events.slice(5, 25).map((event) => event.id)
        );
        expect(currentLiveGameSource).toContain('getLiveEvents(state.teamId, state.gameId)');
    });

    it('ships as a separate no-index broadcast canvas with accessible overlay regions', () => {
        expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
        expect(html).toContain('id="broadcast-stage"');
        expect(html).toContain('id="overlay-video"');
        expect(html).toContain('id="score-bug"');
        expect(html).toContain('id="plays-panel"');
        expect(html).toContain('id="insights-panel"');
        expect(html).toContain('id="reactions-overlay"');
        expect(html).toContain('id="replay-controls"');
        expect(html).toContain('id="replay-progress"');
        expect(html).toContain('data-replay-speed="4"');
        expect(html).toContain('data-replay-speed="50"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('id="chat-form"');
        expect(html).toContain('id="chat-input"');
        expect(html).toContain('maxlength="2000"');
        expect(html).toContain('id="chat-sign-in"');
        expect(html).toContain('id="mention-menu"');
        expect(html).toContain('id="mention-allplays"');
        expect(html).toContain('id="anon-change-btn"');
        expect(html).toContain('id="ai-thinking"');
        expect(html).toContain('id="chat-badge"');
        expect(html).toContain('data-chat-reaction="fire"');
        expect(html).toContain('id="replay-scan-status"');
        expect(html).toContain('Video catches up when paused');
        expect(html).toContain('class="replay-play-glyph"');
        expect(html).toContain('class="replay-pause-glyph"');
        expect(html).toContain('data-replay-action="play"');
        expect(html).toContain('id="share-game"');
        expect(html).toContain('id="watch-replay"');
        expect(html).toContain('id="watch-replay-menu"');
        expect(html).toContain('aria-label="Watch Replay"');
        expect(html).toContain('>Watch Replay <span aria-hidden="true">→</span></a>');
        expect(html).toContain('id="scoreboard-toggle"');
        expect(html).toContain('id="scoreboard-menu-toggle"');
        expect(html).toContain('id="mute-toggle"');
        expect(html).toContain('id="fullscreen-toggle"');
        expect(html).toContain('id="game-actions-menu"');
        expect(html).toContain('aria-haspopup="menu"');
        expect(html).toContain('id="classic-view-link"');
        expect(html).toContain('id="classic-view-link-label"');
        expect(html).toContain('<span id="classic-view-link-label">Game Center</span>');
        expect(html).toContain('id="match-report-link"');
        expect(html).toContain('id="game-details-link"');
        expect(html).toContain('id="replay-access-gate"');
        expect(html).toContain('id="announcer-toggle"');
        expect(html).toContain('id="opponent-tab"');
        expect(html).toContain('id="home-team-photo"');
        expect(html).toContain('id="away-team-photo"');
        expect(html).toContain('data-score-hidden="false"');
        expect(html).toMatch(/\.panel-tab\s*\{[^}]*min-width:\s*44px;/);
        expect(html).toContain('js/live-game-overlay.js?v=76');
    });

    it('keeps the local demo isolated while wiring canonical subscriptions and authenticated chat posting', () => {
        expect(source).toContain("params.demo === '1'");
        expect(source).toContain("params.replay === 'true'");
        expect(source).toContain('startDemoReplayMode');
        expect(source).toContain("return import('./db.js?v=4433215')");
        expect(source).toContain("import('./live-game-state.js?v=63')");
        expect(source).toContain('stateTools.applyResetEventState');
        expect(source).toContain('reconcileOverlayLiveEvents');
        expect(source).toContain("from './live-game-overlay-model.js?v=34'");
        expect(source).toContain("import('./live-game-video.js?v=443320')");
        expect(source).not.toContain('loadPublicGameResetIdentity');
        expect(source).toContain('resolvePublicProjectionVideoOptions');
        expect(source).toContain('getSafeOverlayProviderUrl(publicUrl)');
        expect(modelSource).toContain('stateTools.applyViewerEventToState');
        expect(modelSource).toContain('stateTools.collectVisibleLiveEventsSequentially');
        expect(source).toContain('stateTools.shouldResetViewerFromGameDoc');
        expect(source).toContain('database.subscribeGame');
        expect(source).toContain('database.subscribeLiveEvents');
        expect(source).toContain('database.subscribeLiveChat');
        expect(source).toContain('database.subscribeReactions');
        expect(source).toContain('getOverlayLiveClockMs');
        expect(source).toContain('syncLiveClockAnchor');
        expect(source).toContain("import('./auth.js?v=4433220')");
        expect(source).toContain("import('./live-game-chat.js?v=4')");
        expect(currentLiveGameSource).toContain("from './live-game-overlay-model.js?v=34'");
        expect(currentLiveGameSource).toContain("from './live-game-video.js?v=443320'");
        expect(currentLiveGameSource).toContain("from './live-game-chat.js?v=4'");
        expect(modelSource).toContain("from './game-replay-video.js?v=3'");
        expect(videoSource).toContain("from './game-replay-video.js?v=3'");
        expect(chatSource).toContain("from './game-replay-video.js?v=3'");
        expect(source).toContain("from './safe-image-url.js?v=1'");
        expect(source).toContain('database.postLiveChatMessage');
        expect(source).toContain('database.sendReaction');
        expect(source).toContain('uiState.chatUser.uid');
        expect(source).toContain('resolveSafeProfilePhotoWriteUrl');
        expect(source).toContain('createSafeImageElement');
        expect(source).toContain('formatOverlayChatMessageHtml');
        expect(source).toContain('generateAiResponse');
        expect(source).toContain("import('./firebase-ai.js?v=1')");
        expect(source).toContain('handleMentionInput');
        expect(source).toContain('ensureChatDisplayName');
        expect(source).not.toContain('liveChatDisplayName:');
        expect(source).toContain('updateChatUnread');
        expect(source).toContain('text.length > 2000');
        expect(source).toContain('Date.now() - uiState.lastChatSentAt < 1500');
        expect(source).toContain('Message failed to send. Score and video remain connected.');
        expect(source).toContain('database.getLiveEvents');
        expect(source).toContain('database.getLiveChatHistory');
        expect(source).toContain('database.getLiveReactions');
        expect(source).toContain('buildReplaySessionState');
        expect(source).toContain('collectReplayEventWindow');
        expect(source).toContain('collectReplayStreamWindow');
        expect(source).toContain('getReplayElapsedMs');
        expect(source).toContain('seekReplay');
        expect(source).toContain('syncReplayMedia');
        expect(source).toContain('handleYouTubeReplayMessage');
        expect(source).toContain('parseYouTubeReplayTelemetry');
        expect(source).not.toContain('updateGame(');
        expect(source).not.toContain('trackViewerPresence(');
        expect(source).toContain('sendChatReaction');
        expect(source).toContain("from './game-share-links.js?v=1'");
        expect(source).toContain("from './utils.js?v=443391'");
        expect(source).toContain("from './live-game-announcer.js?v=2'");
        expect(source).toContain("import('./team-entitlements.js?v=11')");
        expect(source).toContain('isRecordedReplayTeamPassGateEnabled');
        expect(source).toContain('getTeamEntitlementStatus');
        expect(source).toContain('showReplayAccessGate');
        expect(source).toContain('options.isRecordedReplay === true');
        expect(source).toContain("uiState.videoMuted ? 'mute' : 'unMute'");
        expect(source).toContain('requestFullscreen');
        expect(source).toContain('buildGameWatchShareUrl');
        expect(source).toContain('toggleScoreboardVisibility');
        expect(source).toContain('elements.classicViewLink.href = `live-game.html?teamId=');
        expect(source).toContain("uiState.isReplay ? 'Game Recap' : 'Game Center'");
        expect(source).toContain("setConnectionIssue('replay'");
        expect(source).toContain('connectionIssues: new Map()');
        expect(source).toContain("state.events.slice(pageStart, pageStart + pageSize)");
        expect(source).toContain('renderTeamPhoto');
        expect(source).toContain('image.dataset.source === safeUrl');
    });

    it('keeps every current tracker live-event family in the overlay parity inventory', () => {
        const eventInventory = [
            ['lineup', [trackerSource, legacyTrackerSource]],
            ['clock_start', [trackerSource, legacyTrackerSource]],
            ['clock_pause', [trackerSource, legacyTrackerSource]],
            ['clock_sync', [trackerSource, legacyTrackerSource]],
            ['period_change', [trackerSource, legacyTrackerSource]],
            ['stat', [trackerSource, legacyTrackerSource, appTrackerSource]],
            ['goal', [trackerSource]],
            ['volleyball', [trackerSource]],
            ['baseball', [trackerSource]],
            ['football_play', [trackerSource]],
            ['football_score', [trackerSource]],
            ['note', [trackerSource, legacyTrackerSource]],
            ['substitution', [legacyTrackerSource]],
            ['undo', [trackerSource, legacyTrackerSource]],
            ['log_remove', [legacyTrackerSource]],
            ['reset', [trackerSource]],
            ['score_update', [appTrackerSource]]
        ];

        eventInventory.forEach(([eventType, producers]) => {
            producers.forEach((producer) => expect(producer).toContain(`type: '${eventType}'`));
        });
        expect(liveStateSource).toContain("event?.type === 'lineup'");
        expect(liveStateSource).toContain("event?.type === 'clock_sync'");
        expect(modelSource).toContain("event.type === 'clock_start'");
        expect(modelSource).toContain("event.type === 'clock_pause'");
        expect(modelSource).toContain("event.type === 'reset'");
        expect(modelSource).toContain('stateTools.applyViewerEventToState');
    });

    it('provides focus, panel, keyboard, demo, and reciprocal viewer navigation', () => {
        expect(html).toContain('id="focus-toggle"');
        expect(html).toContain('id="demo-lab"');
        expect(html).toContain('data-action="home-goal"');
        expect(source).toContain("event.key.toLowerCase() === 'f'");
        expect(source).toContain('togglePanel');
        expect(source).toContain('usesCompactPanelLayout');
        expect(html).toContain('data-panel-layout="wide"');
        expect(html).toContain('data-panel-open="false"');
        expect(html).toContain('@media (min-width: 901px) and (max-width: 1320px)');
        expect(currentLiveGame).toContain('id="overlay-view-link"');
        expect(currentLiveGame).toContain('id="overlay-view-link-label"');
        expect(currentLiveGame).toContain('<span id="overlay-view-link-label">Watch Live</span>');
        expect(currentLiveGameSource).toContain("overlayViewLink: q('#overlay-view-link')");
        expect(currentLiveGameSource).toContain('els.overlayViewLink.href = `live-game-overlay.html?teamId=');
        expect(currentLiveGameSource).toContain("? 'Game replay video'");
        expect(currentLiveGameSource).toContain(": 'Live stream';");
        expect(currentLiveGameSource).toContain("hasReplayPlayback ? 'Watch Replay' : 'Watch Live'");
        expect(currentLiveGameSource).toContain("els.overlayViewLink.classList.toggle('hidden', !hasReplayPlayback && !hasLivePlayback)");
    });

    it('keeps the former preview URL as a query-preserving compatibility redirect', () => {
        expect(redirect).toContain("new URL('live-game-overlay.html', window.location.href)");
        expect(redirect).toContain('destination.search = window.location.search');
        expect(redirect).toContain('destination.hash = window.location.hash');
    });
});


describe('overlay responsive state', () => {
    it.each([
        [568, 320, false, true], [844, 390, false, true], [932, 430, false, true],
        [390, 844, false, true], [1280, 720, false, false], [1440, 900, false, false],
        [1024, 768, true, true], [1440, 900, true, false]
    ])('chooses the correct panel layout at %ix%i replay=%s', (width, height, isReplay, compact) => {
        const window = { matchMedia(query) {
            const maxWidth = query.match(/max-width: (\d+)px/);
            const maxHeight = query.match(/max-height: (\d+)px/);
            return { matches: (!maxWidth || width <= Number(maxWidth[1])) &&
                (!maxHeight || height <= Number(maxHeight[1])) &&
                (!query.includes('orientation: landscape') || width > height) };
        } };
        const layout = new Function('window', 'uiState', `
            ${extractFunction(source, 'usesLandscapeLayout')}
            ${extractFunction(source, 'usesCompactPanelLayout')}
            return usesCompactPanelLayout();
        `)(window, { isReplay });
        expect(layout).toBe(compact);
    });

    it('tracks keyboard viewport changes and restores the full stage without touching playback state', () => {
        const input = {};
        const properties = {};
        const elements = { chatInput: input, body: { dataset: {}, style: {
            setProperty: (name, value) => { properties[name] = value; }
        } } };
        const window = { innerHeight: 390, visualViewport: { height: 210, offsetTop: 12 } };
        const document = { activeElement: input };
        const update = new Function('window', 'document', 'elements', 'usesLandscapeLayout', `
            ${extractFunction(source, 'updateVisibleViewport')}
            return updateVisibleViewport;
        `)(window, document, elements, () => true);
        update();
        expect(elements.body.dataset.keyboard).toBe('true');
        expect(properties).toEqual({ '--visible-height': '210px', '--visible-top': '12px' });
        window.visualViewport = { height: 390, offsetTop: 0 };
        update();
        expect(elements.body.dataset.keyboard).toBe('false');
        expect(properties['--visible-height']).toBe('390px');
        window.visualViewport = null;
        update();
        expect(properties['--visible-top']).toBe('0px');
    });
});


it('returns from landscape sign-in to the exact overlay document, query and fragment', async () => {
    const viewerPath = '/live-game-overlay.html?teamId=team-1&gameId=game-1&view=live%20game#chat';
    const location = new URL(viewerPath, 'https://allplays.ai');
    const signInUrl = new Function('window', `
        ${extractFunction(source, 'getChatSignInUrl')}
        return getChatSignInUrl();
    `)({ location });
    const next = new URLSearchParams(signInUrl.split('?')[1]).get('next');
    expect(next).toBe(viewerPath);
    const navigate = vi.fn();
    const locationObject = { hash: '#/auth', replace: vi.fn(), reload: vi.fn() };
    await expect(completeAuthNavigation(next, navigate, { locationObject })).resolves.toBe('document');
    expect(locationObject.replace).toHaveBeenCalledWith(viewerPath);
    expect(navigate).not.toHaveBeenCalled();
    expect(locationObject.reload).not.toHaveBeenCalled();
});
